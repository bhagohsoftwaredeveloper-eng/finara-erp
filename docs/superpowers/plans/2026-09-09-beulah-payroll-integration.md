# Beulah Payroll Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync payroll run lock-status/summaries from the external "Beulah Payroll" API into a new persistent `ExternalPayrollRun` table, show them on the existing Pay Periods page, and let ADMIN/MANAGER users post a locked run as a real Accounts Payable bill (auto-posting to the GL).

**Architecture:** Express controller (`payrollController.js`) calls a small fetch-based service (`beulahPayrollClient.js`) to read Beulah's two read-only endpoints, upserts results into a new Prisma model on every list request (self-healing history), and reuses the existing AP bill-creation path (extracted into a shared `createBillRecord` helper) to post a locked run's net pay as one bill line, which auto-posts its GL entry exactly like a normal vendor bill.

**Tech Stack:** Next.js 14 (App Router) + Express.js + MySQL 8 + Prisma ORM 5, Jest for backend unit tests, native `fetch` for the outbound HTTP call.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-09-09-beulah-payroll-integration-design.md` — follow it exactly; this plan implements it task by task.
- Env vars are `BEULAH_PAYROLL_BASE_URL` and `BEULAH_PAYROLL_API_TOKEN` — server-only, never `NEXT_PUBLIC_*`.
- No per-employee data — the Beulah API returns run-level aggregates only (`entries_count` is a count, not a list).
- Do not modify the internal `PayrollPeriod`/`PayrollItem` workflow or its GL logic.
- AP bill line always posts against account `6110` "Salaries and Wages", amount = `netPay`, `vatCode: 'EXEMPT'`.
- **Windows Prisma gotcha:** `prisma generate`/`prisma migrate dev` EPERM-fails while the dev server holds the query-engine DLL. Stop `npm run dev` (and any nodemon/next process) before running either, then restart it afterward. (See `.claude/skills/verify/SKILL.md` and this repo's own memory notes.)
- Follow existing conventions exactly: `createError(message, statusCode)` from `server/middleware/errorHandler.js` for thrown errors; `req.businessId` / `req.user.id` for scoping; controllers end every handler in `try { ... } catch (err) { next(err); }`.

---

### Task 1: Prisma schema — `ExternalPayrollRun` model + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Test: none (schema-only; validated by successful `prisma migrate dev` + `prisma generate`)

**Interfaces:**
- Produces: Prisma model `ExternalPayrollRun` with fields `id, businessId, externalRunId, periodStart, periodEnd, payableDate, status, entriesCount, grossPay, totalDeductions, netPay, cashAdvance, incentives, externalCreatedBy, syncedAt, postedBillId, postedById, postedAt`, compound unique `businessId_externalRunId`, unique `postedBillId`. Later tasks read/write this via `prisma.externalPayrollRun.*`.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

Insert this block immediately after the closing `}` of `model PayrollItem` (the block starting at line 517 in the current file — search for `model PayrollItem` and add after its final `}`):

```prisma
model ExternalPayrollRun {
  id                Int       @id @default(autoincrement())
  businessId        Int       @default(1)
  externalRunId     Int
  periodStart       DateTime  @db.Date
  periodEnd         DateTime  @db.Date
  payableDate       DateTime  @db.Date
  status            String    @db.VarChar(20)
  entriesCount      Int       @default(0)
  grossPay          Decimal   @default(0) @db.Decimal(15, 2)
  totalDeductions   Decimal   @default(0) @db.Decimal(15, 2)
  netPay            Decimal   @default(0) @db.Decimal(15, 2)
  cashAdvance       Decimal   @default(0) @db.Decimal(15, 2)
  incentives        Decimal   @default(0) @db.Decimal(15, 2)
  externalCreatedBy Int?
  syncedAt          DateTime  @updatedAt
  postedBillId      Int?      @unique
  postedBill        Bill?     @relation(fields: [postedBillId], references: [id])
  postedById        Int?
  postedBy          User?     @relation(fields: [postedById], references: [id])
  postedAt          DateTime?

  @@unique([businessId, externalRunId])
  @@index([businessId])
  @@map("external_payroll_runs")
}
```

- [ ] **Step 2: Add the inverse relation fields**

In `model Bill` (starts at line 222), add one line inside the relations block (right after `payments    PaymentAP[]`):

```prisma
  externalPayrollRun ExternalPayrollRun?
```

In `model User` (starts at line 47), add one line inside the relations block (right after `userBusinesses UserBusiness[]`):

```prisma
  postedExternalPayrollRuns ExternalPayrollRun[]
```

- [ ] **Step 3: Stop the dev server, then generate and migrate**

Check what's running first: `Get-NetTCPConnection -LocalPort 3000,5000 -State Listen` (PowerShell). If something is listening, stop the `npm run dev` tree before continuing — `prisma generate` EPERM-fails otherwise on Windows.

Run:
```bash
npx prisma migrate dev --name add_external_payroll_run
```
Expected: prompts create `prisma/migrations/<timestamp>_add_external_payroll_run/migration.sql`, applies it, and ends with "Your database is now in sync with your schema." Prisma Client regenerates automatically as part of this command.

- [ ] **Step 4: Verify the client picks up the new model**

Run: `node -e "const prisma = require('./server/config/database'); console.log(typeof prisma.externalPayrollRun.findMany)"`
Expected: prints `function`.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add ExternalPayrollRun model for Beulah Payroll integration"
```

---

### Task 2: Extract `createBillRecord` + export `nextVendorCode` from `payableController.js`

Pure refactor — no behavior change. This is required so the new payroll code can create an AP bill without duplicating `createBill`'s logic. Existing tests in `tests/payableControllerCreateBill.test.js` must keep passing unchanged, since they assert on `prisma.bill.create` and `glPost.safePost` call shapes that this refactor must preserve exactly.

