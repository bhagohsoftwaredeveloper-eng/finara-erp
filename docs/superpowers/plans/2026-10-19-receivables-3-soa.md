# Statement of Account (SOA) Implementation Plan (Receivables Docs, Phase 3 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Statements page where the user picks a customer (or all customers), chooses "Open items" or "Full ledger", and views or prints a Statement of Account with terms, due dates, an aging summary (open items) or a running balance (ledger).

**Architecture:** One read-only endpoint `GET /api/receivable/statements` loads the business's non-void invoices (with payments) and builds each customer's statement with pure functions: `buildAging` from phase 2 for open items, and a new `buildLedger` for the running-balance ledger. The page renders the result and prints it through `printDocument`; "All customers" prints one statement per customer separated by page breaks.

**Tech Stack:** Express + Prisma 5, Next.js 14, Jest.

Spec: `docs/superpowers/specs/2026-10-19-receivables-docs-design.md` (section 3).

**Spec note:** the aging page already prints/exports a basic per-customer statement (open invoices with payment history). It stays as it is. The new page adds the ledger mode, the as-of date, terms, the aging summary and all-customers printing.

**Prerequisites:** phases 1 and 2 merged (`termsName` on invoices, `lib/arAging.js`).

## Global Constraints

- Same isolated worktree as the earlier phases. The main working tree has uncommitted user changes in `server/controllers/receivableController.js`, `app/(dashboard)/receivable/page.jsx`, `lib/api.js`, `components/layout/Sidebar.jsx`, `lib/print.js`; never `git add` those from the main tree. No `isolation: "worktree"` for subagents inside the worktree.
- Every Prisma query is scoped by `req.businessId`.
- Statements exclude VOID invoices and payments with status PENDING or REVERSED.
- Print only through `printDocument` from `@/lib/print`, with `phpFmt()` / `dateFmt()` inside the HTML string.
- The user owns the dev server; never start a competing one, never run `next build` where it runs.
- Tests: `npx jest tests/<file>.test.js`. Commits list explicit paths and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: Ledger builder

**Files:**
- Modify: `lib/arAging.js` (export `dateKey`)
- Create: `server/utils/arStatement.js`
- Test: `tests/arStatement.test.js`

**Interfaces:**
- Consumes: invoices shaped `{ invoiceNo, status, invoiceDate, totalAmount, paidAmount, termsName, payments: [{ paymentNo, paymentDate, amount, paymentMethod, reference, status }] }`.
- Produces: `buildLedger(invoices, { from, to }): { openingBalance, rows, totalDebits, totalCredits, closingBalance }` with `from`/`to` as `'YYYY-MM-DD'` (inclusive). Each row: `{ date, type: 'INVOICE'|'PAYMENT', reference, description, debit, credit, balance }`.
- Produces: `dateKey(d): string` exported from `lib/arAging.js`.

- [ ] **Step 1: Export `dateKey`.** In `lib/arAging.js` change the last line to:

```js
module.exports = { AR_BUCKETS, todayPH, daysBetween, bucketForDays, ageOf, paidAsOf, buildAging, dateKey };
```

- [ ] **Step 2: Write the failing tests** (`tests/arStatement.test.js`)

