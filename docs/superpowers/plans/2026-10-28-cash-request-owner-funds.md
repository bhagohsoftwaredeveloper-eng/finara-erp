# Cash Request: Owner's Funds as a Cash Source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Release form's **Cash Source** list the business's company-cash accounts *and* its owner's-funds accounts (e.g. 2540 Due To Owner) from the Chart of Accounts, so an owner-funded advance posts DR 1104 / CR Due To Owner, and replace the "Funded by owner" checkbox.

**Architecture:** One pure rule, `cashSourceKind(account)` in `server/utils/cashAdvance.js`, decides whether an account is company cash (`'CASH'`), the owner's funds (`'OWNER'`) or neither. The server serves both groups from a new `GET /api/cash-requests/cash-sources` endpoint and validates the chosen source on release with the same rule. An owner account is stored in the existing `CashRequest.cashAccountCode` column, so the existing liquidation code already sends sukli/overspend back to it.

**Tech Stack:** Express + Prisma (MySQL), Next.js 14 App Router (React client components), Jest 30.

**Spec:** `docs/superpowers/specs/2026-10-28-cash-request-owner-funds-design.md`

## Global Constraints

- Run Jest **only** with worktree copies excluded: `npx jest <files> --testPathIgnorePatterns "/node_modules/" "\.claude"` (without the ignore, stale copies under `.claude/worktrees/*/tests` run too). Baseline before this plan: 117 suites / 1034 tests, all passing.
- **Never** start `npm run dev` (the user runs it). **Never** run `npm run build` in a directory where the user's dev server is running (it corrupts `.next`).
- No Prisma schema change, no migration, no automatic Chart of Accounts change.
- Cash rule (exact): `CASH` = active `ASSET` whose code is a number from 1010 to 1099; `OWNER` = active `LIABILITY` whose name matches `/\b(owner|stockholder|shareholder|proprietor|partner)/i`; inactive accounts are never a cash source.
- Copy, verbatim:
  - Release credit line description: `Owner funded cash — <requestNo>` for an OWNER source, `Cash released — <requestNo>` otherwise.
  - Ineligible account error: `<code> can't be used as a cash source`
  - Missing account error (existing): `Cash account <code> does not exist`
  - Stale page error: `This page is out of date. Reload it and choose the owner's account under Cash Source.`
  - Empty owner group hint: `To release the owner's own money, add a "Due To Owner" account (type: Liability) in Chart of Accounts.`
  - Owner posting note: `Company cash is not touched. Any sukli or extra spending at liquidation goes back to <code>.`
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the files the task names (the working tree has unrelated changes — never `git add -A`).

---

### Task 1: `cashSourceKind` rule and owner-aware release entry

**Files:**
- Modify: `server/utils/cashAdvance.js` (whole top section, lines 1–36, and the `module.exports` line)
- Test: `tests/cashAdvance.test.js`

**Interfaces:**
- Produces:
  - `cashSourceKind(account) → 'CASH' | 'OWNER' | null` where `account = { accountCode: string, accountType: 'ASSET'|'LIABILITY'|..., accountName: string, isActive?: boolean }`.
  - `buildReleaseEntry({ requestNo, amount, cashAccountCode, sourceKind }) → { lines }` — `sourceKind` is the result of `cashSourceKind`; the `ownerAccountId` parameter is removed.
  - Both exported from `server/utils/cashAdvance.js` alongside the existing `buildLiquidationEntry`, `ADVANCES_ACCOUNT`.

- [ ] **Step 1: Write the failing tests**

In `tests/cashAdvance.test.js`, change line 1 to:

```js
const { buildReleaseEntry, buildLiquidationEntry, cashSourceKind } = require('../server/utils/cashAdvance');
```

Replace the first two tests of `describe('buildReleaseEntry', ...)` (the `'debits 1104 and credits the chosen cash account'` test and the `'owner funded: DR 1104 / CR owner account, company cash untouched'` test, lines 7–21) with:

```js
  test('debits 1104 and credits the chosen cash account', () => {
    const { lines } = buildReleaseEntry({ requestNo: 'CR-000001', amount: 5000, cashAccountCode: '1010', sourceKind: 'CASH' });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: '1104', debit: 5000 });
    expect(lines[1]).toMatchObject({ accountCode: '1010', credit: 5000, description: 'Cash released — CR-000001' });
    expect(sum(lines, 'debit')).toBeCloseTo(sum(lines, 'credit'), 2);
  });

  test("owner source: DR 1104 / CR the owner's account, labelled as owner funded", () => {
    const { lines } = buildReleaseEntry({ requestNo: 'CR-000003', amount: 15000, cashAccountCode: '2540', sourceKind: 'OWNER' });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: '1104', debit: 15000 });
    expect(lines[1]).toMatchObject({ accountCode: '2540', credit: 15000, description: 'Owner funded cash — CR-000003' });
    expect(sum(lines, 'debit')).toBeCloseTo(sum(lines, 'credit'), 2);
  });
```

Add these tests at the end of `describe('buildLiquidationEntry', ...)` (just before its closing `});`):

```js
  test("owner source: sukli goes back to the owner's account", () => {
    const r = buildLiquidationEntry({
      requestNo: 'CR-000003', releasedAmount: 15000, cashAccountCode: '2540',
      lines: [{ accountId: 61, amount: 14000, description: 'Salaries' }],
    });
    expect(r.mode).toBe('RETURN');
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '2540', debit: 1000 }));
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1104', credit: 15000 }));
    expect(isBalanced(r.lines)).toBe(true);
  });

  test('owner source: overspending is owed to the owner', () => {
    const r = buildLiquidationEntry({
      requestNo: 'CR-000003', releasedAmount: 15000, cashAccountCode: '2540',
      lines: [{ accountId: 61, amount: 15500, description: 'Salaries' }],
    });
    expect(r.mode).toBe('REIMBURSE');
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '2540', credit: 500 }));
    expect(isBalanced(r.lines)).toBe(true);
  });

  test("the client's entry: exactly ₱15,000 of salaries clears 1104 with no owner line", () => {
    const r = buildLiquidationEntry({
      requestNo: 'CR-000003', releasedAmount: 15000, cashAccountCode: '2540',
      lines: [{ accountId: 61, amount: 15000, description: 'Salaries' }],
    });
    expect(r.mode).toBe('EXACT');
    expect(r.lines).toEqual([
      expect.objectContaining({ accountId: 61, debit: 15000 }),
      expect.objectContaining({ accountCode: '1104', credit: 15000 }),
    ]);
  });
```

Append a new `describe` block at the end of the file:

```js
describe('cashSourceKind', () => {
  const acct = (accountCode, accountType, accountName, isActive = true) =>
    ({ accountCode, accountType, accountName, isActive });

  test('company cash: active ASSET accounts coded 1010 to 1099', () => {
    expect(cashSourceKind(acct('1010', 'ASSET', 'Cash on Hand'))).toBe('CASH');
    expect(cashSourceKind(acct('1099', 'ASSET', 'Cash in Bank — BPI'))).toBe('CASH');
    expect(cashSourceKind(acct('1000', 'ASSET', 'Current Assets'))).toBeNull();
    expect(cashSourceKind(acct('1100', 'ASSET', 'Accounts Receivable'))).toBeNull();
    expect(cashSourceKind(acct('1104', 'ASSET', 'Advances to Officers & Employees'))).toBeNull();
  });

  test("owner's funds: active LIABILITY accounts named for an owner", () => {
    expect(cashSourceKind(acct('2540', 'LIABILITY', 'Due To Owner'))).toBe('OWNER');
    expect(cashSourceKind(acct('2541', 'LIABILITY', 'Due to Stockholders'))).toBe('OWNER');
    expect(cashSourceKind(acct('2542', 'LIABILITY', 'Loans from Shareholders'))).toBe('OWNER');
    expect(cashSourceKind(acct('2543', 'LIABILITY', 'Due to Proprietor'))).toBe('OWNER');
    expect(cashSourceKind(acct('2544', 'LIABILITY', 'Due to Partners'))).toBe('OWNER');
  });

  test('look-alikes are not cash sources', () => {
    expect(cashSourceKind(acct('2050', 'LIABILITY', "Homeowners' Dues Payable"))).toBeNull();
    expect(cashSourceKind(acct('2010', 'LIABILITY', 'Accounts Payable'))).toBeNull();
    expect(cashSourceKind(acct('1250', 'ASSET', 'Due from Owner'))).toBeNull();
    expect(cashSourceKind(acct('3010', 'EQUITY', "Share Capital / Owner's Capital"))).toBeNull();
  });

  test('inactive accounts never qualify', () => {
    expect(cashSourceKind(acct('1010', 'ASSET', 'Cash on Hand', false))).toBeNull();
    expect(cashSourceKind(acct('2540', 'LIABILITY', 'Due To Owner', false))).toBeNull();
    expect(cashSourceKind(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/cashAdvance.test.js --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: FAIL — `cashSourceKind is not a function` in the `cashSourceKind` tests, and the owner release test fails on the line description (`Cash released — CR-000003` received instead of `Owner funded cash — CR-000003`). The three new liquidation tests already PASS (they pin existing behaviour).

- [ ] **Step 3: Implement**

Replace lines 1–36 of `server/utils/cashAdvance.js` (the header comment, `ADVANCES_ACCOUNT`, and the whole `buildReleaseEntry` function) with:

```js
/**
 * Cash advance accounting rules.
 *
 * Release makes the holder accountable:  DR 1104 / CR the cash source — company
 * cash, or the owner's account when the owner handed over their own money.
 * Liquidation clears that accountability against actual receipts, settling any
 * difference against the same source. Pure functions — no database, no Prisma.
 *
 * Line shape returned matches what glPost.post() accepts:
 *   { accountId?, accountCode?, debit?, credit?, description }
 */