**Files:**
- Modify: `server/controllers/payableController.js`
- Test: `tests/payableControllerCreateBill.test.js` (existing — must still pass, no edits needed)

**Interfaces:**
- Produces: `exports.createBillRecord({ businessId, vendorId, billDate, dueDate, description, notes, lines, userId }) => Promise<Bill>` and `exports.nextVendorCode(businessId) => Promise<string>`, both used by Task 5.

- [ ] **Step 1: Run the existing createBill tests to confirm the current baseline passes**

Run: `npx jest tests/payableControllerCreateBill.test.js -v`
Expected: PASS (3 tests) — this is the safety net for the refactor.

- [ ] **Step 2: Export `nextVendorCode`**

In `server/controllers/payableController.js`, find:
```js
async function nextVendorCode(businessId) {
```
Directly after that function's closing `}` (before the `computeBillTotals` comment block), add:
```js
exports.nextVendorCode = nextVendorCode;
```

- [ ] **Step 3: Extract `createBillRecord` and make `createBill` a thin wrapper**

Replace the existing `exports.createBill` (currently):
```js
exports.createBill = async (req, res, next) => {
  try {
    const { vendorId, billDate, dueDate, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeBillTotals(lines);

    const billNo = await genBillNo();
    const bill = await prisma.bill.create({
      data: {
        businessId: req.businessId,
        billNo, vendorId: Number(vendorId),
        billDate: new Date(billDate), dueDate: new Date(dueDate),
        description, notes, subtotal, vatAmount, totalAmount,
        lines: { create: processedLines.map((l) => ({
          accountId: Number(l.accountId), description: l.description,
          quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
        })) },
      },
      include: { vendor: true, lines: true },
    });

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    await glPost.safePost({
      entryDate:   bill.billDate,
      description: `AP Bill — ${bill.vendor.name} (${bill.billNo})`,
      reference:   bill.billNo,
      lines:       buildBillGLLines(bill),
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    res.status(201).json(bill);
  } catch (err) { next(err); }
};
```

with:
```js
// Shared by createBill (route handler) and payrollController's Beulah-Payroll
// "Post to AP" action — both need the identical create-bill-then-GL-post
// sequence, just from different req shapes.
async function createBillRecord({ businessId, vendorId, billDate, dueDate, description, notes, lines, userId }) {
  const { subtotal, vatAmount, totalAmount, processedLines } = await computeBillTotals(lines);

  const billNo = await genBillNo();
  const bill = await prisma.bill.create({
    data: {
      businessId,
      billNo, vendorId: Number(vendorId),
      billDate: new Date(billDate), dueDate: new Date(dueDate),
      description, notes, subtotal, vatAmount, totalAmount,
      lines: { create: processedLines.map((l) => ({
        accountId: Number(l.accountId), description: l.description,
        quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
      })) },
    },
    include: { vendor: true, lines: true },
  });

  // ── Auto-post to GL ──────────────────────────────────────────────────────
  await glPost.safePost({
    entryDate:   bill.billDate,
    description: `AP Bill — ${bill.vendor.name} (${bill.billNo})`,
    reference:   bill.billNo,
    lines:       buildBillGLLines(bill),
    userId,
    businessId,
  });

  return bill;
}
exports.createBillRecord = createBillRecord;

exports.createBill = async (req, res, next) => {
  try {
    const { vendorId, billDate, dueDate, description, notes, lines } = req.body;
    const bill = await createBillRecord({
      businessId: req.businessId, vendorId, billDate, dueDate, description, notes, lines,
      userId: req.user?.id || 1,
    });
    res.status(201).json(bill);
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run the existing createBill tests again to confirm the refactor is behavior-preserving**

Run: `npx jest tests/payableControllerCreateBill.test.js -v`
Expected: PASS (same 3 tests, unchanged assertions).

- [ ] **Step 5: Run the full existing payable test suite to catch any other regression**

Run: `npx jest tests/payableController -v`
Expected: PASS (all payable controller test files).

- [ ] **Step 6: Commit**

```bash
git add server/controllers/payableController.js
git commit -m "refactor(payable): extract createBillRecord/nextVendorCode for reuse by payroll integration"
```

---

### Task 3: `beulahPayrollClient.js` service

**Files:**
- Create: `server/services/beulahPayrollClient.js`
- Test: `tests/beulahPayrollClient.test.js`

**Interfaces:**
- Produces: `listPayrollRunLockStatuses() => Promise<Array<RawRun>>`, `getPayrollRunLockStatus(externalRunId) => Promise<RawRun>`, where `RawRun` is the raw Beulah JSON shape (`id, period_start, period_end, payable_date, status, locked, entries_count, created_by, created_at, updated_at, summary: { gross_pay, total_deductions, net_pay, cash_advance, incentives }`). Both reject with a plain `Error` on non-2xx, timeout, or missing env config. Used by Task 4 and Task 5.

- [ ] **Step 1: Write the failing tests**

Create `tests/beulahPayrollClient.test.js`:
```js
const { listPayrollRunLockStatuses, getPayrollRunLockStatus } = require('../server/services/beulahPayrollClient');

