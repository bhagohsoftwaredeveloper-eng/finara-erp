# AR Aging Upgrade Implementation Plan (Receivables Docs, Phase 2 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AR Aging gets an "as of" date, an "age by due date / invoice date" toggle, the invoice's Terms in the detail rows, and one shared aging calculation that the SOA (phase 3) reuses.

**Architecture:** One CommonJS module `lib/arAging.js` (buckets, day math, as-of balance, `buildAging`) is required by the Express controller and by the Next.js aging page, replacing the two hand-copied bucket calculations that exist today. The controller loads non-void invoices dated on or before the as-of date together with their payments and hands them to `buildAging`.

**Tech Stack:** Express + Prisma 5, Next.js 14, Jest.

Spec: `docs/superpowers/specs/2026-10-19-receivables-docs-design.md` (section 2).

**Spec deviation found while planning:** the aging page already has Excel export and per-customer statement print/Excel (open invoices with payment history). This phase does not rebuild them; it only adds the Terms to them. The "Excel/CSV export" item in the spec is therefore already satisfied.

**Prerequisite:** Phase 1 (`2026-10-19-receivables-1-terms.md`) merged: invoices carry `termsName`.

## Global Constraints

- Work in the same isolated worktree as phase 1. The main working tree has uncommitted user changes in `server/controllers/receivableController.js`, `app/(dashboard)/receivable/page.jsx`, `lib/api.js`, `components/layout/Sidebar.jsx`, `lib/print.js`; never `git add` those from the main tree. No `isolation: "worktree"` for subagents inside the worktree.
- Every Prisma query is scoped by `req.businessId`.
- The user owns the dev server; never start a competing one, never run `next build` where it runs.
- Today's date is the Philippine date (UTC+8), not the server's local date.
- Bucket labels stay exactly: `Current`, `1-30 days`, `31-60 days`, `61-90 days`, `Over 90 days`.
- Tests: `npx jest tests/<file>.test.js`. Commits list explicit paths and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: Shared aging module

**Files:**
- Create: `lib/arAging.js`
- Test: `tests/arAging.test.js`

**Interfaces:**
- Produces (CommonJS; dates are `'YYYY-MM-DD'` strings or `Date`/ISO strings):
  - `AR_BUCKETS: string[]`
  - `todayPH(now?: number): string`
  - `daysBetween(from, to): number` (whole days, `to - from`, can be negative)
  - `bucketForDays(days: number): string`
  - `ageOf(inv: { dueDate, invoiceDate }, asOf: string, basis?: 'due'|'invoice'): { days: number, bucket: string }` (days is never below 0)
  - `paidAsOf(inv: { paidAmount, payments? }, asOf: string): number`
  - `buildAging(invoices, { asOf, basis?, customerNames? }): { items, summary, total }` where each item is `{ invoiceNo, customerId, customer, invoiceDate, dueDate, termsName, total, paid, outstanding, daysOverdue, bucket, notes }`.

- [ ] **Step 1: Write the failing tests** (`tests/arAging.test.js`)