const ADVANCES_ACCOUNT = '1104'; // Advances to Officers & Employees

// Where released cash may come from. CASH is company money (the 1010–1099 range
// the Expenses page also offers as payment accounts); OWNER is the owner's
// personal money, booked as what the company owes them (e.g. 2540 Due To Owner).
const OWNER_NAME = /\b(owner|stockholder|shareholder|proprietor|partner)/i;

function cashSourceKind(account) {
  if (!account || account.isActive === false) return null;
  const code = Number(account.accountCode);
  if (account.accountType === 'ASSET' && Number.isInteger(code) && code >= 1010 && code <= 1099) return 'CASH';
  if (account.accountType === 'LIABILITY' && OWNER_NAME.test(account.accountName || '')) return 'OWNER';
  return null;
}

// sourceKind: cashSourceKind() of the cash source; only changes the wording.
function buildReleaseEntry({ requestNo, amount, cashAccountCode, sourceKind }) {
  const amt = Number(amount);
  if (!(amt > 0)) throw new Error('Released amount must be greater than zero');
  if (!cashAccountCode) throw new Error('A cash account is required to release cash');

  return {
    lines: [
      { accountCode: ADVANCES_ACCOUNT, debit: amt, description: `Cash advance — ${requestNo}` },
      {
        accountCode: cashAccountCode,
        credit: amt,
        description: sourceKind === 'OWNER' ? `Owner funded cash — ${requestNo}` : `Cash released — ${requestNo}`,
      },
    ],
  };
}
```

Change the last line of the file to:

```js
module.exports = { buildReleaseEntry, buildLiquidationEntry, cashSourceKind, ADVANCES_ACCOUNT };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/cashAdvance.test.js --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: PASS, 1 suite, all tests green (the existing `'rejects a missing cash account'` test still passes — the guard is unchanged).

- [ ] **Step 5: Commit**

