# Per-Employee Payroll History & Payslip — Design

## Purpose

The owner wants to open an employee's record and see their payroll history — the net pay
they received for each past pay period — and print an individual payslip formatted like a
real payslip (letterhead, Earnings/Deductions columns, Net Pay, signature lines), not just
the existing all-employees payroll register.

## Current state (why this isn't already possible)

Two separate, unconnected employee concepts exist in this codebase today:

1. **Finara's internal `Employee` model** (`prisma/schema.prisma`) — still the model that
   actually drives payroll: `PayrollPeriod` → `PayrollItem` rows are created against it by
   `payrollController.computePeriod`, and it powers the Calculator and BIR 2316 generation.
   It currently has **no page in the sidebar nav** — `app/(dashboard)/payroll/page.jsx` still
   has employee CRUD wired to it, but that page isn't linked from `Sidebar.jsx` any more.
2. **The Beulah Employee Directory** (`beulahEmployeeClient.js`, `GET /payroll/employee-directory`)
   — a read-only roster pulled from the external Beulah system, shown at `/payroll/employees`
   (the page the sidebar actually links to). It has no payroll data at all — just name,
   department, gender, daily rate, shift.

So today there is no page that shows "this employee's payslips over time," and the
`PayrollItem` fields (`basicPay`, `allowances`, `overtimePay`, statutory deductions,
`netPay`) don't cover the attendance-style fields the owner wants on the printed payslip
(Days Present, Late, Undertime, Holiday Adjustment, Cash Advance) — nothing in the schema
tracks those today.

## Scope decisions (confirmed with the user)

- Build the missing attendance-style fields directly in Finara — no external system
  currently supplies them, so they're entered manually by whoever finalizes the payroll run.
- Do **not** add a stored "daily rate" field — the org has no daily-rate concept in the
  schema today (`Employee.basicSalary` is the only pay-rate figure); the payslip prints
  `Basic Pay` instead of a separate `Rate` line.
- Extend the existing `PayrollPeriod` → `PayrollItem` compute workflow in place (Approach
  A below) rather than building a parallel attendance module or a separate pre-compute
  attendance-entry step — smallest change, no new lifecycle states, existing GL-posting-on-
  approve logic in `approvePeriod` is untouched.
- Surface the history on the **Beulah Employee Directory drawer** (`/payroll/employees`),
  matched to the internal `Employee` by `employeeNo`/name — that's the page the owner
  actually uses to look someone up, even though the payroll data itself still lives against
  the internal `Employee` table.

## Data model (`prisma/schema.prisma`)

Add five fields to the existing `PayrollItem` model (all default to zero/null so existing
rows are unaffected):

```prisma
model PayrollItem {
  ...existing fields unchanged...
  daysPresent       Int?      // informational only, manual entry
  lateAmount        Decimal   @default(0) @db.Decimal(15, 2)
  undertimeAmount   Decimal   @default(0) @db.Decimal(15, 2)
  holidayAdjustment Decimal   @default(0) @db.Decimal(15, 2)
  cashAdvance       Decimal   @default(0) @db.Decimal(15, 2)
  ...
}
```

No new tables, no new migration risk beyond an additive `ALTER TABLE`.

## Recompute formula

Whenever the new fields are edited on a `PayrollItem`:

```
grossPay        = basicPay + overtimePay + holidayAdjustment + allowances
totalDeductions = lateAmount + undertimeAmount + cashAdvance
                  + sssEmployee + philhealthEe + pagibigEe + withholdingTax
netPay          = grossPay - totalDeductions
```

`sssEmployee`/`philhealthEe`/`pagibigEe`/`withholdingTax` are untouched — they still come
from `computePayroll()` at compute time and are not recalculated by this edit (statutory
tables aren't affected by attendance adjustments).

## Backend

### `PUT /api/payroll/periods/:periodId/items/:itemId` (new)

- Auth: `authorize('ADMIN', 'MANAGER')` (same tier as `compute`/other period mutations).
- Loads the `PayrollItem`, 404 if it doesn't belong to `periodId`.
- Loads the parent `PayrollPeriod`; if `status !== 'COMPUTED'`, `400` — "Payslip can only be
  edited while the period is in COMPUTED status" (mirrors the existing `updatePeriod`
  transition-guard style).
- Body: `{ daysPresent?, lateAmount?, undertimeAmount?, holidayAdjustment?, cashAdvance? }`
  — each coerced with `Number(...) || 0` (or left as `null` for `daysPresent` when omitted),
  negative values rejected with `400`.
- Recomputes `grossPay`/`totalDeductions`/`netPay` per the formula above and
  `prisma.payrollItem.update(...)`.
- Returns the updated item (same shape as one row of `getPeriodItems`, i.e. including
  `employee: { employeeNo, firstName, lastName, position, department }`).

### `GET /api/payroll/employee-directory/:id/payroll-history` (new)

- Auth: inherits the router-level `authorize('ADMIN', 'MANAGER', 'ACCOUNTANT')` (same as the
  other directory/read endpoints — this is a read).
