# Sales Summary — Design

Group B of the company needs list: #6 weekly/monthly sales summary (downloadable) and #7 sales summary per account with a comparative of up to 3 months.

New page **Reports > Sales Summary** (`/reports/sales-summary`). The existing Sales Report (transaction listing) is unchanged.

## Data rules

- Sources: Invoices (by `invoiceDate`) and Cash Sales (by `saleDate`). VOID documents are excluded.
- Amounts are **net sales, excluding VAT**. Invoice `subtotal`/line `amount` and cash sale `subtotal`/item `amount` are already VAT-exclusive; contra-revenue lines (discounts, returns) are stored negative, so they reduce totals with no special handling.
- A document is normalized to `{ source, date, customer, subtotal, vatAmount, total, lines: [{ account, description, amount }] }`.
  - Invoice line account = the line's revenue account. Cash sale line account = the sale's account.
  - Customer = invoice customer name; cash sale `buyerName`, or "Walk-in" when empty.
  - Item = the line description (trimmed, case-insensitive). Invoice lines have no item link, and for stocked items the description defaults to the item name.

## Tab 1: By Period (#6)

- Inputs: from, to, group by Daily / Weekly (Monday-Sunday) / Monthly / Quarterly / Yearly.
- One row per period between from and to, including empty periods: `# sales, Net Sales, VAT, Total`; grand total row.
- Documents outside [from, to] are not counted, so a period at the edge of the range holds only the part inside it.

## Tab 2: Comparative (#7)

- Inputs: View by Revenue account / Customer / Item, and 1 to 3 date ranges chosen by a preset:
  - **Last 3 months**: the selected month and the two before it.
  - **This vs previous period**: the range and the same-length range immediately before it.
  - **Custom**: up to 3 ranges entered by hand.
- Ranges are ordered oldest to newest. One row per account / customer / item, sorted by total descending; one column per range; `Total`; `Change` = newest minus previous range (amount and %). `%` is blank when the previous value is 0. Grand total row. With one range there is no Change.
- Account and Item rows are sums of document lines; Customer rows are sums of document subtotals, so every view totals to the same net sales.

## API

`GET /api/reports/sales-summary`
- `mode=period&from&to&groupBy=day|week|month|quarter|year`
- `mode=compare&dimension=account|customer|item&ranges=<from>:<to>,<from>:<to>[,<from>:<to>]` (1 to 3, each from <= to)

Pure functions (`server/utils/salesSummary.js`, unit tested): `normalizeDocs`, `periodStart`, `summarizeByPeriod`, `summarizeComparison`. Shared range helpers (`lib/salesRanges.js`): `monthRanges`, `previousRange`.

## Downloads

Excel (`exportToExcel`), CSV (`exportToCSV`) and Print/PDF (`printDocument`) from both tabs, using the existing helpers in `lib/export.js` and `lib/print.js`.

## Tasks

1. `lib/salesRanges.js` + tests.
2. `server/utils/salesSummary.js` + tests.
3. Controller, route, API client, and a controller test.
4. Page, downloads, sidebar entry.
