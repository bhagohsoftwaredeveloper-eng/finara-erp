# P&L and Expenses Summary — Design

Group C of the company needs list: #9 P&L with code per driver (repairs and maintenance), #10 P&L comparative, #11 Expenses summary. Built in three parts.

## C1. Driver and Vehicle tags

- New masters, per business: `Driver` (`code`, `name`, `isActive`) and `Vehicle` (`code`, `description`, `isActive`; the code is the plate or truck number). Unique on (`businessId`, `code`). Managed in Settings > Drivers & Vehicles, with quick-add from every picker.
- `driverId` and `vehicleId` (both optional) on: `JournalLine`, `ExpenseVoucherItem`, `BillLine`. Reports read the tags from `JournalLine`, so they come from the general ledger.
- Tag entry points: Expense Voucher line items, Vendor Bill lines, manual Journal Entry lines. Not in scope: Cash Requests, Payroll.
- Posting: `glPost` lines accept `driverId` / `vehicleId` and store them. Paying an expense voucher copies each item's tags onto its expense (debit) line; creating or editing a bill copies each bill line's tags onto its expense line. The payable/cash side carries no tag.
- Existing journal lines have no tags and show as "Untagged". Nothing is back-filled.

## C2. Profit & Loss (#9, #10)

New page Reports > Profit & Loss. The existing Income Statement is unchanged.

- **By Driver / Vehicle:** rows are revenue, COGS, operating and other-expense accounts (section subtotals, net income); columns are each driver (or vehicle) code, `Untagged` and `Total`. Optional filter to one driver or vehicle.
- **Comparative:** the same statement with up to 3 period columns (Last 3 months, This vs previous period, Custom; the presets of the Sales Summary) plus `Change` (amount and %) between the newest and the previous period.
- Source: POSTED journal entries by `entryDate`. Account sections follow the existing Income Statement rules (4xxx revenue, 5xxx COGS, 6xxx opex, 7xxx other expense; revenue accounts outside 4000-4499 count as other income).
- Downloads: Excel, CSV, Print/PDF.

## C3. Expenses Summary (#11)

New page Reports > Expenses Summary: EXPENSE-type accounts for a period grouped by Account, Driver, Vehicle or Month, with an optional account filter (for example Repairs & Maintenance), a total row and downloads.

## Tasks

C1: (1) schema + migration; (2) Driver/Vehicle API; (3) `glPost` tag pass-through; (4) tags on expense vouchers; (5) tags on bills; (6) tags on manual journals; (7) shared tag picker with quick-add, wired into the three forms; (8) Settings tab.
C2: P&L builders + endpoint + page. C3: expenses summary endpoint + page.