```js
const { buildLedger } = require('../server/utils/arStatement');

const pay = (over = {}) => ({
  paymentNo: 'PAR-000001', paymentDate: '2026-01-20', amount: 400, paymentMethod: 'Cash', reference: null, status: 'POSTED', ...over,
});
const inv = (over = {}) => ({
  invoiceNo: 'INV-000001', status: 'OPEN', invoiceDate: '2026-01-10', totalAmount: 1000, paidAmount: 0,
  termsName: 'Net 30', payments: [], ...over,
});

const inv1 = inv({ status: 'PARTIAL', paidAmount: 400, payments: [pay()] });
const inv2 = inv({ invoiceNo: 'INV-000002', invoiceDate: '2026-02-05', totalAmount: 500 });

describe('buildLedger', () => {
  test('invoices are debits, payments are credits, with a running balance', () => {
    const r = buildLedger([inv1, inv2], { from: '2026-01-01', to: '2026-01-31' });

    expect(r.openingBalance).toBe(0);
    expect(r.rows.map((x) => [x.type, x.reference, x.debit, x.credit, x.balance])).toEqual([
      ['INVOICE', 'INV-000001', 1000, 0, 1000],
      ['PAYMENT', 'PAR-000001', 0, 400, 600],
    ]);
    expect(r.totalDebits).toBe(1000);
    expect(r.totalCredits).toBe(400);
    expect(r.closingBalance).toBe(600);
  });

  test('everything before the start date rolls into the opening balance', () => {
    const r = buildLedger([inv1, inv2], { from: '2026-02-01', to: '2026-02-28' });

    expect(r.openingBalance).toBe(600);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ reference: 'INV-000002', debit: 500, balance: 1100 });
    expect(r.closingBalance).toBe(1100);
  });

  test('transactions after the end date are left out', () => {
    const r = buildLedger([inv1, inv2], { from: '2026-01-01', to: '2026-01-15' });

    expect(r.rows.map((x) => x.reference)).toEqual(['INV-000001']);
    expect(r.closingBalance).toBe(1000);
  });

  test('on the same day the invoice comes before its payment', () => {
    const same = inv({ paidAmount: 1000, payments: [pay({ paymentDate: '2026-01-10', amount: 1000 })] });
    const r = buildLedger([same], { from: '2026-01-01', to: '2026-01-31' });

    expect(r.rows.map((x) => x.type)).toEqual(['INVOICE', 'PAYMENT']);
    expect(r.closingBalance).toBe(0);
  });

  test('void invoices and pending or reversed payments are ignored', () => {
    const voided = inv({ invoiceNo: 'INV-000009', status: 'VOID', totalAmount: 999 });
    const withBad = inv({
      paidAmount: 0,
      payments: [pay({ status: 'REVERSED' }), pay({ paymentNo: 'PAR-000002', status: 'PENDING' })],
    });
    const r = buildLedger([voided, withBad], { from: '2026-01-01', to: '2026-12-31' });

    expect(r.rows.map((x) => x.reference)).toEqual(['INV-000001']);
    expect(r.closingBalance).toBe(1000);
  });

  test('money recorded on the invoice with no payment rows shows as one credit, so the ledger matches the invoice balance', () => {
    const legacy = inv({ status: 'PARTIAL', paidAmount: 300, payments: [] });
    const r = buildLedger([legacy], { from: '2026-01-01', to: '2026-12-31' });

    expect(r.rows).toHaveLength(2);
    expect(r.rows[1]).toMatchObject({ type: 'PAYMENT', credit: 300, balance: 700 });
    expect(r.rows[1].description).toMatch(/no payment detail/);
  });

  test('empty input gives a zero ledger', () => {
    expect(buildLedger([], { from: '2026-01-01', to: '2026-01-31' })).toEqual({
      openingBalance: 0, rows: [], totalDebits: 0, totalCredits: 0, closingBalance: 0,
    });
  });
});
```

- [ ] **Step 3: Run, expect FAIL** (`Run: npx jest tests/arStatement.test.js`; module not found).

- [ ] **Step 4: Implement `server/utils/arStatement.js`**

