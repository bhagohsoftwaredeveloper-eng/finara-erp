# Invoice Editing (Unpaid Invoices) — Design

**Date:** 2026-08-11
**Status:** Approved

## Goal

Let staff correct a mistake on a Sales Invoice — wrong customer, wrong line
item, wrong price — without voiding and recreating it, as long as no
payment has been collected against it yet. Today `Invoice` has no edit
capability at all: only Create, Record Collection, and Void exist
(`server/controllers/receivableController.js`).

## Scope decision

**Edit is all-or-nothing on the same eligibility rule Void already uses:**
`paidAmount == 0 && status !== 'VOID'` (in practice: `OPEN` or `OVERDUE`
invoices only — `PARTIAL`/`PAID` imply a collection exists, `VOID` is
already dead). Everything on the invoice is editable when that rule
passes: customer, invoice date, due date, description, notes, and the full
line-items table (add/remove/edit lines) — the same fields `CreateInvoiceModal`
already exposes on create. There is no narrower "amounts only" mode; once
any payment lands, the invoice is frozen and the only corrections available
are Void (if still `paidAmount == 0`) or a manual adjusting entry.

## Data model

No schema change. `Invoice.invoiceNo` never changes on edit — same
invoice, same number, corrected contents. `InvoiceLine` rows are fully
replaced on each edit (delete-all-then-recreate via Prisma's nested
`lines: { deleteMany: {}, create: [...] }`), matching how `InvoiceLine`
already cascades on delete (`prisma/schema.prisma:349`,
`onDelete: Cascade`).

`Invoice` has no `journalEntryId` column — unlike `CashSale`, which does
(`prisma/schema.prisma:1180`). The invoice's posted journal entry is only
findable by `reference = invoiceNo` on `JournalEntry`, which is how
`createInvoice` already leaves it (`server/controllers/receivableController.js:151`,
`reference: inv.invoiceNo`). This design does not add a `journalEntryId`
column — it reuses the same reference-lookup approach the
2026-08-11 Cash Sale POS Picker design uses for its own (different)
linkage problem, filtered to `status: 'POSTED'` so repeated edits always
resolve to the currently-active entry, never a previously-voided one.

## Backend — `updateInvoice`

New `exports.updateInvoice` in `server/controllers/receivableController.js`,
routed as `PUT /receivable/:id` in `server/routes/receivable.js`, with the
same body validators `POST /` already uses (`customerId` int, `invoiceDate`/
`dueDate` ISO8601, `lines` array min 1, per-line `accountId`/`description`/
`quantity`/`unitPrice`/`vatCode`) plus `param('id').isInt()`. No
`authorize()` role restriction — matches `createInvoice`'s own stance (any
authenticated user). Editing an invoice before any payment exists is the
same financial-risk level as creating it correctly the first time; `Void`
requires ADMIN/MANAGER because it removes a transaction outright, which is
a different kind of risk.

1. Fetch the invoice (404 if missing).
2. `paidAmount > 0` → 400 `"Cannot edit an invoice with collections. Void and recreate, or reverse the collection first."`
   (wording mirrors `voidInvoice`'s existing `"Cannot void an invoice with
   collections. Reverse first."`, `receivableController.js:213`).
3. `status === 'VOID'` → 400 `"Cannot edit a voided invoice"`.
4. Recompute `subtotal`/`vatAmount`/`totalAmount` from the submitted lines
   using the exact same `computeVAT()` call `createInvoice` already uses
   (`receivableController.js:107`) — same rounding behavior, no drift
   between create and edit math.
5. `prisma.invoice.update({ where: { id }, data: { customerId, invoiceDate,
   dueDate, description, notes, subtotal, vatAmount, totalAmount, lines: {
   deleteMany: {}, create: [...] } }, include: { customer: true, lines: true
   } })`.
6. GL correction:
   - `const oldEntry = await prisma.journalEntry.findFirst({ where: {
     businessId: req.businessId, reference: inv.invoiceNo, status: 'POSTED'
     } })` — if found, `prisma.journalEntry.update({ where: { id:
     oldEntry.id }, data: { status: 'VOIDED' } })`. If not found (the
     original `safePost` silently failed), there is nothing to void — the
     edit proceeds regardless, same tolerance `CashSale` void already has
     for a missing entry (`sale.journalEntryId` may be null).
   - `glPost.safePost({ ..., description: "AR Invoice (Edited) — {customer}
     ({invoiceNo})", reference: inv.invoiceNo, lines: [...] })` — same DR
     Accounts Receivable / CR each revenue line / CR Output VAT shape
     `createInvoice` already builds (`receivableController.js:128-147`),
     computed from the updated invoice. Best-effort, non-blocking, same
     `safePost` convention as everywhere else in the app — a failure here
     doesn't fail the edit; it lands in the Audit Trail as `GL_POST_FAILED`.
7. Respond `200` with the updated invoice (customer + lines included), same
   shape `getInvoice` already returns.

The invoice-update DB write (step 5) and the GL-void-then-repost (step 6)
are **not** wrapped in one atomic transaction — this matches
`createInvoice`'s own existing structure (DB write, then a separate
best-effort GL post) rather than introducing a new pattern. A GL posting
failure here is exactly as visible and exactly as recoverable (Audit Trail)
as a `createInvoice` GL posting failure already is today.