```js
const {
  AR_BUCKETS, todayPH, daysBetween, bucketForDays, ageOf, paidAsOf, buildAging,
} = require('../lib/arAging');

describe('bucketForDays', () => {
  test.each([
    [0, 'Current'], [1, '1-30 days'], [30, '1-30 days'], [31, '31-60 days'],
    [60, '31-60 days'], [61, '61-90 days'], [90, '61-90 days'], [91, 'Over 90 days'],
  ])('%i days -> %s', (days, bucket) => {
    expect(bucketForDays(days)).toBe(bucket);
  });

  test('bucket list order is fixed', () => {
    expect(AR_BUCKETS).toEqual(['Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days']);
  });
});

describe('todayPH', () => {
  test('uses the Philippine date, which is ahead of UTC by 8 hours', () => {
    // 2026-01-31 17:00 UTC is already 2026-02-01 01:00 in Manila
    expect(todayPH(Date.UTC(2026, 0, 31, 17, 0))).toBe('2026-02-01');
    expect(todayPH(Date.UTC(2026, 0, 31, 15, 59))).toBe('2026-01-31');
  });
});

describe('daysBetween', () => {
  test('counts whole days and accepts Date objects', () => {
    expect(daysBetween('2026-01-10', '2026-02-09')).toBe(30);
    expect(daysBetween(new Date('2026-01-10T00:00:00Z'), '2026-01-09')).toBe(-1);
  });
});

describe('ageOf', () => {
  const inv = { invoiceDate: '2026-01-01', dueDate: '2026-01-10' };

  test('by due date: days past the due date', () => {
    expect(ageOf(inv, '2026-02-09', 'due')).toEqual({ days: 30, bucket: '1-30 days' });
  });

  test('by due date: not yet due is Current with 0 days (never negative)', () => {
    expect(ageOf(inv, '2026-01-05', 'due')).toEqual({ days: 0, bucket: 'Current' });
  });

  test('by invoice date: days since the invoice was issued', () => {
    expect(ageOf(inv, '2026-03-01', 'invoice')).toEqual({ days: 59, bucket: '31-60 days' });
  });

  test('defaults to the due-date basis', () => {
    expect(ageOf(inv, '2026-02-09')).toEqual(ageOf(inv, '2026-02-09', 'due'));
  });
});

describe('paidAsOf', () => {
  const inv = {
    paidAmount: 1000,
    payments: [
      { amount: 400, paymentDate: '2026-02-10', status: 'POSTED' },
      { amount: 100, paymentDate: '2026-03-05', status: 'POSTED' },
      { amount: 50,  paymentDate: '2026-03-06', status: 'REVERSED' },
      { amount: 70,  paymentDate: '2026-03-07', status: 'PENDING' },
    ],
  };

  test('takes back only the counted payments made after the as-of date', () => {
    expect(paidAsOf(inv, '2026-03-01')).toBe(900);
  });

  test('is the full paidAmount once every payment is on or before the as-of date', () => {
    expect(paidAsOf(inv, '2026-03-31')).toBe(1000);
  });

  test('works when payments were not loaded, and never goes below zero', () => {
    expect(paidAsOf({ paidAmount: 500 }, '2026-01-01')).toBe(500);
    expect(paidAsOf({ paidAmount: 50, payments: [{ amount: 80, paymentDate: '2026-05-01', status: 'POSTED' }] }, '2026-01-01')).toBe(0);
  });
});

describe('buildAging', () => {
  const base = { customerId: 1, notes: null, termsName: 'Net 30', paidAmount: 0, payments: [] };
  const invoices = [
    { ...base, invoiceNo: 'INV-1', status: 'OPEN',    invoiceDate: '2026-01-01', dueDate: '2026-01-31', totalAmount: 1000 },
    { ...base, invoiceNo: 'INV-2', status: 'PARTIAL', invoiceDate: '2026-02-01', dueDate: '2026-03-03', totalAmount: 500, paidAmount: 200 },
    { ...base, invoiceNo: 'INV-3', status: 'PAID',    invoiceDate: '2026-01-05', dueDate: '2026-02-04', totalAmount: 300, paidAmount: 300 },
    { ...base, invoiceNo: 'INV-4', status: 'VOID',    invoiceDate: '2026-01-05', dueDate: '2026-02-04', totalAmount: 999 },
    { ...base, invoiceNo: 'INV-5', status: 'OPEN',    invoiceDate: '2026-04-01', dueDate: '2026-05-01', totalAmount: 700 },
  ];
  const names = { 1: 'ACME' };

  test('lists outstanding invoices of that date only, bucketed by days past due', () => {
    const r = buildAging(invoices, { asOf: '2026-03-02', customerNames: names });

    expect(r.items.map((i) => i.invoiceNo)).toEqual(['INV-1', 'INV-2']); // 3 paid, 4 void, 5 not issued yet
    expect(r.items[0]).toMatchObject({
      customer: 'ACME', termsName: 'Net 30', total: 1000, paid: 0, outstanding: 1000,
      daysOverdue: 30, bucket: '1-30 days',
    });
    expect(r.items[1]).toMatchObject({ outstanding: 300, daysOverdue: 0, bucket: 'Current' });
    expect(r.summary).toEqual({ Current: 300, '1-30 days': 1000, '31-60 days': 0, '61-90 days': 0, 'Over 90 days': 0 });
    expect(r.total).toBe(1300);
  });

  test('a paid invoice reappears in an earlier as-of that predates its payment', () => {
    const paid = [{
      ...base, invoiceNo: 'INV-3', status: 'PAID', invoiceDate: '2026-01-05', dueDate: '2026-02-04',
      totalAmount: 300, paidAmount: 300,
      payments: [{ amount: 300, paymentDate: '2026-03-10', status: 'POSTED' }],
    }];

    expect(buildAging(paid, { asOf: '2026-03-01', customerNames: names }).items).toHaveLength(1);
    expect(buildAging(paid, { asOf: '2026-03-10', customerNames: names }).items).toHaveLength(0);
  });

  test('invoice-date basis ages from the issue date', () => {
    const r = buildAging(invoices.slice(0, 1), { asOf: '2026-03-02', basis: 'invoice', customerNames: names });
    expect(r.items[0]).toMatchObject({ daysOverdue: 60, bucket: '31-60 days' });
  });

  test('an unknown customer id does not crash the report', () => {
    const r = buildAging(invoices.slice(0, 1), { asOf: '2026-03-02', customerNames: {} });
    expect(r.items[0].customer).toBe('Unknown customer');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx jest tests/arAging.test.js`
