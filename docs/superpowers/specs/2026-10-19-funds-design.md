# Funds (Revolving Fund summary, Marketing Fund) — Design

Group D of the company needs list: #8 summary of the Revolving Fund, #12 pull 10% of net income into a Marketing Fund, #13 marketing expenses auto-deduct from the Marketing Fund.

One page, **Funds** (`/funds`), with two tabs that share one mechanism: a fund is a set of general-ledger asset accounts, and everything on the page is read from posted journal entries.

## Revolving Fund (#8)

- The revolving fund is the existing Petty Cash Fund: GL `1011` (cash) and `1012` (GCash). The accounts are configurable.
- Summary for a date range: opening balance, replenishments (debits to the fund), disbursements (credits), closing balance, per fund account and combined.
- Disbursement breakdown by expense account: for each entry that credits the fund, the expense debit lines of that entry.
- Ledger: every entry touching the fund in the range, with running balance. Downloads: Excel, CSV, Print/PDF.

## Marketing Fund (#12, #13)

- Configuration (stored per business in `SystemSetting` key `fundSettings`): enabled, percent (default 10), fund account code (default `1013`, created on request as "Marketing Fund", ASSET, DEBIT), source cash account for allocations (default `1020`), and the expense categories that draw on the fund (default `ADVERTISING`).
- **Allocation (#12):** for a chosen month, preview and post 10% of that month's net income (the same posted-journal net income as the Profit & Loss report). Entry: DR Marketing Fund / CR source cash account, reference `MKT-ALLOC-YYYY-MM`. Not posted when net income is zero or negative, and a month can be allocated once (a voided allocation can be redone).
- **Auto-deduct (#13):** paying an expense voucher whose category is one of the marketing categories credits the Marketing Fund account instead of cash. An explicit payment account chosen by the user wins. The pay form preselects the fund account for marketing categories. The balance may go negative; the page marks a negative or low fund.
- Marketing tab: balance, allocation history, ledger, and the configuration form.

## API

`GET /api/funds/config`, `PUT /api/funds/config`, `POST /api/funds/marketing/account` (create the fund account),
`GET /api/funds/summary?fund=revolving|marketing&from&to`,
`GET /api/funds/marketing/allocation?month=YYYY-MM` (preview), `POST /api/funds/marketing/allocation {month}`.

## Tasks

D1: fund settings + ledger/summary builders + API + Funds page with the Revolving Fund tab. D2: Marketing Fund config, account creation, allocation preview and posting, Marketing tab. D3: auto-deduct on voucher payment and the pay-form default.
