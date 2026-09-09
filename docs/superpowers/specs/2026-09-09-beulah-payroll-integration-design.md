# Beulah Payroll Integration — Design

## Purpose

Finara's employees are actually paid through a separate external system, "Beulah Payroll" (a Laravel app deployed at `https://beulahpayroll.up.railway.app`), which exposes a read-only, token-authenticated API describing each payroll run's lock status and aggregate pay totals. Finara needs to:

1. Show these external payroll runs inside the existing Payroll → Pay Periods page, and
2. Let an authorized user turn a locked run into a real Accounts Payable bill (and its GL entry) inside Finara, so the external payroll becomes Finara's basis for that accounting.
3. Persist every run Finara has ever seen, so Finara accumulates its own payroll-run history/starting data over time, independent of whatever Beulah still has on hand.

## Constraint that shapes this whole design

The Beulah API (`GET /api/payroll-runs/lock-status` and `GET /api/payroll-runs/{id}/lock-status`) only returns **run-level aggregate totals** — `gross_pay`, `total_deductions`, `net_pay`, `cash_advance`, `incentives`, `entries_count` (a count, not a list). There is **no per-employee breakdown anywhere in this API**. Per-employee history is out of scope until Beulah exposes a per-employee endpoint; this design stores and posts at the run/period level only.

Finara's existing `PayrollPeriod`/`PayrollItem` models (internal payroll workflow: `OPEN → COMPUTED → APPROVED → PAID`, driven by per-employee `PayrollItem` rows and their own GL-accrual logic on approve) are **not reused or modified**. Beulah runs get their own table so the internal compute/approve workflow and its GL logic are untouched.

## Data model (`prisma/schema.prisma`)

```prisma
model ExternalPayrollRun {
  id                Int       @id @default(autoincrement())
  businessId        Int       @default(1)
  externalRunId     Int                    // Beulah's payroll_runs.id
  periodStart       DateTime
  periodEnd         DateTime
  payableDate       DateTime
  status            String    @db.VarChar(20) // raw 'draft' | 'locked' from Beulah
  entriesCount      Int
  grossPay          Decimal   @db.Decimal(15,2)
  totalDeductions   Decimal   @db.Decimal(15,2)
  netPay            Decimal   @db.Decimal(15,2)
  cashAdvance       Decimal   @db.Decimal(15,2)
  incentives        Decimal   @db.Decimal(15,2)
  externalCreatedBy Int?                    // Beulah's created_by user id, informational only
  syncedAt          DateTime  @updatedAt
  postedBillId      Int?      @unique
  postedBill        Bill?     @relation(fields: [postedBillId], references: [id])
  postedById        Int?
  postedBy          User?     @relation(fields: [postedById], references: [id])
  postedAt          DateTime?

  @@unique([businessId, externalRunId])
  @@map("external_payroll_runs")
}
```

Add the inverse relations: `Bill.externalPayrollRun ExternalPayrollRun?` and `User.postedExternalPayrollRuns ExternalPayrollRun[]`.

## Environment variables

Add to `.env.example` (server-only, never `NEXT_PUBLIC_*`):

```
# Beulah Payroll (external payroll system) — read-only lock-status API
BEULAH_PAYROLL_BASE_URL=
BEULAH_PAYROLL_API_TOKEN=
```

(Prefixed with `BEULAH_` rather than the generic `PAYROLL_API_*` names from the source doc, since Finara already has its own internal "Payroll" concept — this avoids ambiguity in `.env` between the two systems.) Values for this deployment:

```
BEULAH_PAYROLL_BASE_URL=https://beulahpayroll.up.railway.app/api
BEULAH_PAYROLL_API_TOKEN=1|enu1KspR1agUGuHGXUgnWs7KQhw7GSxhxmF9PiPv1c6b3e5a
```

These go in the untracked `.env` only — never committed.

## Backend

### `server/services/beulahPayrollClient.js` (new)

```js
async function listPayrollRunLockStatuses()       // GET {base}/payroll-runs/lock-status
async function getPayrollRunLockStatus(externalId) // GET {base}/payroll-runs/{id}/lock-status
```