- Steps:
  1. `beulahEmployeeClient.getEmployee(id)` → `{ employee_number, name, ... }`. If this call
     fails (Beulah unreachable), respond `502` with the same message style as
     `getEmployeeDirectory` — the drawer already has a "couldn't load" pattern to reuse.
  2. Look up the internal `Employee`: `where: { businessId, employeeNo: employee_number }`
     (MySQL's default collation is already case-insensitive for string comparison here, so
     no `mode: 'insensitive'` — that Prisma option isn't supported on the MySQL provider
     anyway). If none found, fall back to a match against the directory's `name` field:
     split it on whitespace, first token = `firstName`, last token = `lastName` (middle
     tokens ignored), and look up `Employee` by that exact `firstName`+`lastName` pair.
  3. No match → `{ matched: false, items: [] }` (200, not an error — a directory-only
     employee legitimately may have no Finara payroll record yet).
  4. Match found → `prisma.payrollItem.findMany({ where: { employeeId }, include: { period: true }, orderBy: { period: { startDate: 'desc' } } })`, return `{ matched: true, employeeId, items }`.

## Routes (`server/routes/payroll.js`)

```js
router.put('/periods/:periodId/items/:itemId', authorize('ADMIN', 'MANAGER'),
  param('periodId').isInt(), param('itemId').isInt(), validate, ctrl.updatePeriodItem);

router.get('/employee-directory/:id/payroll-history', ctrl.getEmployeeDirectoryPayrollHistory);
```

## `lib/api.js` additions

```js
periods: {
  ...existing...
  updateItem: (periodId, itemId, data) => api.put(`/payroll/periods/${periodId}/items/${itemId}`, data),
},
employeeDirectory: {
  ...existing...
  history: (id) => api.get(`/payroll/employee-directory/${id}/payroll-history`),
},
```

## Frontend

### Period Detail modal (`app/(dashboard)/payroll/periods/page.jsx`)

While `period.status === 'COMPUTED'`, each payslip row gets a small "Edit" (pencil) icon in
a new trailing column. Clicking it opens a lightweight inline popover/modal with five
inputs: Days Present, Late, Undertime, Holiday Adjustment, Cash Advance (pre-filled with
current values). Save calls `pApi.periods.updateItem(...)`, replaces that row in `items`
state with the response, and the Gross/Net cells update immediately (recomputed
server-side). No edit affordance once `APPROVED`/`PAID` (matches the existing read-only
register at that point).

### Employee Directory drawer (`app/(dashboard)/payroll/employees/page.jsx`)

The drawer (`EmployeeDrawer`) gets a second tab next to "Directory Details":

- **Directory Details** (existing content, unchanged).
- **Payroll History** (new): on first activation, calls
  `pApi.employeeDirectory.history(employee.id)`.
  - Loading: small spinner.
  - `matched: false`: empty state — "No linked Finara payroll record for this employee yet."
  - `matched: true`, `items.length === 0`: "No payslips yet."
  - Otherwise: a compact table — Period name, Pay Date, Net Pay, period status badge — newest
    first. Clicking a row prints that one payslip.
  - Hard error (Beulah unreachable): same inline "Couldn't load" + Retry pattern as the
    directory list.

### Individual payslip print

A new helper (colocated in the drawer file or a small `buildPayslipHTML(item, employee)`
function) builds `bodyHTML` for `printDocument`, reusing `phpFmt`/`dateFmt` from
`@/lib/print` exactly like `periods/page.jsx`'s existing register print. Layout mirrors the
sample: employee name/employee no./department header info-grid, then a two-column
Earnings | Deductions table —

- **Earnings**: Basic Pay, Overtime, Holiday Adjustment, Allowances, **Gross Salary** (bold)
- **Deductions**: Cash Advance, Late, Undertime, SSS, PhilHealth, Pag-IBIG, Withholding Tax, **Total Deductions** (bold)
- **Net Pay** row, bold/green, full width
- Static "Prepared by: Human Resource" / "Approved by: Manager" signature block, matching
  the sample

`printDocument('Payslip', '<Employee Name> · <Period Name>', bodyHTML)` — the company
letterhead, TIN, address etc. are automatic, same as every other print in this codebase.

## Error handling

- Editing a payslip on a non-`COMPUTED` period → `400`, surfaced as a toast (existing
  pattern throughout `periods/page.jsx`).
- Negative adjustment values → `400` from validation.
- Beulah unreachable at directory-history time → `502`, drawer shows inline error, rest of
  the drawer (Directory Details tab) is unaffected.
- No matching internal employee → not an error; explicit empty state.

## Out of scope

- No bulk/CSV attendance import — adjustments are entered one payslip at a time via the Edit
  popover.
- No change to the statutory (SSS/PhilHealth/Pag-IBIG/withholding) computation itself.
- No new `dailyRate` field or attendance history independent of a computed `PayrollItem` —
  Days Present/Late/Undertime/Holiday Adjustment/Cash Advance only exist per payslip, entered
  during the `COMPUTED` window of that specific period.
- No changes to `ExternalPayrollRun`/Beulah Payroll lock-status integration (separate,
  already-shipped feature) — this only reuses `beulahEmployeeClient` (the employee-directory
  client) for the id→employeeNo/name lookup.
- Does not restore the orphaned `/payroll/page.jsx` employee-CRUD tab to the nav — out of
  scope for this feature; if an owner needs to create/edit internal `Employee` records, that
  gap is pre-existing and unrelated to payroll history.

## Testing

- `PUT /periods/:periodId/items/:itemId`: recompute math is correct; blocked (`400`) when
  period is `APPROVED`/`PAID`; `404` for an item not belonging to that period; negative
  values rejected.
- `GET /employee-directory/:id/payroll-history`: matched-by-employeeNo case, matched-by-name
  fallback case, no-match case (`matched: false`, 200), Beulah-unreachable case (`502`).
- Manual: edit a computed payslip's adjustments in the Period Detail modal and confirm
  Gross/Net update; open an employee's drawer, confirm the Payroll History tab lists past
  periods with correct Net Pay; print one and visually compare against the sample layout.