Expected: `Cannot find module '../lib/arAging'`.

- [ ] **Step 3: Implement `lib/arAging.js`**

```js
// AR aging maths shared by the Express API and the Next.js UI (CommonJS, like
// lib/draftStorage.js). Dates travel as 'YYYY-MM-DD' strings so the server's
// time zone can never shift an invoice into another bucket.

const AR_BUCKETS = ['Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'];

const DAY_MS = 86400000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dateKey = (d) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
const utcDay = (d) => Date.parse(`${dateKey(d)}T00:00:00Z`);

// Philippine calendar date (UTC+8) for "today".
function todayPH(now = Date.now()) {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
}

function bucketForDays(days) {
  if (days <= 0) return 'Current';
  if (days <= 30) return '1-30 days';
  if (days <= 60) return '31-60 days';
  if (days <= 90) return '61-90 days';
  return 'Over 90 days';
}

// basis 'due': days past the due date. basis 'invoice': days since the invoice
// date (Current then means "issued on the as-of date").
function ageOf(inv, asOf, basis = 'due') {
  const from = basis === 'invoice' ? inv.invoiceDate : inv.dueDate;
  const days = Math.max(0, daysBetween(from, asOf));
  return { days, bucket: bucketForDays(days) };
}

// Amount collected as of a date. invoice.paidAmount is the live total, so for a
// past date take back the counted payments dated after it. PENDING/REVERSED
// payments never reached paidAmount, so they are ignored.
function paidAsOf(inv, asOf) {
  const later = (inv.payments || [])
    .filter((p) => p.status !== 'PENDING' && p.status !== 'REVERSED' && dateKey(p.paymentDate) > asOf)
    .reduce((s, p) => s + Number(p.amount), 0);
  return Math.max(0, round2(Number(inv.paidAmount) - later));
}

function buildAging(invoices, { asOf, basis = 'due', customerNames = {} }) {
  const items = [];
  for (const inv of invoices) {
    if (inv.status === 'VOID') continue;
    if (dateKey(inv.invoiceDate) > asOf) continue;
    const total = Number(inv.totalAmount);
    const paid = paidAsOf(inv, asOf);
    const outstanding = round2(total - paid);
    if (outstanding <= 0.005) continue;
    const { days, bucket } = ageOf(inv, asOf, basis);
    items.push({
      invoiceNo: inv.invoiceNo,
      customerId: inv.customerId,
      customer: customerNames[inv.customerId] || 'Unknown customer',
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      termsName: inv.termsName || null,
      total, paid, outstanding,
      daysOverdue: days,
      bucket,
      notes: inv.notes,
    });
  }
  const summary = Object.fromEntries(
    AR_BUCKETS.map((b) => [b, round2(items.filter((i) => i.bucket === b).reduce((s, i) => s + i.outstanding, 0))])
  );
  return { items, summary, total: round2(items.reduce((s, i) => s + i.outstanding, 0)) };
}

module.exports = { AR_BUCKETS, todayPH, daysBetween, bucketForDays, ageOf, paidAsOf, buildAging };
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx jest tests/arAging.test.js`