- Native `fetch()`, `Authorization: Bearer ${BEULAH_PAYROLL_API_TOKEN}`, `Accept: application/json`, `AbortSignal.timeout(5000)`.
- No retry loop (this is a page-load read, not a delivery guarantee) — modeled on `server/utils/leadWebhook.js`'s timeout/logging conventions, without its retry/signing (those are for outbound webhooks, not inbound reads).
- Throws a plain `Error` with a clear message on non-2xx, timeout, or network failure; caller decides fallback behavior.

### `server/controllers/payrollController.js` additions

**`getExternalPayrollRuns(req, res)`** — `GET /api/payroll/external-runs`

1. Try `listPayrollRunLockStatuses()`.
2. On success: for each run returned, upsert an `ExternalPayrollRun` row keyed on `(businessId, externalRunId)`, writing all fields **except** `postedBillId`/`postedById`/`postedAt` (never overwrite posting state from a sync). Then read back all `ExternalPayrollRun` rows for this business, newest `periodStart` first, and return `{ data: rows, stale: false, lastSyncedAt }`.
3. On failure: log via `logger.warn`, then read the persisted `ExternalPayrollRun` rows for this business. If any exist, return `{ data: rows, stale: true, lastSyncedAt: max(syncedAt) }`. If none exist yet, respond `502 { error: 'Could not reach external payroll system' }`.

**`postExternalPayrollRunToAP(req, res)`** — `POST /api/payroll/external-runs/:externalRunId/post-to-ap`

1. Load the `ExternalPayrollRun` row by `(businessId, externalRunId)` — 404 if never synced.
2. Re-fetch that single run live via `getPayrollRunLockStatus(externalRunId)` and update the stored row's fields (freshness check — don't post stale numbers). If the live call fails, fall back to the stored row's last-known values and proceed (don't block posting just because Beulah is briefly unreachable, since the values were already locked and synced).
3. 400 if `status !== 'locked'`.
4. 409 if `postedBillId` is already set — return the existing bill reference instead of creating a duplicate.
5. Find-or-create the `Vendor` named **"Beulah Payroll (Employees Payable)"** for this business (`where: { businessId, name }`, via the existing `nextVendorCode` helper used by vendor creation) — created once on first use, reused after by exact name lookup.
6. Look up the `Account` with `where: { businessId, accountCode: '6110' }` ("Salaries and Wages").
7. `payableController.createBill` is currently a controller function (`req, res, next`), not a reusable service — extract its body into an exported `createBillRecord({ businessId, vendorId, billDate, dueDate, description, notes, lines, userId })` helper in `payableController.js` (returns the created bill), with the existing route handler becoming a thin wrapper that calls it with values from `req`. `postExternalPayrollRunToAP` calls this same helper with:
   - `vendorId`, `billDate: payableDate`, `dueDate: payableDate`
   - `description: "Payroll {periodStart}–{periodEnd} (Beulah run #{externalRunId})"`
   - `notes`: a plain-text summary of gross/deductions/cash advance/incentives for audit trail (these numbers are not separately posted, only recorded for reference)
   - `lines: [{ accountId: <6110 id>, description: "Net pay — Beulah run #{externalRunId}", quantity: 1, unitPrice: netPay, vatCode: 'EXEMPT' }]`
   - This automatically triggers the existing `glPost.safePost` call inside bill creation (DR `6110` Salaries and Wages / CR `2010` Accounts Payable–Trade for `netPay`) — no new GL code is written for this feature.
8. Update the `ExternalPayrollRun` row: `postedBillId`, `postedById: req.user.id`, `postedAt: now()`.
9. Return `{ data: { run, bill } }`.

### `server/routes/payroll.js` additions

```js
router.get('/external-runs', authorize('ADMIN', 'MANAGER', 'ACCOUNTANT'), ctrl.getExternalPayrollRuns);
router.post('/external-runs/:externalRunId/post-to-ap', authorize('ADMIN', 'MANAGER'), ctrl.postExternalPayrollRunToAP);
```

