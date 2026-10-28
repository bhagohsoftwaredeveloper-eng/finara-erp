# Cash Request: Owner's Funds as a Cash Source (Design)

Some advances are paid out of the bosses' personal accounts, not company cash. For those, the client wants:

| Step | Entry |
|---|---|
| Release | DR 1104 / CR Due To Owner |
| Liquidation | DR expense (e.g. 6110 Salaries) / CR 1104 |

The Release form can already post this through a "Funded by owner" checkbox (commit 1bb2a9f). The client looked under **Cash Source** instead. That field is a hardcoded list (1010, 1011, 1012, 1020), so accounts added to the COA never appear in it.

Change: Cash Source becomes the one place to choose where the money came from. It lists the business's company-cash accounts and owner's-funds accounts from the COA, and the checkbox is removed.

## Rule: which accounts can be a cash source

`cashSourceKind(account)` in `server/utils/cashAdvance.js` (pure) returns `'CASH'`, `'OWNER'` or `null`. Inactive accounts are always `null`.

- `CASH`: an ASSET whose code is a number from 1010 to 1099. This is the range the Expenses page already uses for its payment account.
- `OWNER`: a LIABILITY with a word in its name starting with owner, stockholder, shareholder, proprietor or partner: `/\b(owner|stockholder|shareholder|proprietor|partner)/i`. It matches "Due To Owner" and "Due to Stockholders" but not "Homeowners' Dues Payable".

## Accounting

An owner account is stored in `CashRequest.cashAccountCode` like any other source, so no new posting logic is needed.

- Release: DR 1104 / CR source. The credit line reads "Owner funded cash — CR-x" for an OWNER source and "Cash released — CR-x" otherwise.
- Liquidation (unchanged): DR expenses / CR 1104. Sukli is DR source and overspend is CR source, so for an owner source both go back to the owner.
- Denomination counts only apply to 1010 and 1011 (`isPhysicalCash`). An owner source never asks for one, at release or at liquidation.

Removed: `fundedByOwnerAccountId`, the `ownerAccountId` branch of `buildReleaseEntry`, and the checkbox and owner picker on the form.

## API

- `GET /api/cash-requests/cash-sources` returns `{ cash: [...], owner: [...] }` for the current business. Each entry is `{ id, accountCode, accountName }`, sorted by code. Register the route before `/:id`.
- `POST /api/cash-requests/:id/release`:
  - `cashAccountCode` must be an account of this business with a non-null `cashSourceKind`. A missing account returns 400 "Cash account X does not exist". An ineligible account returns 400 "X can't be used as a cash source".
  - A body that still contains `fundedByOwnerAccountId` (a page loaded before this change) returns 400 "This page is out of date. Reload it and choose the owner's account under Cash Source." This keeps a stale tab from silently crediting 1010.
- `GET /api/cash-requests/:id` adds `cashAccountName`: the name of the `cashAccountCode` account, or null.

## UI (`app/(dashboard)/cash-requests/page.jsx`)

Release modal:
- **Cash Source:** a select with two optgroups, "Company cash" and "Owner's personal funds". The page loads it once from `cash-sources`. It defaults to 1010 when present, otherwise to the first account in the list.
- **Empty owner group:** a hint appears under the field: "To release the owner's own money, add a "Due To Owner" account (type: Liability) in Chart of Accounts."
- **Posting line:** "Posts DR 1104 Advances / CR <code> <name>." For an owner source it adds: "Company cash is not touched. Any sukli or extra spending at liquidation goes back to <code>."

Liquidate modal: the variance label names the account the difference posts to, e.g. "Sukli to return → 2540 Due To Owner".

Print: Cash Source shows the code and name, e.g. "2540 — Due To Owner".

## Out of scope

- **Requests released with the old checkbox and not yet liquidated:** these saved 1010 as their source, so their sukli or overspend still posts to company cash. Check production for any and correct them by hand.
- **No schema change, migration, or automatic COA change:** the client adds a "Due To Owner" (Liability) account to their own COA.

## Tests

- `cashSourceKind` covers:
  - the 1010–1099 boundaries (1000 and 1100 are excluded)
  - each owner keyword
  - "Homeowners" (no match)
  - an inactive account
  - an ASSET named "Owner" (no match)
  - a LIABILITY without a keyword (no match)
- `buildReleaseEntry`:
  - an owner source posts DR 1104 / CR 2540 with the owner description
  - a cash source is unchanged
- `buildLiquidationEntry` with source 2540: sukli posts DR 2540 and overspend posts CR 2540.
- Controller:
  - `release` rejects an ineligible code and rejects `fundedByOwnerAccountId`
  - `cashSources` returns only active accounts of the current business, split into the two groups

## Tasks

1. `cashSourceKind`, the `buildReleaseEntry` change, and unit tests.
2. Controller (`cashSources`, release validation, `cashAccountName` on `getOne`), the route, the `lib/api.js` helper, and controller tests.
3. Page: grouped Cash Source with the hint, checkbox removed, liquidation label, and print name.