- [ ] **Step 5: Commit**

```bash
git add lib/arAging.js tests/arAging.test.js
git commit -m "feat(aging): shared AR aging module with as-of and invoice-date basis"
```

---

### Task 2: Aging endpoint on the shared module

**Files:**
- Modify: `server/controllers/receivableController.js` (`agingReport`, ~line 411-444; imports at the top)
- Modify: `lib/api.js` (`receivable.invoices.aging`)
- Test: `tests/receivableAging.test.js`

**Interfaces:**
- Consumes: `buildAging`, `todayPH` (Task 1).
- Produces HTTP: `GET /api/receivable/aging?asOf=YYYY-MM-DD&basis=due|invoice` returning `{ items, summary, total, asOf, basis }`; `items` shape from Task 1. Missing params default to today (PH) and `due`. Bad `asOf` returns 400.
- Produces UI client: `receivable.invoices.aging(params)`.

- [ ] **Step 1: Write the failing tests** (`tests/receivableAging.test.js`)

```js
jest.mock('../server/config/database', () => ({
  invoice:  { findMany: jest.fn() },
  customer: { findMany: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/receivableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const inv = (over = {}) => ({
  invoiceNo: 'INV-1', customerId: 4, status: 'OPEN', invoiceDate: new Date('2026-01-01T00:00:00Z'),
  dueDate: new Date('2026-01-31T00:00:00Z'), totalAmount: 1000, paidAmount: 0, termsName: 'Net 30',
  notes: null, payments: [], ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.customer.findMany.mockResolvedValue([{ id: 4, name: 'ACME' }]);
});

describe('agingReport', () => {
  test('loads this business’s non-void invoices dated on or before the as-of date, with payments', async () => {
    prisma.invoice.findMany.mockResolvedValue([inv()]);

    await run(ctrl.agingReport, { query: { asOf: '2026-03-02' } });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        businessId: 1,
        status: { not: 'VOID' },
        invoiceDate: { lte: new Date('2026-03-02T00:00:00Z') },
      },
      include: { payments: { select: { amount: true, paymentDate: true, status: true } } },
    }));
  });

  test('returns buckets, total, and echoes asOf and basis', async () => {
    prisma.invoice.findMany.mockResolvedValue([inv()]);

    const r = await run(ctrl.agingReport, { query: { asOf: '2026-03-02', basis: 'invoice' } });

    expect(r.asOf).toBe('2026-03-02');
    expect(r.basis).toBe('invoice');
    expect(r.total).toBe(1000);
    expect(r.items[0]).toMatchObject({ customer: 'ACME', termsName: 'Net 30', bucket: '31-60 days' });
  });

  test('defaults to the due-date basis for any unknown basis value', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);

    const r = await run(ctrl.agingReport, { query: { asOf: '2026-03-02', basis: 'bogus' } });

    expect(r.basis).toBe('due');
  });

  test('rejects a malformed as-of date', async () => {
    await expect(run(ctrl.agingReport, { query: { asOf: '03/02/2026' } })).rejects.toThrow('asOf');
    await expect(run(ctrl.agingReport, { query: { asOf: '2026-13-45' } })).rejects.toThrow('asOf');
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`Run: npx jest tests/receivableAging.test.js`; the current report ignores `asOf` and returns no `asOf`/`basis`).

- [ ] **Step 3: Replace `agingReport`.** Add to the imports at the top of `receivableController.js`:

```js
const { buildAging, todayPH } = require('../../lib/arAging');
```

Replace the whole `exports.agingReport = ...` function with:

```js
exports.agingReport = async (req, res, next) => {
  try {
    const asOf = req.query.asOf || todayPH();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || Number.isNaN(Date.parse(`${asOf}T00:00:00Z`))) {
      throw createError('asOf must be a valid date in YYYY-MM-DD format', 400);
    }
    const basis = req.query.basis === 'invoice' ? 'invoice' : 'due';

    const invoices = await prisma.invoice.findMany({
      where: {
        businessId: req.businessId,
        status: { not: 'VOID' },
        invoiceDate: { lte: new Date(`${asOf}T00:00:00Z`) },
      },
      include: { payments: { select: { amount: true, paymentDate: true, status: true } } },
    });

    // Customer names are fetched separately (not via `include`) so an invoice whose
    // customer was deleted (orphaned FK) cannot crash the whole report.
    const customerIds = [...new Set(invoices.map((i) => i.customerId))];
    const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } }, select: { id: true, name: true } });
    const customerNames = Object.fromEntries(customers.map((c) => [c.id, c.name]));

    res.json({ ...buildAging(invoices, { asOf, basis, customerNames }), asOf, basis });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Update the client** in `lib/api.js`: change `aging: () => api.get('/receivable/aging'),` (inside `receivable.invoices`) to `aging: (params) => api.get('/receivable/aging', { params }),`.