```js
const { dateKey } = require('../../lib/arAging');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isCounted = (p) => p.status !== 'PENDING' && p.status !== 'REVERSED';

// Running-balance customer ledger. Invoices are debits, payments are credits.
// Everything dated before `from` is folded into the opening balance; rows run
// from `from` to `to` inclusive.
function buildLedger(invoices, { from, to }) {
  const txns = [];
  for (const inv of invoices) {
    if (inv.status === 'VOID') continue;
    const date = dateKey(inv.invoiceDate);
    txns.push({
      date, order: 0, type: 'INVOICE', reference: inv.invoiceNo,
      description: inv.termsName ? `Invoice · ${inv.termsName}` : 'Invoice',
      debit: round2(inv.totalAmount), credit: 0,
    });

    const counted = (inv.payments || []).filter(isCounted);
    for (const p of counted) {
      txns.push({
        date: dateKey(p.paymentDate), order: 1, type: 'PAYMENT', reference: p.paymentNo,
        description: `Payment for ${inv.invoiceNo} (${p.paymentMethod}${p.reference ? `, ${p.reference}` : ''})`,
        debit: 0, credit: round2(p.amount),
      });
    }
    // paidAmount can exceed the payment rows (older records): show the difference
    // so the ledger still agrees with the invoice balance.
    const unexplained = round2(Number(inv.paidAmount) - counted.reduce((s, p) => s + Number(p.amount), 0));
    if (unexplained > 0.005) {
      txns.push({
        date, order: 1, type: 'PAYMENT', reference: inv.invoiceNo,
        description: `Payments received on ${inv.invoiceNo} (no payment detail)`,
        debit: 0, credit: unexplained,
      });
    }
  }

  txns.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.reference.localeCompare(b.reference));

  let openingBalance = 0;
  for (const t of txns) if (t.date < from) openingBalance = round2(openingBalance + t.debit - t.credit);

  let balance = openingBalance;
  const rows = [];
  for (const t of txns) {
    if (t.date < from || t.date > to) continue;
    balance = round2(balance + t.debit - t.credit);
    rows.push({ date: t.date, type: t.type, reference: t.reference, description: t.description,
      debit: t.debit, credit: t.credit, balance });
  }

  return {
    openingBalance,
    rows,
    totalDebits: round2(rows.reduce((s, r) => s + r.debit, 0)),
    totalCredits: round2(rows.reduce((s, r) => s + r.credit, 0)),
    closingBalance: balance,
  };
}

module.exports = { buildLedger };
```

- [ ] **Step 5: Run, expect PASS** (`npx jest tests/arStatement.test.js tests/arAging.test.js`).

- [ ] **Step 6: Commit**

```bash
git add lib/arAging.js server/utils/arStatement.js tests/arStatement.test.js
git commit -m "feat(soa): running-balance ledger builder"
```

---

### Task 2: Statements endpoint

**Files:**
- Create: `server/controllers/statementController.js`
- Modify: `server/routes/receivable.js` (register before `router.get('/:id', ...)`)
- Modify: `lib/api.js` (`receivable.statements`)
- Test: `tests/statementController.test.js`

**Interfaces:**
- Consumes: `buildAging`, `todayPH` (`lib/arAging.js`), `buildLedger` (Task 1).
- Produces HTTP: `GET /api/receivable/statements?customerId=<id|all>&mode=open|ledger&asOf=YYYY-MM-DD` (open) or `&from=YYYY-MM-DD&to=YYYY-MM-DD` (ledger). Response:
  `{ mode, asOf? , from?, to?, statements: [ { customer: { id, customerCode, name, tin, address, email, phone }, ...result } ] }` where `result` is the `buildAging` output (`items, summary, total`) for `open` and the `buildLedger` output for `ledger`. With `customerId=all`, customers with nothing to show are left out.
- Produces UI client: `receivable.statements.get(params)`.

- [ ] **Step 1: Write the failing tests** (`tests/statementController.test.js`)