describe('beulahPayrollClient', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...OLD_ENV,
      BEULAH_PAYROLL_BASE_URL: 'https://beulah.test/api',
      BEULAH_PAYROLL_API_TOKEN: 'tok123',
    };
    global.fetch = jest.fn();
  });

  afterEach(() => { process.env = OLD_ENV; });

  test('listPayrollRunLockStatuses GETs the list endpoint with a bearer token and returns data', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [{ id: 1 }] }) });

    const result = await listPayrollRunLockStatuses();

    expect(global.fetch).toHaveBeenCalledWith(
      'https://beulah.test/api/payroll-runs/lock-status',
      expect.objectContaining({
        headers: { Authorization: 'Bearer tok123', Accept: 'application/json' },
      })
    );
    expect(result).toEqual([{ id: 1 }]);
  });

  test('getPayrollRunLockStatus GETs the single-run endpoint', async () => {
    global.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: { id: 2 } }) });

    const result = await getPayrollRunLockStatus(2);

    expect(global.fetch).toHaveBeenCalledWith(
      'https://beulah.test/api/payroll-runs/2/lock-status',
      expect.anything()
    );
    expect(result).toEqual({ id: 2 });
  });

  test('throws with the status code when the response is not ok', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 401 });

    await expect(listPayrollRunLockStatuses()).rejects.toThrow('401');
  });

  test('throws a clear error when BEULAH_PAYROLL_BASE_URL is not configured', async () => {
    delete process.env.BEULAH_PAYROLL_BASE_URL;

    await expect(listPayrollRunLockStatuses()).rejects.toThrow('BEULAH_PAYROLL_BASE_URL');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('throws a clear error when BEULAH_PAYROLL_API_TOKEN is not configured', async () => {
    delete process.env.BEULAH_PAYROLL_API_TOKEN;

    await expect(listPayrollRunLockStatuses()).rejects.toThrow('BEULAH_PAYROLL_API_TOKEN');
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/beulahPayrollClient.test.js -v`
Expected: FAIL — `Cannot find module '../server/services/beulahPayrollClient'`.

- [ ] **Step 3: Write the implementation**

Create `server/services/beulahPayrollClient.js`:
```js
const TIMEOUT_MS = 5000;

function baseUrl() {
  const url = process.env.BEULAH_PAYROLL_BASE_URL;
  if (!url) throw new Error('BEULAH_PAYROLL_BASE_URL is not configured');
  return url.replace(/\/$/, '');
}

function authHeaders() {
  const token = process.env.BEULAH_PAYROLL_API_TOKEN;
  if (!token) throw new Error('BEULAH_PAYROLL_API_TOKEN is not configured');
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

async function request(path) {
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Beulah Payroll API ${path} responded ${res.status}`);
  const body = await res.json();
  return body.data;
}

function listPayrollRunLockStatuses() {
  return request('/payroll-runs/lock-status');
}

function getPayrollRunLockStatus(externalRunId) {
  return request(`/payroll-runs/${externalRunId}/lock-status`);
}

module.exports = { listPayrollRunLockStatuses, getPayrollRunLockStatus };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/beulahPayrollClient.test.js -v`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add server/services/beulahPayrollClient.js tests/beulahPayrollClient.test.js
git commit -m "feat(payroll): add beulahPayrollClient service for the external lock-status API"
```

---

### Task 4: `payrollController.getExternalPayrollRuns` (sync + list)

**Files:**
- Modify: `server/controllers/payrollController.js`
- Test: `tests/payrollControllerExternalRuns.test.js`

**Interfaces:**
- Consumes: `beulahPayrollClient.listPayrollRunLockStatuses()` (Task 3).
- Produces: `exports.getExternalPayrollRuns(req, res, next)` — `GET` handler returning `{ data: ExternalPayrollRun[], stale: boolean, lastSyncedAt: Date }` on success, or calling `next(createError(..., 502))` when unreachable with nothing persisted. Used by Task 6's route.

- [ ] **Step 1: Write the failing tests**

Create `tests/payrollControllerExternalRuns.test.js`:
```js
jest.mock('../server/config/database', () => ({
  externalPayrollRun: {
    upsert: jest.fn(),
    findMany: jest.fn(),
  },
}));
jest.mock('../server/services/beulahPayrollClient', () => ({
  listPayrollRunLockStatuses: jest.fn(),
}));

const prisma = require('../server/config/database');
const beulah = require('../server/services/beulahPayrollClient');
const ctrl = require('../server/controllers/payrollController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

const rawRun = {
  id: 2, period_start: '2026-07-16', period_end: '2026-07-31', payable_date: '2026-08-05',
  status: 'locked', entries_count: 9, created_by: 1,
  summary: { gross_pay: 81900, total_deductions: 4200, net_pay: 77700, cash_advance: 1500, incentives: 0 },
};
const storedRow = { id: 10, businessId: 1, externalRunId: 2, status: 'locked', syncedAt: new Date('2026-08-26') };

describe('getExternalPayrollRuns', () => {
  test('upserts every run returned by Beulah, keyed by businessId+externalRunId', async () => {
    beulah.listPayrollRunLockStatuses.mockResolvedValue([rawRun]);
    prisma.externalPayrollRun.upsert.mockResolvedValue({});
    prisma.externalPayrollRun.findMany.mockResolvedValue([storedRow]);

    const result = await run(ctrl.getExternalPayrollRuns, {});

    expect(prisma.externalPayrollRun.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId_externalRunId: { businessId: 1, externalRunId: 2 } },
      create: expect.objectContaining({ businessId: 1, externalRunId: 2, status: 'locked', entriesCount: 9, netPay: 77700 }),
      update: expect.objectContaining({ status: 'locked', entriesCount: 9, netPay: 77700 }),
    }));
    expect(result.data).toEqual([storedRow]);
    expect(result.stale).toBe(false);
  });

  test('falls back to persisted rows (stale: true) when Beulah is unreachable but rows exist', async () => {
    beulah.listPayrollRunLockStatuses.mockRejectedValue(new Error('timeout'));
    prisma.externalPayrollRun.findMany.mockResolvedValue([storedRow]);

    const result = await run(ctrl.getExternalPayrollRuns, {});

    expect(prisma.externalPayrollRun.upsert).not.toHaveBeenCalled();
    expect(result.data).toEqual([storedRow]);
    expect(result.stale).toBe(true);
    expect(result.lastSyncedAt).toEqual(storedRow.syncedAt);
  });

  test('responds 502 when Beulah is unreachable and nothing is persisted yet', async () => {
    beulah.listPayrollRunLockStatuses.mockRejectedValue(new Error('timeout'));
    prisma.externalPayrollRun.findMany.mockResolvedValue([]);

    await expect(run(ctrl.getExternalPayrollRuns, {})).rejects.toMatchObject({ statusCode: 502 });
  });

  test('scopes both the upsert and the read to req.businessId', async () => {
    beulah.listPayrollRunLockStatuses.mockResolvedValue([rawRun]);
    prisma.externalPayrollRun.upsert.mockResolvedValue({});
    prisma.externalPayrollRun.findMany.mockResolvedValue([]);

    await run(ctrl.getExternalPayrollRuns, { businessId: 7 });

    expect(prisma.externalPayrollRun.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId_externalRunId: { businessId: 7, externalRunId: 2 } },
    }));
    expect(prisma.externalPayrollRun.findMany).toHaveBeenCalledWith({
      where: { businessId: 7 }, orderBy: { periodStart: 'desc' },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/payrollControllerExternalRuns.test.js -v`
Expected: FAIL — `ctrl.getExternalPayrollRuns is not a function`.

- [ ] **Step 3: Write the implementation**

In `server/controllers/payrollController.js`, add near the top (after the existing `require`s):
```js
const beulahPayrollClient = require('../services/beulahPayrollClient');
const logger = require('../utils/logger');
```

Then add this new exported handler (e.g. after `exports.generate2316`):
```js
function toExternalPayrollRunData(run) {
  return {
    periodStart:       new Date(run.period_start),
    periodEnd:         new Date(run.period_end),
    payableDate:       new Date(run.payable_date),
    status:            run.status,
    entriesCount:      run.entries_count,
    grossPay:          run.summary.gross_pay,
    totalDeductions:   run.summary.total_deductions,
    netPay:            run.summary.net_pay,
    cashAdvance:       run.summary.cash_advance,
    incentives:        run.summary.incentives,
    externalCreatedBy: run.created_by,
  };
}

exports.getExternalPayrollRuns = async (req, res, next) => {
  try {
    const runs = await beulahPayrollClient.listPayrollRunLockStatuses();
    for (const run of runs) {
      const data = toExternalPayrollRunData(run);
      await prisma.externalPayrollRun.upsert({
        where:  { businessId_externalRunId: { businessId: req.businessId, externalRunId: run.id } },
        create: { businessId: req.businessId, externalRunId: run.id, ...data },
        update: data,
      });
    }

    const rows = await prisma.externalPayrollRun.findMany({
      where: { businessId: req.businessId }, orderBy: { periodStart: 'desc' },
    });
    res.json({ data: rows, stale: false, lastSyncedAt: new Date() });
  } catch (fetchErr) {
    logger.warn(`[BEULAH PAYROLL SYNC FAILED] biz=${req.businessId} — ${fetchErr.message}`);
    try {
      const rows = await prisma.externalPayrollRun.findMany({
        where: { businessId: req.businessId }, orderBy: { periodStart: 'desc' },
      });
      if (rows.length === 0) throw createError('Could not reach external payroll system', 502);
      const lastSyncedAt = rows.reduce((max, r) => (r.syncedAt > max ? r.syncedAt : max), rows[0].syncedAt);
      res.json({ data: rows, stale: true, lastSyncedAt });
    } catch (err) { next(err); }
  }
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/payrollControllerExternalRuns.test.js -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add server/controllers/payrollController.js tests/payrollControllerExternalRuns.test.js
git commit -m "feat(payroll): sync and list external Beulah payroll runs"
```

---

### Task 5: `payrollController.postExternalPayrollRunToAP`

**Files:**
- Modify: `server/controllers/payrollController.js`
- Test: `tests/payrollControllerPostToAP.test.js`

**Interfaces:**
- Consumes: `beulahPayrollClient.getPayrollRunLockStatus(id)` (Task 3), `payableController.createBillRecord(...)` and `payableController.nextVendorCode(businessId)` (Task 2).
- Produces: `exports.postExternalPayrollRunToAP(req, res, next)` — `POST` handler. Used by Task 6's route.

- [ ] **Step 1: Write the failing tests**

Create `tests/payrollControllerPostToAP.test.js`:
```js
jest.mock('../server/config/database', () => ({
  externalPayrollRun: { findUnique: jest.fn(), update: jest.fn() },
  vendor: { findFirst: jest.fn(), create: jest.fn() },
  account: { findFirst: jest.fn() },
}));
jest.mock('../server/services/beulahPayrollClient', () => ({ getPayrollRunLockStatus: jest.fn() }));
jest.mock('../server/controllers/payableController', () => ({
  createBillRecord: jest.fn(),
  nextVendorCode: jest.fn(),
}));

const prisma = require('../server/config/database');
const beulah = require('../server/services/beulahPayrollClient');
const payableController = require('../server/controllers/payableController');
const ctrl = require('../server/controllers/payrollController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, user: { id: 5 }, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

const storedRow = {
  id: 10, businessId: 1, externalRunId: 2, status: 'locked', postedBillId: null,
  periodStart: new Date('2026-07-16'), periodEnd: new Date('2026-07-31'), payableDate: new Date('2026-08-05'),
  entriesCount: 9, grossPay: 81900, totalDeductions: 4200, netPay: 77700, cashAdvance: 1500, incentives: 0,
};
const liveRun = {
  id: 2, period_start: '2026-07-16', period_end: '2026-07-31', payable_date: '2026-08-05',
  status: 'locked', entries_count: 9, created_by: 1,
  summary: { gross_pay: 81900, total_deductions: 4200, net_pay: 77700, cash_advance: 1500, incentives: 0 },
};

describe('postExternalPayrollRunToAP', () => {
  test('404s when the run has never been synced', async () => {
    prisma.externalPayrollRun.findUnique.mockResolvedValue(null);

    await expect(run(ctrl.postExternalPayrollRunToAP, { params: { externalRunId: '2' } }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(beulah.getPayrollRunLockStatus).not.toHaveBeenCalled();
  });

  test('400s when the (freshly re-fetched) run is still draft', async () => {
    prisma.externalPayrollRun.findUnique.mockResolvedValue({ ...storedRow, status: 'draft' });
    beulah.getPayrollRunLockStatus.mockResolvedValue({ ...liveRun, status: 'draft' });
    prisma.externalPayrollRun.update.mockResolvedValue({ ...storedRow, status: 'draft' });

    await expect(run(ctrl.postExternalPayrollRunToAP, { params: { externalRunId: '2' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(payableController.createBillRecord).not.toHaveBeenCalled();
  });

  test('409s when the run is already posted', async () => {
    prisma.externalPayrollRun.findUnique.mockResolvedValue({ ...storedRow, postedBillId: 55 });
    beulah.getPayrollRunLockStatus.mockResolvedValue(liveRun);
    prisma.externalPayrollRun.update.mockResolvedValue({ ...storedRow, postedBillId: 55 });

    await expect(run(ctrl.postExternalPayrollRunToAP, { params: { externalRunId: '2' } }))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(payableController.createBillRecord).not.toHaveBeenCalled();
  });

  test('creates the vendor, bill, and marks the run posted on first post', async () => {
    prisma.externalPayrollRun.findUnique.mockResolvedValue(storedRow);
    beulah.getPayrollRunLockStatus.mockResolvedValue(liveRun);
    prisma.externalPayrollRun.update.mockImplementation((args) => Promise.resolve({ ...storedRow, ...args.data }));
    prisma.vendor.findFirst.mockResolvedValue(null);
    payableController.nextVendorCode.mockResolvedValue('VEN-003');
    prisma.vendor.create.mockResolvedValue({ id: 9, name: 'Beulah Payroll (Employees Payable)' });
    prisma.account.findFirst.mockResolvedValue({ id: 42, accountCode: '6110' });
    payableController.createBillRecord.mockResolvedValue({ id: 77, billNo: 'BILL-000077' });

    const result = await run(ctrl.postExternalPayrollRunToAP, { params: { externalRunId: '2' } });

    expect(prisma.vendor.findFirst).toHaveBeenCalledWith({ where: { businessId: 1, name: 'Beulah Payroll (Employees Payable)' } });
    expect(prisma.vendor.create).toHaveBeenCalledWith({ data: { businessId: 1, vendorCode: 'VEN-003', name: 'Beulah Payroll (Employees Payable)' } });
    expect(prisma.account.findFirst).toHaveBeenCalledWith({ where: { businessId: 1, accountCode: '6110' } });
    expect(payableController.createBillRecord).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 1, vendorId: 9, userId: 5,
      lines: [expect.objectContaining({ accountId: 42, unitPrice: 77700, vatCode: 'EXEMPT' })],
    }));
    expect(prisma.externalPayrollRun.update).toHaveBeenLastCalledWith({
      where: { id: 10 },
      data: { postedBillId: 77, postedById: 5, postedAt: expect.any(Date) },
    });
    expect(result.data.bill).toEqual({ id: 77, billNo: 'BILL-000077' });
  });

  test('reuses an existing vendor instead of creating a duplicate', async () => {
    prisma.externalPayrollRun.findUnique.mockResolvedValue(storedRow);
    beulah.getPayrollRunLockStatus.mockResolvedValue(liveRun);
    prisma.externalPayrollRun.update.mockImplementation((args) => Promise.resolve({ ...storedRow, ...args.data }));
    prisma.vendor.findFirst.mockResolvedValue({ id: 3, name: 'Beulah Payroll (Employees Payable)' });
    prisma.account.findFirst.mockResolvedValue({ id: 42, accountCode: '6110' });
    payableController.createBillRecord.mockResolvedValue({ id: 78, billNo: 'BILL-000078' });

    await run(ctrl.postExternalPayrollRunToAP, { params: { externalRunId: '2' } });

    expect(prisma.vendor.create).not.toHaveBeenCalled();
    expect(payableController.createBillRecord).toHaveBeenCalledWith(expect.objectContaining({ vendorId: 3 }));
  });

  test('falls back to the last-synced row when the live refresh fails, and still posts', async () => {
    prisma.externalPayrollRun.findUnique.mockResolvedValue(storedRow);
    beulah.getPayrollRunLockStatus.mockRejectedValue(new Error('timeout'));
    prisma.vendor.findFirst.mockResolvedValue({ id: 3 });
    prisma.account.findFirst.mockResolvedValue({ id: 42 });
    payableController.createBillRecord.mockResolvedValue({ id: 79, billNo: 'BILL-000079' });
    prisma.externalPayrollRun.update.mockResolvedValue({ ...storedRow, postedBillId: 79 });

    const result = await run(ctrl.postExternalPayrollRunToAP, { params: { externalRunId: '2' } });

    expect(payableController.createBillRecord).toHaveBeenCalledWith(expect.objectContaining({
      lines: [expect.objectContaining({ unitPrice: storedRow.netPay })],
    }));
    expect(result.data.bill.id).toBe(79);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/payrollControllerPostToAP.test.js -v`
Expected: FAIL — `ctrl.postExternalPayrollRunToAP is not a function`.

- [ ] **Step 3: Write the implementation**

In `server/controllers/payrollController.js`, add near the top (with the other `require`s):
```js
const payableController = require('./payableController');
```

Then add (after `exports.getExternalPayrollRuns` from Task 4):
```js
const BEULAH_VENDOR_NAME = 'Beulah Payroll (Employees Payable)';

async function findOrCreateBeulahVendor(businessId) {
  const existing = await prisma.vendor.findFirst({ where: { businessId, name: BEULAH_VENDOR_NAME } });
  if (existing) return existing;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const vendorCode = await payableController.nextVendorCode(businessId);
      return await prisma.vendor.create({ data: { businessId, vendorCode, name: BEULAH_VENDOR_NAME } });
    } catch (err) {
      if (err.code === 'P2002' && attempt < 4) continue;
      throw err;
    }
  }
}

exports.postExternalPayrollRunToAP = async (req, res, next) => {
  try {
    const externalRunId = Number(req.params.externalRunId);
    let dbRun = await prisma.externalPayrollRun.findUnique({
      where: { businessId_externalRunId: { businessId: req.businessId, externalRunId } },
    });
    if (!dbRun) throw createError('External payroll run not found — view the Pay Periods page to sync it first', 404);

    try {
      const live = await beulahPayrollClient.getPayrollRunLockStatus(externalRunId);
      dbRun = await prisma.externalPayrollRun.update({
        where: { id: dbRun.id },
        data: toExternalPayrollRunData(live),
      });
    } catch (liveErr) {
      logger.warn(`[BEULAH PAYROLL POST — LIVE REFRESH FAILED] runId=${externalRunId} — ${liveErr.message}`);
      // Proceed with the last-synced values already loaded above.
    }

    if (dbRun.status !== 'locked') throw createError('Only a locked payroll run can be posted to Accounts Payable', 400);
    if (dbRun.postedBillId) throw createError(`This run was already posted as bill #${dbRun.postedBillId}`, 409);

    const vendor = await findOrCreateBeulahVendor(req.businessId);
    const account = await prisma.account.findFirst({ where: { businessId: req.businessId, accountCode: '6110' } });
    if (!account) throw createError('Salaries and Wages account (6110) not found in the chart of accounts', 400);

    const periodLabel = `${dbRun.periodStart.toISOString().slice(0, 10)}–${dbRun.periodEnd.toISOString().slice(0, 10)}`;
    const bill = await payableController.createBillRecord({
      businessId: req.businessId,
      vendorId: vendor.id,
      billDate: dbRun.payableDate,
      dueDate: dbRun.payableDate,
      description: `Payroll ${periodLabel} (Beulah run #${dbRun.externalRunId})`,
      notes: `Gross: ${dbRun.grossPay}, Deductions: ${dbRun.totalDeductions}, Cash Advance: ${dbRun.cashAdvance}, Incentives: ${dbRun.incentives}`,
      lines: [{
        accountId: account.id,
        description: `Net pay — Beulah run #${dbRun.externalRunId}`,
        quantity: 1,
        unitPrice: dbRun.netPay,
        vatCode: 'EXEMPT',
      }],
      userId: req.user.id,
    });

    const updated = await prisma.externalPayrollRun.update({
      where: { id: dbRun.id },
      data: { postedBillId: bill.id, postedById: req.user.id, postedAt: new Date() },
    });

    res.status(201).json({ data: { run: updated, bill } });
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/payrollControllerPostToAP.test.js -v`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the full payroll + payable test suites to confirm no regressions**

Run: `npx jest tests/payroll tests/payable -v`
Expected: PASS (all).

- [ ] **Step 6: Commit**

```bash
git add server/controllers/payrollController.js tests/payrollControllerPostToAP.test.js
git commit -m "feat(payroll): post a locked Beulah payroll run to Accounts Payable"
```

---

### Task 6: Routes + env vars

**Files:**
- Modify: `server/routes/payroll.js`
- Modify: `.env.example`
- Modify: `.env` (untracked — not committed)

**Interfaces:**
- Consumes: `payrollController.getExternalPayrollRuns`, `payrollController.postExternalPayrollRunToAP` (Tasks 4–5).
- Produces: `GET /api/payroll/external-runs`, `POST /api/payroll/external-runs/:externalRunId/post-to-ap`. Used by Task 7's `lib/api.js`.

- [ ] **Step 1: Add the routes**

In `server/routes/payroll.js`, add after the existing `router.get('/bir2316/:employeeId/:year', ctrl.generate2316);` line, before `module.exports = router;`:
```js

// External payroll (Beulah Payroll) — read-only sync + AP posting
router.get('/external-runs', ctrl.getExternalPayrollRuns);
router.post('/external-runs/:externalRunId/post-to-ap',
  authorize('ADMIN', 'MANAGER'), param('externalRunId').isInt(), validate, ctrl.postExternalPayrollRunToAP);
```
(`GET` inherits the router-level `authorize('ADMIN', 'MANAGER', 'ACCOUNTANT')` already applied at the top of the file — no per-route override needed there.)

- [ ] **Step 2: Add env var placeholders to `.env.example`**

In `.env.example`, insert this block right after the existing `LEAD_EXPORT_API_KEY=` line, before the `# ─── Database backups` section:
```
# ─── Beulah Payroll (external payroll system, read-only lock-status API) ────
# Server-only — never expose to the browser. Leave blank to disable the
# Pay Periods page's external-runs widget (GET returns 502).
BEULAH_PAYROLL_BASE_URL=
BEULAH_PAYROLL_API_TOKEN=
```

- [ ] **Step 3: Add the real values to the untracked `.env`**

In `.env`, append:
```
BEULAH_PAYROLL_BASE_URL=https://beulahpayroll.up.railway.app/api
BEULAH_PAYROLL_API_TOKEN=1|enu1KspR1agUGuHGXUgnWs7KQhw7GSxhxmF9PiPv1c6b3e5a
```

- [ ] **Step 4: Confirm `.env` is not staged**

Run: `git status --short .env`
Expected: no output (file is gitignored, confirmed already in this repo's `.gitignore`).

- [ ] **Step 5: Commit (routes + example only)**

```bash
git add server/routes/payroll.js .env.example
git commit -m "feat(payroll): wire up external-runs routes for Beulah Payroll"
```

---

### Task 7: `lib/api.js` additions

**Files:**
- Modify: `lib/api.js`

**Interfaces:**
- Produces: `payroll.externalRuns.list()`, `payroll.externalRuns.postToAP(externalRunId)`. Used by Task 8's component.

- [ ] **Step 1: Add the API helpers**

In `lib/api.js`, inside the `export const payroll = { ... }` block, add a new `externalRuns` key after the existing `periods` key (before `calculator`):
```js
  externalRuns: {
    list:     ()               => api.get('/payroll/external-runs'),
    postToAP: (externalRunId)  => api.post(`/payroll/external-runs/${externalRunId}/post-to-ap`),
  },
```

- [ ] **Step 2: Sanity-check the file parses**

Run: `node -e "require('@babel/core')" 2>/dev/null; node --input-type=module -e "import('./lib/api.js').then(()=>console.log('ok')).catch(e=>{console.error(e); process.exit(1)})"`

If that fails only due to the Axios browser-only interceptor logic (e.g. referencing `window`/`localStorage`), instead just visually confirm the added block matches the existing `employees`/`periods` object style exactly (trailing commas, arrow-function style) — this file already has no automated test coverage in `tests/`.

- [ ] **Step 3: Commit**

```bash
git add lib/api.js
git commit -m "feat(payroll): add externalRuns API helpers"
```

---

### Task 8: `ExternalPayrollWidget.jsx` + wire into Pay Periods page

**Files:**
- Create: `app/(dashboard)/payroll/periods/ExternalPayrollWidget.jsx`
- Modify: `app/(dashboard)/payroll/periods/page.jsx`

**Interfaces:**
- Consumes: `payroll.externalRuns.list()`, `payroll.externalRuns.postToAP(id)` (Task 7); `getUser` and `formatCurrency`, `formatDate` from `@/lib/auth`.
- Produces: `<ExternalPayrollWidget />`, a self-contained card with no props, rendered once on the Pay Periods page.

- [ ] **Step 1: Create the widget component**

Create `app/(dashboard)/payroll/periods/ExternalPayrollWidget.jsx`:
```jsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { payroll as pApi } from '@/lib/api';
import { getUser, formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import { Loader2, RefreshCw, ExternalLink } from 'lucide-react';

const STATUS_BADGE = { locked: 'badge-green', draft: 'badge-yellow' };

export default function ExternalPayrollWidget() {
  const [runs, setRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hardError, setHardError] = useState(false);
  const [stale, setStale] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState(null);
  const [postingId, setPostingId] = useState(null);

  const canPost = ['ADMIN', 'MANAGER'].includes(getUser()?.role);

  const load = useCallback(() => {
    setLoading(true);
    setHardError(false);
    pApi.externalRuns.list()
      .then((r) => {
        setRuns(r.data.data || []);
        setStale(!!r.data.stale);
        setLastSyncedAt(r.data.lastSyncedAt || null);
      })
      .catch(() => setHardError(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePostToAP = async (run) => {
    if (!confirm(`Post ${formatCurrency(run.netPay)} net pay for this run to Accounts Payable?`)) return;
    setPostingId(run.id);
    try {
      await pApi.externalRuns.postToAP(run.externalRunId);
      toast.success('Posted to Accounts Payable');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to post to Accounts Payable');
    } finally { setPostingId(null); }
  };

  return (
    <div className="card">
      <div className="p-5 border-b border-gray-100 flex items-center justify-between">
        <div>
          <h3 className="font-bold text-gray-900">Beulah Payroll — External Runs</h3>
          {lastSyncedAt && (
            <p className={`text-xs mt-0.5 ${stale ? 'text-yellow-600' : 'text-gray-400'}`}>
              {stale ? `Showing data as of ${formatDate(lastSyncedAt)} — refresh failed` : `Synced ${formatDate(lastSyncedAt)}`}
            </p>
          )}
        </div>
        <button onClick={load} className="btn-secondary btn-sm" disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-10 text-gray-400">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading external payroll runs...
        </div>
      ) : hardError ? (
        <div className="p-6 text-center">
          <p className="text-sm text-gray-500 mb-3">Couldn't load external payroll data.</p>
          <button onClick={load} className="btn-secondary btn-sm">Retry</button>
        </div>
      ) : runs.length === 0 ? (
        <div className="p-6 text-center text-sm text-gray-400">No external payroll runs found yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="table text-sm">
            <thead>
              <tr>
                <th>Period</th><th>Payable Date</th><th>Status</th><th className="text-right">Entries</th>
                <th className="text-right">Gross</th><th className="text-right">Deductions</th>
                <th className="text-right">Net</th><th className="text-right">Cash Advance</th>
                <th className="text-right">Incentives</th><th></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.periodStart)} – {formatDate(r.periodEnd)}</td>
                  <td>{formatDate(r.payableDate)}</td>
                  <td><span className={`badge ${STATUS_BADGE[r.status] || 'badge-gray'}`}>{r.status}</span></td>
                  <td className="text-right">{r.entriesCount}</td>
                  <td className="text-right font-mono">{formatCurrency(r.grossPay)}</td>
                  <td className="text-right font-mono text-red-500">({formatCurrency(r.totalDeductions)})</td>
                  <td className="text-right font-mono font-bold text-green-600">{formatCurrency(r.netPay)}</td>
                  <td className="text-right font-mono">{formatCurrency(r.cashAdvance)}</td>
                  <td className="text-right font-mono">{formatCurrency(r.incentives)}</td>
                  <td className="text-right">
                    {r.postedBillId ? (
                      <span className="text-xs text-gray-500 flex items-center gap-1 justify-end">
                        <ExternalLink className="w-3 h-3" /> Posted
                      </span>
                    ) : r.status === 'locked' && canPost ? (
                      <button
                        onClick={() => handlePostToAP(r)}
                        disabled={postingId === r.id}
                        className="btn-primary btn-sm"
                      >
                        {postingId === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Post to AP'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

Note: `formatDate` receiving `null` from a run with no `lastSyncedAt` never happens here because the surrounding `{lastSyncedAt && ...}` guards it. The "Posted" cell doesn't show the bill number here (no `billNo` field comes back on the list — only `postedBillId`); that's acceptable per the spec ("Posted" state is enough context on this widget), and matches the AP module having no per-bill detail route to link to anyway.

- [ ] **Step 2: Wire the widget into the Pay Periods page**

In `app/(dashboard)/payroll/periods/page.jsx`, add the import at the top (after the existing `formatCurrency, formatDate` import):
```js
import ExternalPayrollWidget from './ExternalPayrollWidget';
```

Then insert `<ExternalPayrollWidget />` between the "Workflow guide" block and the "Periods grid" block — i.e. right after the closing `</div>` of the workflow-guide `<div className="bg-blue-50 ...">` block (currently ending right before the `{/* Periods grid */}` comment):
```jsx
      {/* Beulah Payroll — external runs */}
      <ExternalPayrollWidget />

      {/* Periods grid */}
```

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/payroll/periods/ExternalPayrollWidget.jsx" "app/(dashboard)/payroll/periods/page.jsx"
git commit -m "feat(payroll): show Beulah Payroll external runs on the Pay Periods page"
```

---

### Task 9: End-to-end manual verification

No new automated tests here — this closes the loop with a real dev server against the real (or a temporary test) Beulah credentials, per this repo's `verify` skill.

**Files:** none (verification only)

- [ ] **Step 1: Confirm nothing else is already listening, then start the dev server**

Run (PowerShell): `Get-NetTCPConnection -LocalPort 3000,5000 -State Listen -ErrorAction SilentlyContinue`
If nothing is listening and the user hasn't already got `npm run dev` running themselves, ask before starting one — this repo's convention is that the user owns their own dev server session. If they confirm, run `npm run dev` and wait for `http://localhost:3000` to respond.

- [ ] **Step 2: Mint a verification JWT and call the new endpoints directly**

```bash
node -e "
require('dotenv').config();
const jwt = require('jsonwebtoken');
console.log(jwt.sign({ id: 1, email: 'admin@ph-erp.com', role: 'ADMIN', name: 'Verify Bot' }, process.env.JWT_SECRET, { expiresIn: '1h' }));
"
```
Then:
```bash
curl -s http://localhost:3000/api/payroll/external-runs -H "Authorization: Bearer <token>" | head -c 2000
```
Expected: `{"data":[...],"stale":false,"lastSyncedAt":"..."}` — one entry per run currently in Beulah's `/api/payroll-runs/lock-status`. If `BEULAH_PAYROLL_BASE_URL`/`TOKEN` are wrong or Beulah is unreachable, expect either `stale:true` (if a prior successful sync exists) or a `502` — confirm the error message is the one from Task 4, not a raw stack trace.

- [ ] **Step 3: Post a locked run to AP, if one exists**

Pick a `locked` run's `id` from Step 2's response (call it `<id>`):
```bash
curl -s -X POST http://localhost:3000/api/payroll/external-runs/<id>/post-to-ap -H "Authorization: Bearer <token>"
```
Expected: `201` with `{"data":{"run":{...,"postedBillId":<n>},"bill":{...}}}`. Re-running the same call is expected to now `409`.

Then confirm the GL side landed correctly:
```bash
node -e "
require('dotenv').config();
const prisma = require('./server/config/database');
prisma.journalEntry.findFirst({ where: { reference: { contains: 'BILL-' } }, orderBy: { id: 'desc' }, include: { lines: true } })
  .then(e => { console.log(JSON.stringify(e, null, 2)); process.exit(0); });
"
```
Expected: the newest bill's journal entry has one DR line on account `6110` and one CR line on `2010`, both equal to the run's `net_pay`.

- [ ] **Step 4: Drive the UI**

Set `localStorage` per the verify skill (`accessToken`, `refreshToken`, `user`), navigate to `http://localhost:3000/payroll/periods` at viewport ≥1440×900, and confirm:
- The "Beulah Payroll — External Runs" card renders with the same rows seen in Step 2.
- A `locked` + unposted row shows a "Post to AP" button; clicking it, confirming, and waiting shows a success toast and the row switches to "Posted".
- A `draft` row shows no action button.
- Log in as (or simulate) an ACCOUNTANT-role user and confirm the "Post to AP" button does not render for them, even though the table itself does.

- [ ] **Step 5: Report results, no commit**

This task produces no file changes — summarize what was confirmed (or any gaps found) back to the user instead of committing.