## Frontend

`CreateInvoiceModal` (`app/(dashboard)/receivable/page.jsx:429`) takes an
optional `invoice` prop:

- **Absent (today's behavior):** title "New Sales Invoice", form starts
  empty, submits via `rApi.invoices.create()`.
- **Present (edit mode):** title "Edit Invoice", submit button reads "Save
  Changes", form state initializes from `invoice.customerId`,
  `invoice.invoiceDate`, `invoice.dueDate`, `invoice.description`,
  `invoice.notes`, and `invoice.lines` mapped to the form's existing line
  shape (`{ accountId, description, quantity, unitPrice, vatCode }`).
  Submits via a new `rApi.invoices.update(invoice.id, payload)`
  (`lib/api.js`: `update: (id, data) => api.put(\`/receivable/${id}\`, data)`,
  alongside the existing `receivable.invoices` entries at `lib/api.js:226-232`).
  The due-date auto-fill effect (`+30 days from invoice date`,
  `page.jsx:454-460`) only fires when `dueDate` is empty, so it does not
  clobber an existing invoice's due date when the modal opens pre-filled.

An **Edit** action (pencil icon, same icon-button style as the existing
Void/Collect actions) is added in two places, both gated by the identical
condition Void already uses (`invoice.paidAmount == 0 && invoice.status !==
'VOID'`):

- The invoice list's row actions (`page.jsx:963-993`), alongside the
  existing "Record collection" and "Void invoice" icon buttons.
- `InvoiceDetailModal`'s footer (`page.jsx:265-286`), alongside the
  existing "Void" and "Record Collection" buttons.

Both open the same shared modal in edit mode, passing the already-fetched
invoice (list row) or the modal's own `invoice` prop (detail modal) — no
extra fetch needed for the list-row path only if the row data already
includes `lines`; `listInvoices` already includes `lines: true`
(`receivableController.js:80`), so the list row's invoice object is
sufficient without a fresh `getInvoice` call.

## Error handling

- 404 if the invoice doesn't exist.
- 400 `paidAmount > 0` — cannot edit, collections exist.
- 400 `status === 'VOID'` — cannot edit a dead invoice.
- Standard express-validator 400s for malformed body (missing customerId,
  empty lines array, bad line fields) — identical validators to create, so
  behavior is consistent between the two endpoints.
- GL posting failure (either the void-old or post-new call) is
  non-blocking, matching `safePost`'s app-wide convention — the edit still
  succeeds, Audit Trail records the failure.
- Frontend surfaces all errors via the existing toast-on-catch pattern
  `CreateInvoiceModal.handleSubmit` already uses.

## Out of scope

- Editing an invoice that already has a collection (`paidAmount > 0`) —
  the existing correction path (Void + recreate, or a manual adjusting
  entry) is unchanged.
- Fixing `voidInvoice`'s pre-existing gap of not voiding its own linked
  journal entry (flagged in the 2026-08-10 Cash Sales design as a known,
  deliberately-unfixed issue) — out of scope here too; this design only
  adds a `reference`-based JE lookup for the *edit* path, it does not touch
  `voidInvoice` itself.
- An edit history / audit log of what changed on each edit beyond what the
  Audit Trail already captures for the GL side.
- Editing a `Quotation` (separate model, not touched by this design).