- [ ] **Step 5: Run, expect PASS, then the whole suite**

Run: `npx jest tests/receivableAging.test.js` then `npx jest`.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/receivableController.js lib/api.js tests/receivableAging.test.js
git commit -m "feat(aging): as-of date and basis on the AR aging endpoint"
```

---

### Task 3: Aging page: as-of, basis, terms

**Files:**
- Modify: `app/(dashboard)/receivable/aging/page.jsx`

**Interfaces:**
- Consumes: `AR_BUCKETS`, `ageOf`, `todayPH` from `@/lib/arAging`; endpoint from Task 2; item fields `termsName`, `invoiceDate`.

- [ ] **Step 1: Imports and buckets.** After `import { exportToExcel } from '@/lib/export';` add `import { AR_BUCKETS, ageOf, todayPH } from '@/lib/arAging';`. Replace `const BUCKETS = ['Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'];` with `const BUCKETS = AR_BUCKETS;`.

- [ ] **Step 2: Remove the hand-copied bucket function.** Delete the local `function bucketFor(dueDate) { ... }` (lines ~46-55, with its comment). Replace its two call sites:
  - history table row (`const { bucket } = isOutstanding ? bucketFor(inv.dueDate) : { bucket: null };`) with `const { bucket } = isOutstanding ? ageOf(inv, todayPH(), 'due') : { bucket: null };`
  - `outstandingItemsFrom` (`const { daysOverdue, bucket } = bucketFor(inv.dueDate);`) with `const { days: daysOverdue, bucket } = ageOf(inv, todayPH(), 'due');` and add `termsName: inv.termsName,` to the object it returns.

- [ ] **Step 3: State and loading.** In the main page component, next to its other `useState` calls add:

```jsx
  const [asOf, setAsOf]   = useState(todayPH());
  const [basis, setBasis] = useState('due'); // 'due' | 'invoice'