(Mounted under the existing `authenticate` already applied to the whole `/api/payroll` router.)

### `lib/api.js` additions

```js
externalRuns: {
  list: () => api.get('/payroll/external-runs'),
  postToAP: (externalRunId) => api.post(`/payroll/external-runs/${externalRunId}/post-to-ap`),
},
```
(added under the existing `payroll` export)

## Frontend (`app/(dashboard)/payroll/periods/`)

### `ExternalPayrollWidget.jsx` (new component, rendered on `periods/page.jsx`)

A `card` placed above the existing `PeriodCard` grid, titled "Beulah Payroll — External Runs":

- Fetches `payroll.externalRuns.list()` once on mount.
- **Loading**: skeleton row.
- **Success**: table — Period (start–end), Payable Date, Status badge (`locked` → `badge-green`, `draft` → `badge-yellow`), Entries, Gross, Deductions, Net, Cash Advance, Incentives, Action. A small "Synced {relative time}" caption; if `stale: true`, caption reads "Showing data as of {lastSyncedAt} — refresh failed" in a warning tone, but the table still renders normally.
- **Hard error** (no data at all, 502 with nothing persisted): inline message "Couldn't load external payroll data" + **Retry** button that re-runs the fetch. Rest of the Pay Periods page is unaffected either way.
- **Action column**, only rendered for ADMIN/MANAGER (role check via the existing session-role helper in `lib/auth.js`):
  - `locked` + no `postedBillId` → **"Post to AP"** button → confirm dialog (native `confirm()`, matching this codebase's existing lightweight confirm pattern) → `payroll.externalRuns.postToAP(externalRunId)` → success toast + row updates in place to show the bill number; failure toast shows the server's error message (e.g. "already posted", "run is still in draft").
  - `locked` + `postedBillId` set → static text `Posted (BILL-000123)`, no button.
  - `draft` → no action, badge only.
- ACCOUNTANT role and below (VIEWER has no payroll access at all, per existing `/api/payroll` gating) sees the table read-only, no Action column content.

## Out of scope

- No per-employee breakdown, storage, or posting — blocked on Beulah not exposing per-employee data (see Constraint section above). Revisit once/if Beulah adds a per-run entries endpoint.
- No automatic or polling-based posting — "Post to AP" is always an explicit, manual, confirmed action.
- No editing or voiding a posted bill from this widget — use the existing AP bill tools (`app/(dashboard)/payable/`) for that once it's posted.
- No write-back to Beulah (no lock/unlock from Finara) — matches the source API doc, which is read-only by design.
- No changes to Finara's internal `PayrollPeriod`/`PayrollItem` workflow, its own approve/GL logic, or the Sidebar nav (this lives inside the existing Pay Periods page, no new nav entry).

## Testing

- `GET /api/payroll/external-runs` with Beulah reachable: confirm rows are upserted (create then update on second call), `postedBillId` etc. survive a re-sync untouched, VIEWER gets 403, ACCOUNTANT/MANAGER/ADMIN get 200.
- `GET /api/payroll/external-runs` with Beulah unreachable and no prior sync: 502.
- `GET /api/payroll/external-runs` with Beulah unreachable but prior synced rows exist: 200 with `stale: true` and the last-known rows.
- `POST /api/payroll/external-runs/:id/post-to-ap` on a `draft` run: 400.
- `POST .../post-to-ap` on a `locked` run, first time: creates one `Vendor` (only if not already present), one `Bill` with a single `6110` line for `netPay`, one posted `JournalEntry` (DR 6110 / CR 2010, amount = netPay), and stamps `postedBillId`/`postedById`/`postedAt` on the `ExternalPayrollRun` row.
- `POST .../post-to-ap` again on the same run: 409, no duplicate `Bill`/`Vendor`/GL entry created.
- `POST .../post-to-ap` as ACCOUNTANT or VIEWER: 403.
- `POST .../post-to-ap` on an `externalRunId` never synced (no `ExternalPayrollRun` row): 404.
- Confirm `BEULAH_PAYROLL_API_TOKEN` never appears in any response body, browser network tab, or client bundle.
