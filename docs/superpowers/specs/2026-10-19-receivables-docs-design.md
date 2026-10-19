# Receivables Docs — Design

Group A of the company needs list: #1 Aging, #3 Terms, #4 Delivery Receipt, #5 SOA per Customer.
Build order: Terms → Aging → SOA → Delivery Receipt (later items depend on Terms).

## 1. Payment Terms (#3)

- New model `PaymentTerm`: `businessId`, `name` (e.g. "Net 30"), `days` (0 = COD), `isActive`. Unique on (`businessId`, `name`).
- Seeded per business: COD (0), Net 15, Net 30, Net 60.
- Settings panel to add, edit and disable terms. Disabled terms stay on existing documents but cannot be picked for new ones.
- `Customer.defaultTermId` (optional).
- `Invoice.termId` (optional) plus snapshots `termsName` and `termsDays`, so editing a term later does not change issued invoices.
- Invoice form: terms dropdown defaults from the customer. Changing invoice date or terms recomputes `dueDate` = invoiceDate + days. `dueDate` stays manually editable.
- Existing invoices keep a blank term and their current `dueDate`.
- Terms name shows on invoice print, SOA and aging.
- Due-date computation lives in one shared util with unit tests.

## 2. AR Aging (#1)

- Same buckets: Current, 1-30, 31-60, 61-90, Over 90.
- Due date now comes from Terms.
- Added: as-of date filter, toggle "Age by due date / invoice date", Terms column, Excel/CSV export, link to the customer's SOA.
- Bucket logic is shared with SOA so both report identical numbers.

## 3. SOA per Customer (#5)

- New page `/receivable/statements`; nav entry under Accounts Receivable.
- Inputs: customer or "All customers", as-of date, mode toggle.
- **Open items:** unpaid/partial invoices with invoice no., date, terms, due date, total, paid, balance; aging summary and total due at the bottom.
- **Full ledger:** from/to range, opening balance, invoices as debits, payments as credits, running balance.
- Excluded: VOID invoices; payments with status PENDING or REVERSED.
- Print via `printDocument`. "All customers" prints one statement per customer with a balance, page break between them.
- API: `GET /api/receivable/statements?customerId&asOf&mode&from&to`. Logic in a util with unit tests.

## 4. Delivery Receipt (#4)

One `DeliveryReceipt` document covers three flows:

- **A, from invoice:** "Create DR" on an invoice copies lines (no prices), links `invoiceId`.
- **B, standalone then invoice:** create DR first, then "Convert to Invoice" copies lines; user fills prices and accounts.
- **C, stock deduction:** per-DR checkbox "Deduct from inventory". When marked DELIVERED, linked inventory items get an OUT `InventoryTransaction`. Cancelling a delivered DR posts RETURN_IN.

Fields: DR no. (DR-000001), date, customer, delivery address, driver/courier, vehicle/plate, notes, status (DRAFT, DELIVERED, CANCELLED), optional `invoiceId`.
Lines (`DeliveryReceiptLine`): optional `itemId`, description, quantity, unit. No prices.
Print: A4 via `printDocument`, with Prepared by / Delivered by / Received by (name, signature, date).
Invoice shows linked DR numbers; delivery status moves to SHIPPED when a linked DR is delivered.

Invoices do not touch inventory today (only Cash Sales do), so a DR stock-out cannot double-deduct. Open for the plan to verify: whether Cash Sales posts a COGS journal on stock-out, and if so whether DR should do the same.

## Testing

Unit tests (existing `tests/` setup) for due-date computation, aging buckets, SOA balances (open items and ledger), and DR stock deduct/restore.