```bash
git add server/utils/cashAdvance.js tests/cashAdvance.test.js
git commit -m "feat(cash-requests): cashSourceKind rule; owner source labels the release credit

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Cash-source endpoint, release validation, source name on detail

**Files:**
- Modify: `server/controllers/cashRequestController.js` (import line 6; `getOne` lines 63–86; `release` lines 204–292; add `cashSources` after `accountMap`)
- Modify: `server/routes/cashRequests.js` (add one route before `/:id`)
- Modify: `lib/api.js` (`cashRequests` object, after `accountMap`)
- Create: `tests/cashRequestCashSources.test.js`

**Interfaces:**
- Consumes: `cashSourceKind(account)`, `buildReleaseEntry({ requestNo, amount, cashAccountCode, sourceKind })` from Task 1.
- Produces:
  - `GET /api/cash-requests/cash-sources` → `{ cash: [{ id, accountCode, accountName }], owner: [{ id, accountCode, accountName }] }`, each sorted by `accountCode`.
  - `GET /api/cash-requests/:id` response gains `cashAccountName: string | null`.
  - `POST /api/cash-requests/:id/release` no longer reads `fundedByOwnerAccountId` (rejects it with 400).
  - Browser helper `cashRequests.cashSources()` in `lib/api.js`.

- [ ] **Step 1: Write the failing tests**

Create `tests/cashRequestCashSources.test.js`:

```js
jest.mock('../server/config/database', () => ({
  account: { findMany: jest.fn(), findFirst: jest.fn() },
  cashRequest: { findFirst: jest.fn(), update: jest.fn() },
  cashRequestItem: { update: jest.fn() },
  cashDenominationCount: { findMany: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));
jest.mock('../server/utils/cashDenomination', () => ({
  resolveCount: jest.fn().mockResolvedValue(null),
  saveCount: jest.fn(),
}));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/cashRequestController');

const call = async (handler, req) => {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next };
};

beforeEach(() => jest.clearAllMocks());

describe('cashSources', () => {
  test('splits the active ASSET/LIABILITY accounts of this business into cash and owner groups', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 1, accountCode: '1010', accountName: 'Cash on Hand', accountType: 'ASSET', isActive: true },
      { id: 2, accountCode: '1104', accountName: 'Advances to Officers & Employees', accountType: 'ASSET', isActive: true },
      { id: 3, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'LIABILITY', isActive: true },
      { id: 4, accountCode: '2540', accountName: 'Due To Owner', accountType: 'LIABILITY', isActive: true },
    ]);

    const { res } = await call(ctrl.cashSources, { businessId: 9 });

    expect(prisma.account.findMany.mock.calls[0][0].where).toMatchObject({ businessId: 9, isActive: true });
    expect(res.body).toEqual({
      cash:  [{ id: 1, accountCode: '1010', accountName: 'Cash on Hand' }],
      owner: [{ id: 4, accountCode: '2540', accountName: 'Due To Owner' }],
    });
  });
});

describe('release', () => {
  const approved = { id: 5, requestNo: 'CR-000005', requestedFor: 'Juan', status: 'APPROVED', items: [] };
  const req = (body) => ({ params: { id: '5' }, businessId: 9, body, user: { id: 1, name: 'Tester' } });

  beforeEach(() => {
    prisma.cashRequest.findFirst.mockResolvedValue(approved);
    prisma.cashRequest.update.mockResolvedValue({ ...approved, status: 'RELEASED' });
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  });

  test("an owner source posts DR 1104 / CR the owner's account and is stored as the source", async () => {
    prisma.account.findFirst.mockResolvedValue({
      id: 4, accountCode: '2540', accountName: 'Due To Owner', accountType: 'LIABILITY', isActive: true,
    });

    const { res, next } = await call(ctrl.release, req({ releasedAmount: 15000, cashAccountCode: '2540', releasedDate: '2026-10-28' }));

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(prisma.account.findFirst.mock.calls[0][0].where).toEqual({ accountCode: '2540', businessId: 9 });
    expect(glPost.safePost.mock.calls[0][0].lines).toEqual([
      expect.objectContaining({ accountCode: '1104', debit: 15000 }),
      expect.objectContaining({ accountCode: '2540', credit: 15000, description: 'Owner funded cash — CR-000005' }),
    ]);
    expect(prisma.cashRequest.update.mock.calls[0][0].data).toMatchObject({ status: 'RELEASED', cashAccountCode: '2540' });
  });

  test('rejects an account that is not a cash source, before writing anything', async () => {
    prisma.account.findFirst.mockResolvedValue({
      id: 3, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'LIABILITY', isActive: true,
    });

    const { next } = await call(ctrl.release, req({ releasedAmount: 100, cashAccountCode: '2010' }));

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400, message: "2010 can't be used as a cash source" });
    expect(prisma.cashRequest.update).not.toHaveBeenCalled();
    expect(glPost.safePost).not.toHaveBeenCalled();
  });

  test('rejects the old "funded by owner" payload sent by a stale page', async () => {
    const { next } = await call(ctrl.release, req({ releasedAmount: 100, cashAccountCode: '1010', fundedByOwnerAccountId: 4 }));

    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 400,
      message: "This page is out of date. Reload it and choose the owner's account under Cash Source.",
    });
    expect(prisma.cashRequest.update).not.toHaveBeenCalled();
    expect(glPost.safePost).not.toHaveBeenCalled();
  });
});

