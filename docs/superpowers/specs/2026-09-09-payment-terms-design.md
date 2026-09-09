# Declarable Payment Terms — Design

## Purpose

Invoices, Bills, Quotations, and Purchase Orders currently compute their due/valid/expected date with a hardcoded "+30 days" default, manually overridable per document, with "payment terms" only ever existing as free text inside a remarks/notes field. There is no way to define named terms (Net 15, Net 30, COD, Due on Receipt, etc.) once and reuse them. This adds a per-business, admin-managed master list of Payment Terms, selectable on AR/AP documents, which auto-computes the relevant date — managed the same way other master data in this app already is (a real Prisma model + CRUD, same shape as the existing Settings → Users sub-resource).

## Scope

- New `PaymentTerm` master-data model, managed from a new "Payment Terms" tab in Settings.
- A `paymentTerms` snapshot column (string) added to `Invoice`, `Bill`, `Quotation`, `PurchaseOrder` — captures the term's **name** at creation time, not a foreign key. Renaming, deactivating, or deleting a term later never changes what past documents display.
- Term selection drives the existing date field (`dueDate` / `validUntil` / `expectedDate`) on creation; the date stays manually editable afterward exactly as it is today.
- Quotation→Invoice and PO→Bill conversion carry the source document's term/date forward as the new document's default (replacing today's hardcoded 30-day conversion fallback), still overridable before confirming.
- No per-Customer/Vendor default term, no FK/referential integrity to `PaymentTerm`, no installment/split-payment terms. One flat day-count per term.

## Data model — `prisma/schema.prisma`

```prisma
model PaymentTerm {
  id         Int      @id @default(autoincrement())
  businessId Int      @default(1)
  name       String   @db.VarChar(50)
  days       Int      @default(0)
  isDefault  Boolean  @default(false)
  isActive   Boolean  @default(true)
  sortOrder  Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([businessId, name])
  @@index([businessId])
  @@map("payment_terms")
}
```

Additive nullable column on each of `Invoice`, `Bill`, `Quotation`, `PurchaseOrder`:

```prisma
paymentTerms String? @db.VarChar(50)
```

After editing `schema.prisma`: `npm run db:generate && npm run db:migrate` (dev server must be stopped first on Windows — Prisma generate holds a DLL lock otherwise).

## Seed defaults — `prisma/seed.js`

Seed 5 starter terms per business, alongside the existing COA/admin/sample-data seeding:

| name | days | isDefault |
|---|---|---|
| Due on Receipt | 0 | |
| COD | 0 | |
| Net 15 | 15 | |
| Net 30 | 30 | ✓ |
| Net 60 | 60 | |

All editable/deletable afterward — this is just a sane starting point, not a fixed list.

## Backend — `server/controllers/settingsController.js` + `server/routes/settings.js`

Mirrors the existing `listUsers/updateUser/deleteUser` sub-resource pattern already in this controller:

- `listPaymentTerms(req, res)` — `prisma.paymentTerm.findMany({ where: { businessId: req.businessId }, orderBy: { sortOrder: 'asc' } })`.
- `createPaymentTerm(req, res)` — validates `name` (non-empty, ≤50 chars) and `days` (integer ≥ 0); if `isDefault: true` is passed, first clear `isDefault` on every other term for that business in the same request (transaction), then create. Returns 400 on duplicate name (`P2002`) for the business.
- `updatePaymentTerm(req, res)` — same `isDefault` clear-others-first logic when set; otherwise partial update of `name/days/isActive`.
- `deletePaymentTerm(req, res)` — hard delete; no guard against "already used on a document" since the relationship is a snapshot string, not a FK.

Routes in `server/routes/settings.js`, after the existing `/users` block:

```js
router.get('/payment-terms',        ctrl.listPaymentTerms);
router.post('/payment-terms',       authorize('ADMIN', 'MANAGER'), ctrl.createPaymentTerm);
router.put('/payment-terms/:id',    authorize('ADMIN', 'MANAGER'), ctrl.updatePaymentTerm);
router.delete('/payment-terms/:id', authorize('ADMIN', 'MANAGER'), ctrl.deletePaymentTerm);
```

`lib/api.js`, added to the existing `settings` export:

```js
listPaymentTerms:  ()      => api.get('/settings/payment-terms'),
createPaymentTerm: (d)     => api.post('/settings/payment-terms', d),
updatePaymentTerm: (id, d) => api.put(`/settings/payment-terms/${id}`, d),
deletePaymentTerm: (id)    => api.delete(`/settings/payment-terms/${id}`),
```

## Settings UI — `app/(dashboard)/settings/page.jsx`

- New tab entry: `{ key: 'paymentTerms', label: 'Payment Terms', icon: CalendarClock, roles: ['ADMIN', 'MANAGER'] }`, placed after "Numbering" in `TABS`.
- New `{activeTab === 'paymentTerms' && (...)}` section, structured like the existing Users tab: a table (Name | Days | Default | Active | Actions) with inline "+ Add Term" row (Name text input, Days number input) and per-row Edit/Delete/"Set Default" actions. Loaded via a `loadPaymentTerms()` call added to the same `useEffect` that already dispatches on `activeTab` change (alongside `loadUsers`, `loadDbStats`, etc.).
- Add `CalendarClock` to the existing `lucide-react` import list.

## Document forms — Invoice, Bill, Quotation, Purchase Order

All four follow the same change:

1. Fetch active terms once (`settings.listPaymentTerms()`, filter `isActive`, sort by `sortOrder`) when the create/edit modal opens.
2. Add a "Payment Terms" `<select>` next to the existing date-pair fields, bound to `form.paymentTerms` (term **name**, stored directly as the value — simplest since the column itself is a name string, no id indirection needed).
3. Replace the existing hardcoded `+30 days` effect with: on terms-loaded or term-change, compute `baseDate + selectedTerm.days` and write it into the paired date field — same as today's effect, just driven by the selected term's `days` instead of a literal `30`. The date input remains manually editable afterward; changing it does not clear the selected term.
4. New-document default: pre-select the term flagged `isDefault`; if none exists (empty list), fall back to the current literal 30-day behavior unchanged.
5. Detail views and print/email HTML (`printDocument` bodies in each page) gain one line/`info-box` showing the stored `paymentTerms` value next to the existing due/valid/expected date, only rendered when non-empty (so old documents created before this feature show no blank "Payment Terms: —" line).

Per-page field mapping:

| Page | Base date field | Computed field |
|---|---|---|
| `receivable/page.jsx` (Invoice) | `invoiceDate` | `dueDate` |
| `payable/page.jsx` (Bill) | `billDate` | `dueDate` |
| `receivable/quotations/page.jsx` (Quotation) | `quotationDate` | `validUntil` |
| `purchase-orders/page.jsx` (PO) | `orderDate` | `expectedDate` |

## Conversion carry-forward

- `server/controllers/quotationController.js#convert`: currently `const due = dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 86400000);`. Change the fallback so the convert-to-invoice dialog pre-fills from the source quotation's `paymentTerms` (re-look up its `days` from the current `PaymentTerm` list; if the term no longer exists, fall back to the existing 30-day literal) instead of always defaulting to 30. The new Invoice's `paymentTerms` column is set to the same name as the source quotation's. User can still override the date/term in the dialog before confirming.
- `server/controllers/purchaseOrderController.js#convertToBill`: identical change — `dueDate` fallback derives from the PO's stored `paymentTerms` instead of the literal `30 * 86400000`, and the new Bill's `paymentTerms` column inherits the PO's.

## Out of Scope

- No per-Customer/Vendor default payment term — master-list-only per explicit decision during brainstorming.
- No FK/referential integrity between documents and `PaymentTerm` — deliberate snapshot-string design so history never silently changes.
- No installment/split-payment terms (e.g. "50% upfront, 50% on delivery") — each term is one flat day-count.
- No automated late-fee/penalty logic tied to terms — existing overdue badges/highlighting are unchanged.

## Testing

- Settings → Payment Terms: add, edit, toggle active, set default, delete a term; confirm only one `isDefault` can be true per business at a time.
- Create a new Invoice/Bill/Quotation/PO with no terms configured yet → confirm the old hardcoded 30-day behavior is unchanged (no crash on empty list).
- Seed/add terms, create a new Invoice → confirm the default term pre-selects and the due date computes correctly; switch terms → date recomputes; manually edit the date afterward → term selection is preserved and the manual date is not overwritten.
- Save and reopen an existing Invoice/Bill/Quotation/PO → confirm its stored `paymentTerms` label displays correctly in the detail view and print/email output.
- Delete a `PaymentTerm` that's already used on a saved document → confirm the document still shows its original term name unaffected.
- Convert a Quotation (with a term set) to an Invoice → confirm the new Invoice pre-fills the same term/due date; repeat for PO → Bill.
- Rename a `PaymentTerm` in Settings → confirm previously created documents still show the **old** name (snapshot, not live-linked).