```js
jest.mock('../server/config/database', () => ({
  invoice:  { findMany: jest.fn() },
  customer: { findFirst: jest.fn(), findMany: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/statementController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const cust = (id, name) => ({ id, customerCode: `CUS-00${id}`, name, tin: null, address: null, email: null, phone: null });
const inv = (over = {}) => ({
  invoiceNo: 'INV-000001', customerId: 4, status: 'OPEN', invoiceDate: new Date('2026-01-01T00:00:00Z'),
  dueDate: new Date('2026-01-31T00:00:00Z'), totalAmount: 1000, paidAmount: 0, termsName: 'Net 30',
  notes: null, payments: [], ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('getStatements, open items', () => {
  test('one customer: scoped to the business and that customer', async () => {
    prisma.customer.findFirst.mockResolvedValue(cust(4, 'ACME'));
    prisma.invoice.findMany.mockResolvedValue([inv()]);

    const r = await run(ctrl.getStatements, { query: { customerId: '4', mode: 'open', asOf: '2026-03-02' } });

    expect(prisma.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 4, businessId: 1 } }));
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ businessId: 1, customerId: 4, status: { not: 'VOID' } }),
    }));
    expect(r.mode).toBe('open');
    expect(r.asOf).toBe('2026-03-02');
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].customer.name).toBe('ACME');
    expect(r.statements[0].total).toBe(1000);
    expect(r.statements[0].items[0]).toMatchObject({ invoiceNo: 'INV-000001', termsName: 'Net 30', bucket: '1-30 days' });
  });

  test('404 when the customer belongs to another business', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.getStatements, { query: { customerId: '4', mode: 'open' } }))
      .rejects.toThrow('Customer not found');
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  test('all customers: only those with an open balance are returned', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      inv({ invoiceNo: 'INV-000001', customerId: 4 }),
      inv({ invoiceNo: 'INV-000002', customerId: 5, status: 'PAID', paidAmount: 1000 }),
    ]);
    prisma.customer.findMany.mockResolvedValue([cust(4, 'ACME'), cust(5, 'Beta')]);

    const r = await run(ctrl.getStatements, { query: { customerId: 'all', mode: 'open', asOf: '2026-03-02' } });

    expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: 1, id: { in: [4, 5] } },
    }));
    expect(r.statements.map((s) => s.customer.name)).toEqual(['ACME']);
  });

  test('requires a customerId (an id or "all") and a valid as-of date', async () => {
    await expect(run(ctrl.getStatements, { query: { mode: 'open' } })).rejects.toThrow('customerId');
    await expect(run(ctrl.getStatements, { query: { customerId: 'abc', mode: 'open' } })).rejects.toThrow('customerId');
    await expect(run(ctrl.getStatements, { query: { customerId: 'all', mode: 'open', asOf: 'nope' } })).rejects.toThrow('asOf');
  });
});

describe('getStatements, ledger', () => {
  test('returns opening balance, rows and closing balance for the range', async () => {
    prisma.customer.findFirst.mockResolvedValue(cust(4, 'ACME'));
    prisma.invoice.findMany.mockResolvedValue([inv({ invoiceDate: new Date('2026-02-05T00:00:00Z'), totalAmount: 500 })]);

    const r = await run(ctrl.getStatements, { query: { customerId: '4', mode: 'ledger', from: '2026-02-01', to: '2026-02-28' } });

    expect(r.from).toBe('2026-02-01');
    expect(r.to).toBe('2026-02-28');
    expect(r.statements[0]).toMatchObject({ openingBalance: 0, closingBalance: 500 });
    expect(r.statements[0].rows).toHaveLength(1);
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ invoiceDate: { lte: new Date('2026-02-28T00:00:00Z') } }),
    }));
  });

  test('requires from and to, with from not after to', async () => {
    await expect(run(ctrl.getStatements, { query: { customerId: 'all', mode: 'ledger', to: '2026-02-28' } }))
      .rejects.toThrow('from');
    await expect(run(ctrl.getStatements, { query: { customerId: 'all', mode: 'ledger', from: '2026-03-01', to: '2026-02-01' } }))
      .rejects.toThrow('from');
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`Run: npx jest tests/statementController.test.js`; module not found).

- [ ] **Step 3: Implement `server/controllers/statementController.js`**

```js
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { buildAging, todayPH } = require('../../lib/arAging');
const { buildLedger } = require('../utils/arStatement');

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const CUSTOMER_FIELDS = { id: true, customerCode: true, name: true, tin: true, address: true, email: true, phone: true };