describe('getOne', () => {
  test("includes the cash source's account name, looked up in this business", async () => {
    prisma.cashRequest.findFirst.mockResolvedValue({ id: 5, cashAccountCode: '2540', items: [], liquidation: null });
    prisma.cashDenominationCount.findMany.mockResolvedValue([]);
    prisma.account.findFirst.mockResolvedValue({ accountName: 'Due To Owner' });

    const { res } = await call(ctrl.getOne, { params: { id: '5' }, businessId: 9 });

    expect(res.body.cashAccountName).toBe('Due To Owner');
    expect(prisma.account.findFirst.mock.calls[0][0].where).toEqual({ businessId: 9, accountCode: '2540' });
  });

  test('cashAccountName is null before release', async () => {
    prisma.cashRequest.findFirst.mockResolvedValue({ id: 6, cashAccountCode: null, items: [], liquidation: null });
    prisma.cashDenominationCount.findMany.mockResolvedValue([]);

    const { res } = await call(ctrl.getOne, { params: { id: '6' }, businessId: 9 });

    expect(res.body.cashAccountName).toBeNull();
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/cashRequestCashSources.test.js --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: FAIL — `ctrl.cashSources is not a function`; the owner release test fails (no `Owner funded cash` description); the ineligible-account test fails (release currently accepts any account); the stale-payload test fails (release currently honours `fundedByOwnerAccountId`); `cashAccountName` is `undefined`.

- [ ] **Step 3: Implement the controller changes**

In `server/controllers/cashRequestController.js`:

Line 6 becomes:

```js
const { buildReleaseEntry, buildLiquidationEntry, cashSourceKind } = require('../utils/cashAdvance');
```

In `exports.getOne`, replace

```js
    res.json({ ...cr, denominationCounts });
```

with

```js
    const cashAccount = cr.cashAccountCode
      ? await prisma.account.findFirst({
          where: { businessId: req.businessId, accountCode: cr.cashAccountCode },
          select: { accountName: true },
        })
      : null;
    res.json({ ...cr, denominationCounts, cashAccountName: cashAccount?.accountName ?? null });
```

Replace the start of `exports.release` — from `const { releasedAmount, cashAccountCode, ...` through the `}).catch((e) => { throw createError(e.message, e.status || 400); });` that ends the `count` statement (currently lines 208–243) — with:

```js
    const { releasedAmount, cashAccountCode, releasedBy, releasedDate, items, denominations } = req.body;

    // A Release form loaded before Cash Source listed the owner's accounts still
    // sends the old checkbox, with company cash as its cashAccountCode. Posting
    // that would credit the wrong account, so make the user reload instead.
    if (req.body.fundedByOwnerAccountId) {
      throw createError("This page is out of date. Reload it and choose the owner's account under Cash Source.", 400);
    }

    const cr = await prisma.cashRequest.findFirst({
      where: { id, businessId: req.businessId },
      include: { items: true },
    });
    if (!cr) throw createError('Cash request not found', 404);
    if (cr.status !== 'APPROVED') throw createError('Only APPROVED requests can be released', 400);

    const amount = Number(releasedAmount);
    if (!(amount > 0)) throw createError('Released amount must be greater than zero', 400);
    if (!cashAccountCode) throw createError('Select the cash account the money comes from', 400);

    const cashAccount = await prisma.account.findFirst({
      where: { accountCode: String(cashAccountCode), businessId: req.businessId },
      select: { id: true, accountCode: true, accountName: true, accountType: true, isActive: true },
    });
    if (!cashAccount) throw createError(`Cash account ${cashAccountCode} does not exist`, 400);
    const sourceKind = cashSourceKind(cashAccount);
    if (!sourceKind) throw createError(`${cashAccountCode} can't be used as a cash source`, 400);

    // Throws on bad input before anything is written
    const { lines } = buildReleaseEntry({ requestNo: cr.requestNo, amount, cashAccountCode, sourceKind });

    // Cash handed over must be counted by denomination when the business enables
    // it. resolveCount returns null for anything that isn't physical cash, so an
    // owner source never asks for a count.
    const count = await resolveCount({
      businessId: req.businessId, accountCode: cashAccountCode, amount, denominations,
    }).catch((e) => { throw createError(e.message, e.status || 400); });
```

(The rest of `release` — `requestItemIds` onward — is unchanged. It already writes `cashAccountCode: String(cashAccountCode)` and calls `glPost.safePost` with `lines`.)

Add this handler directly after `exports.accountMap = ...;`:

```js
// The Release form's Cash Source list: company cash and the owner's personal
// funds, decided by the same rule release() enforces.
exports.cashSources = async (req, res, next) => {
  try {
    const accounts = await prisma.account.findMany({
      where: { businessId: req.businessId, isActive: true, accountType: { in: ['ASSET', 'LIABILITY'] } },
      select: { id: true, accountCode: true, accountName: true, accountType: true, isActive: true },
      orderBy: { accountCode: 'asc' },
    });
    const pick = (kind) => accounts
      .filter((a) => cashSourceKind(a) === kind)
      .map(({ id, accountCode, accountName }) => ({ id, accountCode, accountName }));
    res.json({ cash: pick('CASH'), owner: pick('OWNER') });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Register the route and the browser helper**

In `server/routes/cashRequests.js`, add after `router.get('/account-map',  ctrl.accountMap);`:

```js
router.get('/cash-sources', ctrl.cashSources);
```

In `lib/api.js`, inside `export const cashRequests = {`, add after the `accountMap:` line:

```js
  cashSources:  ()         => api.get('/cash-requests/cash-sources'),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/cashRequestCashSources.test.js tests/cashAdvance.test.js tests/cashRequestResolveLineAccounts.test.js --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: PASS, 3 suites.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/cashRequestController.js server/routes/cashRequests.js lib/api.js tests/cashRequestCashSources.test.js
git commit -m "feat(cash-requests): cash-sources endpoint; release accepts only cash or owner accounts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Release, Liquidate and print screens use the grouped Cash Source

**Files:**
- Modify: `app/(dashboard)/cash-requests/page.jsx`

**Interfaces:**
- Consumes: `crApi.cashSources()` → `{ data: { cash: [...], owner: [...] } }` and `cr.cashAccountName` from Task 2.
- Produces: no new exports.

This task is UI only; there is no Jest test for it. Verification is a careful re-read plus the checks in Task 4.

- [ ] **Step 1: Remove the hardcoded list and add the default-source helper**

Replace

```js
const CASH_ACCOUNTS = [
  { code: '1010', label: '1010 — Cash on Hand' },
  { code: '1011', label: '1011 — Petty Cash Fund' },
  { code: '1012', label: '1012 — Cash — GCash' },
  { code: '1020', label: '1020 — Cash in Bank (BDO Checking)' },
];
```

with

```js
// Cash Source defaults to 1010 when the business has it, else the first account listed.
const defaultSourceCode = (sources) => {
  const all = [...sources.cash, ...sources.owner];
  return (all.find((a) => a.accountCode === '1010') || all[0])?.accountCode || '';
};
```

- [ ] **Step 2: Rewrite the top of `ReleaseModal`**

Replace

```js
function ReleaseModal({ request, accounts, accountMap, onClose, onDone }) {
  const [form, setForm] = useState({
    releasedAmount:  String(request.requestedAmount),
    cashAccountCode: '1010',
    releasedDate:    todayStr(),
    releasedBy:      '',
  });
  // Optional: the owner supplied the cash (DR cash / CR owner account).
  const [ownerFunded, setOwnerFunded] = useState(false);
  const [ownerAccountId, setOwnerAccountId] = useState(() => {
    const a = accounts.find((x) => x.accountCode === '2540');
    return a ? String(a.id) : '';
  });
```

with

```js
function ReleaseModal({ request, accounts, accountMap, sources, onClose, onDone }) {
  const [form, setForm] = useState({
    releasedAmount:  String(request.requestedAmount),
    cashAccountCode: defaultSourceCode(sources),
    releasedDate:    todayStr(),
    releasedBy:      '',
  });
  // The source list may arrive after the modal opened.
  useEffect(() => {
    if (form.cashAccountCode) return;
    const code = defaultSourceCode(sources);
    if (code) setForm((f) => ({ ...f, cashAccountCode: code }));
  }, [sources, form.cashAccountCode]);
  const source   = [...sources.cash, ...sources.owner].find((a) => a.accountCode === form.cashAccountCode);
  const isOwner  = sources.owner.some((a) => a.accountCode === form.cashAccountCode);
  const advances = accounts.find((a) => a.accountCode === '1104');
```

- [ ] **Step 3: Simplify `submit` in `ReleaseModal`**

Replace

```js
    if (dn.error && !ownerFunded) { toast.error(dn.error); return; }
    if (ownerFunded && !ownerAccountId) { toast.error('Select the owner account'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        fundedByOwnerAccountId: ownerFunded ? Number(ownerAccountId) : null,
        denominations: dn.lines,
```

with

```js
    if (!form.cashAccountCode) { toast.error('Select the Cash Source'); return; }
    if (dn.error) { toast.error(dn.error); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        denominations: dn.lines,
```

- [ ] **Step 4: Replace the Cash Source field, the counter condition, the checkbox and the posting note**

Replace

```jsx
            <div className="form-group">
              <label className="label">Cash Source *</label>
              <select className="select" required value={form.cashAccountCode}
                onChange={(e) => setForm((f) => ({ ...f, cashAccountCode: e.target.value }))}>
                {CASH_ACCOUNTS.map((a) => <option key={a.code} value={a.code}>{a.label}</option>)}
              </select>
            </div>

            {dn.required && !ownerFunded && (
              <DenominationCounter {...dn.counterProps} title="Count the cash being released" />
            )}
```

with

```jsx
            <div className="form-group">
              <label className="label">Cash Source *</label>
              <select className="select" required value={form.cashAccountCode}
                onChange={(e) => setForm((f) => ({ ...f, cashAccountCode: e.target.value }))}>
                {!form.cashAccountCode && <option value="">— select —</option>}
                {sources.cash.length > 0 && (
                  <optgroup label="Company cash">
                    {sources.cash.map((a) => (
                      <option key={a.id} value={a.accountCode}>{a.accountCode} — {a.accountName}</option>
                    ))}
                  </optgroup>
                )}
                {sources.owner.length > 0 && (
                  <optgroup label="Owner's personal funds">
                    {sources.owner.map((a) => (
                      <option key={a.id} value={a.accountCode}>{a.accountCode} — {a.accountName}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              {sources.owner.length === 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  To release the owner&apos;s own money, add a &quot;Due To Owner&quot; account (type: Liability) in Chart of Accounts.
                </p>
              )}
            </div>

            {dn.required && (
              <DenominationCounter {...dn.counterProps} title="Count the cash being released" />
            )}
```

Then replace

```jsx
            <div className="form-group">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={ownerFunded}
                  onChange={(e) => setOwnerFunded(e.target.checked)} />
                Funded by owner (owner supplied this cash)
              </label>
              {ownerFunded && (
                <div className="mt-2">
                  <label className="label">Owner Account *</label>
                  <AccountSelect value={ownerAccountId} onChange={setOwnerAccountId}
                    accounts={accounts} placeholder="— e.g. Due To Owner —" />
                </div>
              )}
            </div>

            <p className="text-xs text-gray-500">
              Posts <strong>DR 1104 Advances</strong> / <strong>CR {ownerFunded ? 'Owner account' : form.cashAccountCode}</strong>.
              The amount stays outstanding until liquidated.
              {ownerFunded && ' Company cash is not touched; Cash Source is only used for any change or reimbursement at liquidation.'}
            </p>
```

with

```jsx
            <p className="text-xs text-gray-500">
              Posts <strong>DR 1104 {advances?.accountName || 'Advances'}</strong> /{' '}
              <strong>CR {form.cashAccountCode} {source?.accountName || ''}</strong>.
              {' '}The amount stays outstanding until liquidated.
              {isOwner && ` Company cash is not touched. Any sukli or extra spending at liquidation goes back to ${form.cashAccountCode}.`}
            </p>
```

- [ ] **Step 5: Name the account in the Liquidate summary**

In `LiquidateModal`, directly after the line `const variance = Number((spent - released).toFixed(2));`, add:

```js
  // Sukli and reimbursement settle against the account the cash came from.
  const sourceName  = accounts.find((a) => a.accountCode === request.cashAccountCode)?.accountName;
  const sourceLabel = `${request.cashAccountCode}${sourceName ? ` ${sourceName}` : ''}`;
```

Then replace

```jsx
                  <span>{variance < 0 ? 'Sukli to return' : variance > 0 ? 'Reimburse' : 'Exact'}</span>
                  <span>{formatCurrency(Math.abs(variance))}</span>
                </div>
```

with

```jsx
                  <span>{variance < 0 ? 'Sukli to return' : variance > 0 ? 'Reimburse' : 'Exact'}</span>
                  <span>{formatCurrency(Math.abs(variance))}</span>
                </div>
                {variance !== 0 && (
                  <p className="text-xs text-gray-500 text-right">
                    {variance < 0 ? 'Goes back to' : 'Paid from'} {sourceLabel}
                  </p>
                )}
```

(This exact `<span>…Sukli to return…</span>` block appears only in `LiquidateModal`; the Detail modal uses the past tense "Sukli returned".)

- [ ] **Step 6: Show the account name in the printout**

In `printCashRequestForm`, replace

```js
      <div class="info-box"><div class="info-lbl">Cash Source</div><div class="info-val mono">${cr.cashAccountCode || '—'}</div></div>
```

with

```js
      <div class="info-box"><div class="info-lbl">Cash Source</div><div class="info-val mono">${cr.cashAccountCode ? `${cr.cashAccountCode}${cr.cashAccountName ? ` — ${cr.cashAccountName}` : ''}` : '—'}</div></div>
```

- [ ] **Step 7: Load the sources on the page and pass them to the Release modal**

In `CashRequestsPage`, after `const [accountMap, setAccountMap] = useState({ rules: [], fallback: '6390' });` add:

```js
  const [sources, setSources] = useState({ cash: [], owner: [] });
```

After the `useEffect` that calls `crApi.accountMap()`, add:

```js
  useEffect(() => {
    crApi.cashSources()
      .then((r) => setSources(r.data))
      .catch(() => setSources({ cash: [], owner: [] }));
  }, []);
```

Replace

```jsx
        <ReleaseModal request={modal.request} accounts={accounts} accountMap={accountMap}
```

with

```jsx
        <ReleaseModal request={modal.request} accounts={accounts} accountMap={accountMap} sources={sources}
```

- [ ] **Step 8: Self-check the file**

Run: `grep -n "CASH_ACCOUNTS\|ownerFunded\|ownerAccountId\|fundedByOwner" "app/(dashboard)/cash-requests/page.jsx"`
Expected: no output.

Run: `grep -n "useEffect" "app/(dashboard)/cash-requests/page.jsx" | head -2`
Expected: line 2 already imports `useEffect` (`import { useState, useEffect, useCallback } from 'react';`) — no import change needed. `AccountSelect` is still used by the item rows, so its import stays.

- [ ] **Step 9: Commit**

```bash
git add "app/(dashboard)/cash-requests/page.jsx"
git commit -m "feat(cash-requests): grouped Cash Source with owner's funds; drop the owner checkbox

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Verification

**Files:** none changed.

- [ ] **Step 1: Full test suite**

Run: `npx jest --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: all suites pass (baseline 117 suites / 1034 tests, plus the new ones).

- [ ] **Step 2: Compile check of the page**

Only if working in an isolated worktree where nobody runs `npm run dev`: copy the main checkout's `.env` into the worktree, then run `npm run build`. Expected: `✓ Compiled successfully` and `/cash-requests` in the route list. If the user's dev server is running from this directory, skip the build and ask the user to load `/cash-requests` instead.

- [ ] **Step 3: Live check (with the user)**

Ask the user (dev server is theirs) to open Cash Requests, click **Release** on an APPROVED request and confirm:
1. Cash Source shows a "Company cash" group (1010, 1011, 1012, 1020 …) and, if the business has a Due To Owner liability, an "Owner's personal funds" group; otherwise the hint text appears under the field.
2. Choosing the owner account hides the denomination counter and the note reads "Posts DR 1104 Advances to Officers & Employees / CR 2540 Due To Owner. … goes back to 2540."
3. Do **not** release a real request without the user's go-ahead; if they agree to a test release, use a throwaway request (e.g. requested for "TEST — safe to delete", ₱1.00) and confirm the journal entry is DR 1104 / CR 2540.