```

Change the `load` callback to `const r = await rApi.invoices.aging({ asOf, basis });` with dependency array `[asOf, basis]` (`useEffect(() => { load(); }, [load]);` then reloads on change). Change the early return `if (loading) return (` to `if (loading && !data) return (` so changing the date does not blank the page and lose the controls.

- [ ] **Step 4: Header controls.** Replace the page subtitle expression `As of {new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}` with `As of {formatDate(asOf)}`. Replace the single Refresh `<button ...>` in the header `page-header` with:

```jsx
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">As of</label>
            <input type="date" className="input text-sm py-1.5 w-40" max={todayPH()}
              value={asOf} onChange={(e) => e.target.value && setAsOf(e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-0.5">Age by</label>
            <select className="select text-sm py-1.5 w-40" value={basis} onChange={(e) => setBasis(e.target.value)}>
              <option value="due">Due date</option>
              <option value="invoice">Invoice date</option>
            </select>
          </div>
          <button onClick={load} disabled={loading} className="btn-secondary">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
```

Directly under the `page-header` div add:

```jsx
      {basis === 'invoice' && (
        <p className="text-xs text-gray-500 -mt-3">
          Aged from the invoice date. “Current” means issued on the as-of date; the other columns count days since the invoice was issued.
        </p>
      )}
```

- [ ] **Step 5: Rename a confusing filter label.** The bucket filter's first option reads `All Terms` (it filters aging buckets, which is confusing next to payment Terms). Change `<option value="">All Terms</option>` to `<option value="">All Aging</option>`.

- [ ] **Step 6: Terms and age label in detail rows.** Pass `basis={basis}` to `<CustomerRow ... />` (find it with `grep -n "<CustomerRow"`), add `basis` to its props (`function CustomerRow({ customerName, items, onView, basis })`), and in its expanded rows replace

```jsx
              <span className="text-xs text-gray-400 ml-2">Due: {formatDate(item.dueDate)}</span>
              {item.daysOverdue > 0 && (
                <span className="text-xs text-red-500 ml-2">({item.daysOverdue}d overdue)</span>
              )}
```

with

```jsx
              <span className="text-xs text-gray-400 ml-2">Due: {formatDate(item.dueDate)}</span>
              {item.termsName && <span className="text-xs text-gray-400 ml-2">· {item.termsName}</span>}
              {item.daysOverdue > 0 && (
                <span className="text-xs text-red-500 ml-2">({item.daysOverdue}d {basis === 'invoice' ? 'old' : 'overdue'})</span>
              )}
```

- [ ] **Step 7: Terms in the statement print and Excel.**
  - In `printCustomerStatement`, change the due-date cell `<td>${dateFmt(i.dueDate)}</td>` to `<td>${dateFmt(i.dueDate)}${i.termsName ? ` · ${esc(i.termsName)}` : ''}</td>`.
  - In `exportCustomerStatement`, add `terms: i.termsName || '',` to the `type: 'Invoice'` row object, and add `{ key: 'terms', label: 'Terms' },` to the columns list right after the `dueDate` column.

- [ ] **Step 8: Commit**

```bash
git add "app/(dashboard)/receivable/aging/page.jsx"
git commit -m "feat(aging): as-of date, age-by toggle and terms on the AR aging page"
```

---

### Task 4: Verify

- [ ] **Step 1:** `npx jest` in the worktree. Expected: all pass.
- [ ] **Step 2:** `npm run build` in the worktree directory only. Expected: success.
- [ ] **Step 3:** With the user's sign-off (or by the user), check in the browser:
  1. Receivables > AR Aging loads; totals equal what it showed before this change (same invoices, same buckets) for today's date.
  2. Change "As of" to a past date: invoices dated after it disappear; an invoice paid after that date reappears with its old balance.
  3. "Age by: Invoice date": buckets re-group; the explanatory note shows; rows say "d old".
  4. Expand a customer: terms show next to the due date; Print and Excel statements include Terms.
  5. The date picker keeps focus while the report reloads (no full-page spinner).
- [ ] **Step 4:** Report what passed and what was not checked before starting phase 3 (`2026-10-19-receivables-3-soa.md`).

## Self-review against the spec (section 2)

- Same buckets, due date from Terms: unchanged buckets; due date already stored per invoice (phase 1 computes it from terms).
- As-of date filter: Tasks 1-3. Age by due/invoice date toggle: Tasks 1-3. Terms column: Task 3 (detail rows, print, Excel).
- Excel/CSV export: already existed, kept and extended with Terms (deviation noted at top).
- Link to the customer's SOA: moved to phase 3, where the page it points to is created.
- Bucket logic shared with SOA: `lib/arAging.js` is what phase 3 consumes.