exports.getStatements = async (req, res, next) => {
  try {
    const businessId = req.businessId;
    const mode = req.query.mode === 'ledger' ? 'ledger' : 'open';

    const all = req.query.customerId === 'all';
    const customerId = Number(req.query.customerId);
    if (!all && !Number.isInteger(customerId)) {
      throw createError('customerId is required (a customer id, or "all")', 400);
    }

    let asOf, from, to, cutoff;
    if (mode === 'open') {
      asOf = req.query.asOf || todayPH();
      if (!isDate(asOf)) throw createError('asOf must be a valid date in YYYY-MM-DD format', 400);
      cutoff = asOf;
    } else {
      ({ from, to } = req.query);
      if (!isDate(from) || !isDate(to) || from > to) {
        throw createError('from and to must be valid YYYY-MM-DD dates, with from not after to', 400);
      }
      cutoff = to;
    }

    let single = null;
    if (!all) {
      single = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: CUSTOMER_FIELDS });
      if (!single) throw createError('Customer not found', 404);
    }

    const invoices = await prisma.invoice.findMany({
      where: {
        businessId,
        status: { not: 'VOID' },
        invoiceDate: { lte: new Date(`${cutoff}T00:00:00Z`) },
        ...(all ? {} : { customerId }),
      },
      include: {
        payments: { select: { paymentNo: true, paymentDate: true, amount: true, paymentMethod: true, reference: true, status: true } },
      },
      orderBy: { invoiceDate: 'asc' },
    });

    const byCustomer = new Map();
    for (const inv of invoices) {
      if (!byCustomer.has(inv.customerId)) byCustomer.set(inv.customerId, []);
      byCustomer.get(inv.customerId).push(inv);
    }

    const customers = all
      ? await prisma.customer.findMany({
          where: { businessId, id: { in: [...byCustomer.keys()] } },
          select: CUSTOMER_FIELDS,
          orderBy: { name: 'asc' },
        })
      : [single];

    const statements = [];
    for (const customer of customers) {
      const invs = byCustomer.get(customer.id) || [];
      const result = mode === 'open'
        ? buildAging(invs, { asOf, basis: 'due', customerNames: { [customer.id]: customer.name } })
        : buildLedger(invs, { from, to });
      const hasContent = mode === 'open'
        ? result.items.length > 0
        : result.rows.length > 0 || Math.abs(result.openingBalance) > 0.005;
      if (all && !hasContent) continue;
      statements.push({ customer, ...result });
    }

    res.json({ mode, ...(mode === 'open' ? { asOf } : { from, to }), statements });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run, expect PASS** (`npx jest tests/statementController.test.js`).

- [ ] **Step 5: Route and client.** In `server/routes/receivable.js` add `const statements = require('../controllers/statementController');` below the other requires, and register, directly after the `/terms` routes (before `router.get('/', ...)`):

```js
router.get('/statements', statements.getStatements);
```

In `lib/api.js` inside `export const receivable`, after the `terms: { ... },` block from phase 1 add:

```js
  statements: {
    get: (params) => api.get('/receivable/statements', { params }),
  },
```

- [ ] **Step 6: Commit**

```bash
git add server/controllers/statementController.js server/routes/receivable.js lib/api.js tests/statementController.test.js
git commit -m "feat(soa): statements endpoint (open items and ledger)"
```

---

### Task 3: Statements page, print, navigation

**Files:**
- Create: `app/(dashboard)/receivable/statements/page.jsx`
- Modify: `components/layout/Sidebar.jsx` (Accounts Receivable children, ~line 45)
- Modify: `app/(dashboard)/receivable/aging/page.jsx` (link from each customer row)

**Interfaces:**
- Consumes: `receivable.statements.get`, `receivable.customers.list`, `AR_BUCKETS`, `todayPH`, `printDocument`, `phpFmt`, `dateFmt`.
- Reads the optional query param `?customerId=<id>` to preselect a customer (like the aging page's `?search=`).

- [ ] **Step 1: Create `app/(dashboard)/receivable/statements/page.jsx`**

```jsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { receivable as rApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Printer, RefreshCw } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import { AR_BUCKETS, todayPH } from '@/lib/arAging';

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const firstOfMonth = () => `${todayPH().slice(0, 8)}01`;

// ─── Print HTML (string, not React: it is written into the print window) ──
const customerBlock = (c) => `
  <div class="info-grid" style="grid-template-columns:2fr 1fr;">
    <div class="info-box"><div class="info-lbl">Customer</div><div class="info-val">${esc(c.name)}</div>
      ${c.address ? `<div class="small gray">${esc(c.address)}</div>` : ''}</div>
    <div class="info-box"><div class="info-lbl">Customer TIN</div><div class="info-val mono small">${esc(c.tin || '—')}</div></div>
  </div>`;

function openStatementHtml(st) {
  const rows = st.items.map((i) => `
    <tr>
      <td class="mono">${esc(i.invoiceNo)}</td>
      <td>${dateFmt(i.invoiceDate)}</td>
      <td>${esc(i.termsName || '—')}</td>
      <td>${dateFmt(i.dueDate)}</td>
      <td class="right">${phpFmt(i.total)}</td>
      <td class="right">${phpFmt(i.paid)}</td>
      <td class="right bold">${phpFmt(i.outstanding)}</td>
    </tr>`).join('');
  return `${customerBlock(st.customer)}
    <table>
      <thead><tr><th>Invoice #</th><th>Date</th><th>Terms</th><th>Due Date</th>
        <th class="right">Amount</th><th class="right">Paid</th><th class="right">Balance</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="gray">No open invoices.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="6">TOTAL AMOUNT DUE</td><td class="right">${phpFmt(st.total)}</td></tr></tfoot>
    </table>
    <div class="section-title">Aging Summary</div>
    <table>
      <thead><tr>${AR_BUCKETS.map((b) => `<th class="right">${b}</th>`).join('')}</tr></thead>
      <tbody><tr>${AR_BUCKETS.map((b) => `<td class="right">${phpFmt(st.summary[b])}</td>`).join('')}</tr></tbody>
    </table>`;
}

function ledgerStatementHtml(st) {
  const rows = st.rows.map((r) => `
    <tr>
      <td>${dateFmt(r.date)}</td>
      <td>${r.type === 'INVOICE' ? 'Invoice' : 'Payment'}</td>
      <td class="mono">${esc(r.reference)}</td>
      <td>${esc(r.description)}</td>
      <td class="right">${r.debit ? phpFmt(r.debit) : ''}</td>
      <td class="right">${r.credit ? phpFmt(r.credit) : ''}</td>
      <td class="right">${phpFmt(r.balance)}</td>
    </tr>`).join('');
  return `${customerBlock(st.customer)}
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th>
        <th class="right">Debit</th><th class="right">Credit</th><th class="right">Balance</th></tr></thead>
      <tbody>
        <tr><td colspan="6" class="gray">Opening balance</td><td class="right bold">${phpFmt(st.openingBalance)}</td></tr>
        ${rows}
      </tbody>
      <tfoot><tr><td colspan="4">TOTALS / CLOSING BALANCE</td>
        <td class="right">${phpFmt(st.totalDebits)}</td><td class="right">${phpFmt(st.totalCredits)}</td>
        <td class="right">${phpFmt(st.closingBalance)}</td></tr></tfoot>
    </table>`;
}

async function printStatements(data, allCustomers) {
  const build = data.mode === 'open' ? openStatementHtml : ledgerStatementHtml;
  const body = data.statements
    .map(build)
    .join('<div style="page-break-after:always;"></div>');
  const period = data.mode === 'open'
    ? `Open items as of ${dateFmt(data.asOf)}`
    : `${dateFmt(data.from)} to ${dateFmt(data.to)}`;
  const who = allCustomers ? 'All customers' : data.statements[0]?.customer.name || '';
  await printDocument('Statement of Account', `${who} · ${period}`, body);
}

// ─── On-screen statement ──────────────────────────────────────
function StatementCard({ st, mode }) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="font-semibold text-gray-900">{st.customer.name}</h3>
          <p className="text-xs text-gray-400">{st.customer.customerCode}{st.customer.tin ? ` · TIN ${st.customer.tin}` : ''}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">{mode === 'open' ? 'Total amount due' : 'Closing balance'}</p>
          <p className="text-lg font-bold text-gray-900">{formatCurrency(mode === 'open' ? st.total : st.closingBalance)}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        {mode === 'open' ? (
          <table className="table w-full">
            <thead><tr>
              <th className="pl-4">Invoice #</th><th>Date</th><th>Terms</th><th>Due Date</th>
              <th className="text-right">Amount</th><th className="text-right">Paid</th><th className="text-right pr-4">Balance</th>
            </tr></thead>
            <tbody>
              {st.items.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-gray-400">No open invoices.</td></tr>}
              {st.items.map((i) => (
                <tr key={i.invoiceNo} className="border-b border-gray-100">
                  <td className="pl-4 font-mono text-sm text-green-700">{i.invoiceNo}</td>
                  <td>{formatDate(i.invoiceDate)}</td>
                  <td>{i.termsName || '—'}</td>
                  <td>
                    {formatDate(i.dueDate)}
                    {i.daysOverdue > 0 && <span className="text-xs text-red-500 ml-2">{i.daysOverdue}d overdue</span>}
                  </td>
                  <td className="text-right">{formatCurrency(i.total)}</td>
                  <td className="text-right">{formatCurrency(i.paid)}</td>
                  <td className="text-right pr-4 font-semibold">{formatCurrency(i.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="table w-full">
            <thead><tr>
              <th className="pl-4">Date</th><th>Type</th><th>Reference</th><th>Description</th>
              <th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right pr-4">Balance</th>
            </tr></thead>
            <tbody>
              <tr className="bg-gray-50 border-b border-gray-100">
                <td className="pl-4 text-gray-500" colSpan={6}>Opening balance</td>
                <td className="text-right pr-4 font-semibold">{formatCurrency(st.openingBalance)}</td>
              </tr>
              {st.rows.map((r, idx) => (
                <tr key={`${r.reference}-${idx}`} className="border-b border-gray-100">
                  <td className="pl-4">{formatDate(r.date)}</td>
                  <td>{r.type === 'INVOICE' ? 'Invoice' : 'Payment'}</td>
                  <td className="font-mono text-sm">{r.reference}</td>
                  <td className="text-gray-600">{r.description}</td>
                  <td className="text-right">{r.debit ? formatCurrency(r.debit) : ''}</td>
                  <td className="text-right">{r.credit ? formatCurrency(r.credit) : ''}</td>
                  <td className="text-right pr-4 font-semibold">{formatCurrency(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {mode === 'open' && st.items.length > 0 && (
        <div className="card-body border-t border-gray-100 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {AR_BUCKETS.map((b) => (
            <span key={b} className="text-gray-500">{b}: <strong className="text-gray-800">{formatCurrency(st.summary[b])}</strong></span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function StatementsPage() {
  const searchParams = useSearchParams();
  const [customers, setCustomers]   = useState([]);
  const [customerId, setCustomerId] = useState(searchParams.get('customerId') || '');
  const [mode, setMode]             = useState('open'); // 'open' | 'ledger'
  const [asOf, setAsOf]             = useState(todayPH());
  const [from, setFrom]             = useState(firstOfMonth());
  const [to, setTo]                 = useState(todayPH());
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    rApi.customers.list().then((r) => setCustomers(r.data)).catch(() => toast.error('Failed to load customers'));
  }, []);

  const load = useCallback(async () => {
    if (!customerId) { setData(null); return; }
    setLoading(true);
    try {
      const params = { customerId, mode, ...(mode === 'open' ? { asOf } : { from, to }) };
      setData((await rApi.statements.get(params)).data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load statement');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [customerId, mode, asOf, from, to]);
  useEffect(() => { load(); }, [load]);

  const all = customerId === 'all';

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Statement of Account</h1>
          <p className="page-subtitle">What a customer owes: open invoices with aging, or the full ledger with running balance</p>
        </div>
        <button className="btn-primary" disabled={!data || data.statements.length === 0}
          onClick={() => printStatements(data, all)}>
          <Printer className="w-4 h-4" /> Print / Save as PDF
        </button>
      </div>

      <div className="card">
        <div className="card-body flex flex-wrap items-end gap-4">
          <div className="form-group min-w-[16rem]">
            <label className="label">Customer</label>
            <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Select customer —</option>
              <option value="all">All customers with a balance</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Show</label>
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="open">Open items</option>
              <option value="ledger">Full ledger</option>
            </select>
          </div>
          {mode === 'open' ? (
            <div className="form-group">
              <label className="label">As of</label>
              <input type="date" className="input" max={todayPH()} value={asOf}
                onChange={(e) => e.target.value && setAsOf(e.target.value)} />
            </div>
          ) : (
            <>
              <div className="form-group">
                <label className="label">From</label>
                <input type="date" className="input" value={from} max={to}
                  onChange={(e) => e.target.value && setFrom(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">To</label>
                <input type="date" className="input" value={to} min={from}
                  onChange={(e) => e.target.value && setTo(e.target.value)} />
              </div>
            </>
          )}
          <button className="btn-secondary" onClick={load} disabled={loading || !customerId}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {!customerId && <p className="text-sm text-gray-400 text-center py-10">Choose a customer to see their statement.</p>}
      {data && data.statements.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-10">No customers with {mode === 'open' ? 'an open balance' : 'activity'} for this selection.</p>
      )}
      {data && data.statements.map((st) => <StatementCard key={st.customer.id} st={st} mode={data.mode} />)}
    </div>
  );
}
```

- [ ] **Step 2: Navigation.** In `components/layout/Sidebar.jsx`, in the Accounts Receivable `children`, after `{ label: 'AR Aging',   href: '/receivable/aging' },` add `{ label: 'Statements', href: '/receivable/statements' },`.

- [ ] **Step 3: Link from the aging page.** In `app/(dashboard)/receivable/aging/page.jsx`: add `FileText` to the `lucide-react` import list and `import Link from 'next/link';` under the other imports. In `CustomerRow`, in the actions `div` right after the `Eye` view button, add:

```jsx
            <Link
              href={`/receivable/statements?customerId=${customerId}`}
              onClick={(e) => e.stopPropagation()}
              title={`Statement of account — ${customerName}`}
              className="text-gray-400 hover:text-green-600 transition-colors"
            >
              <FileText className="w-4 h-4" />
            </Link>
```

- [ ] **Step 4: Commit**

```bash
git add "app/(dashboard)/receivable/statements/page.jsx" components/layout/Sidebar.jsx "app/(dashboard)/receivable/aging/page.jsx"
git commit -m "feat(soa): Statements page with open-items/ledger modes, print, and nav"
```

---

### Task 4: Verify

- [ ] **Step 1:** `npx jest` in the worktree. Expected: all pass.
- [ ] **Step 2:** `npm run build` in the worktree directory only. Expected: success (the page uses `useSearchParams` the same way the aging page already does).
- [ ] **Step 3:** With the user's sign-off, check in the browser:
  1. Receivables > Statements: pick a customer, "Open items": invoice rows show Terms and due date, balances match AR Aging for that customer, the aging summary row adds up to the total.
  2. "Full ledger" with a range that includes a payment: invoice debit, payment credit, running balance, opening balance equals the prior closing balance; closing balance equals the customer's open total on AR Aging when the range ends today.
  3. Change the as-of date to before a known payment: the balance goes back up.
  4. "All customers with a balance": every customer with a balance appears once, none with zero.
  5. Print (single customer and all customers): letterhead, one statement per page for all-customers, peso formatting, nothing cut off on A4.
  6. AR Aging > the new document icon on a customer row opens Statements with that customer selected.
- [ ] **Step 4:** Report what passed and what was not checked before starting phase 4 (`2026-10-19-receivables-4-delivery-receipt.md`).

## Self-review against the spec (section 3)

- Page `/receivable/statements` and nav entry: Task 3. Inputs customer or all, as-of date, mode toggle: Task 3.
- Open items with invoice no., date, terms, due date, total, paid, balance, aging summary, total due: Tasks 2-3.
- Full ledger with from/to, opening balance, debits/credits, running balance: Tasks 1-3.
- Exclusions (VOID invoices; PENDING/REVERSED payments): Tasks 1-2.
- Print via `printDocument`; all customers one statement per customer with page breaks: Task 3.
- API shape `GET /api/receivable/statements?customerId&asOf&mode&from&to`, logic in a util with unit tests, aging buckets shared with AR Aging: Tasks 1-2.
