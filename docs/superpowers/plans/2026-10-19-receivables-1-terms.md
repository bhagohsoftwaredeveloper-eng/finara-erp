# Payment Terms Implementation Plan (Receivables Docs, Phase 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users define payment terms (COD, Net 15, Net 30, Net 60, or their own), set a default per customer, pick terms on an invoice (due date auto-computes, still editable), and show the terms on the invoice list and print.

**Architecture:** New `PaymentTerm` table per business (lazy-seeded with four defaults on first list). `Customer.defaultTermId` and `Invoice.termId` point at a term; the invoice also snapshots `termsName` / `termsDays` so editing a term later never rewrites issued invoices. Due-date arithmetic lives in one CommonJS file (`lib/terms.js`) shared by the Express server and the Next.js UI.

**Tech Stack:** Express + Prisma 5 (MySQL), Next.js 14 App Router, Jest.

Spec: `docs/superpowers/specs/2026-10-19-receivables-docs-design.md` (section 1).

## Global Constraints

- Execute in an isolated git worktree off `main` (superpowers:using-git-worktrees). The main working tree has uncommitted user changes in `server/controllers/receivableController.js`, `app/(dashboard)/receivable/page.jsx`, `lib/api.js`, `components/layout/Sidebar.jsx`, `lib/print.js` and `prisma/schema.prisma`. Never `git add` those from the main tree. Never pass `isolation: "worktree"` to a subagent from inside the worktree.
- Every Prisma query is scoped by `req.businessId`.
- Document numbers come from `nextDocNumber` (`server/utils/docNumber.js`), never from a row count.
- Migration SQL is hand-written with the Write tool (no BOM) in `prisma/migrations/<timestamp>_<name>/migration.sql`, applied with `npm run db:deploy`. The user owns the dev server: ask them to stop `npm run dev` before `npm run db:generate` (Windows EPERM on the Prisma DLL). Never start a competing dev server and never run `next build` in the directory where the dev server is running.
- UI follows the existing conventions: `card`, `btn-primary`, `btn-secondary`, `input`, `label`, `badge-*`, Lucide icons, `react-hot-toast`.
- Tests: `npx jest tests/<file>.test.js`. Controller tests mock `../server/config/database` like `tests/cashSaleController.test.js`.
- Commits list explicit paths (`git add <paths>`), end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: Schema and migration

**Files:**
- Modify: `prisma/schema.prisma` (Customer ~line 356, Invoice ~line 379, new model after `PaymentAR` enums)
- Create: `prisma/migrations/20261019090000_add_payment_terms/migration.sql`

**Interfaces:**
- Produces: Prisma models/fields `paymentTerm`, `customer.defaultTermId`, `invoice.termId`, `invoice.termsName`, `invoice.termsDays`.

- [ ] **Step 1: Add the model and fields to `schema.prisma`**

In `model Customer`, after the `phone` line add:

```prisma
  defaultTermId Int?
```

In `model Invoice`, after the `dueDate` line add:

```prisma
  termId      Int?
  termsName   String?       @db.VarChar(50)
  termsDays   Int?
```

Directly above `enum PaymentStatus` add:

```prisma
// ─── Payment Terms ─────────────────────────────────────────
// Invoices snapshot name/days (Invoice.termsName/termsDays), so editing or
// disabling a term never changes an invoice that was already issued.
model PaymentTerm {
  id         Int      @id @default(autoincrement())
  businessId Int      @default(1)
  name       String   @db.VarChar(50)
  days       Int      @default(0)
  isActive   Boolean  @default(true)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([businessId, name])
  @@index([businessId])
  @@map("payment_terms")
}
```

- [ ] **Step 2: Write the migration with the Write tool**

```sql
-- CreateTable
CREATE TABLE `payment_terms` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `businessId` INTEGER NOT NULL DEFAULT 1,
    `name` VARCHAR(50) NOT NULL,
    `days` INTEGER NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `payment_terms_businessId_idx`(`businessId`),
    UNIQUE INDEX `payment_terms_businessId_name_key`(`businessId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `customers` ADD COLUMN `defaultTermId` INTEGER NULL;

-- AlterTable
ALTER TABLE `invoices` ADD COLUMN `termId` INTEGER NULL,
    ADD COLUMN `termsName` VARCHAR(50) NULL,
    ADD COLUMN `termsDays` INTEGER NULL;
```

- [ ] **Step 3: Validate, apply, regenerate**

Run: `npx prisma validate`
Expected: `The schema at prisma\schema.prisma is valid`

Ask the user to stop `npm run dev` (Prisma DLL lock), then run:
`npm run db:deploy` then `npm run db:generate`
Expected: `Applying migration 20261019090000_add_payment_terms` and `Generated Prisma Client`.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261019090000_add_payment_terms/migration.sql
git commit -m "feat(terms): add PaymentTerm model and invoice/customer term fields"
```

---

### Task 2: Shared due-date helper

**Files:**
- Create: `lib/terms.js`
- Test: `tests/terms.test.js`

**Interfaces:**
- Produces (CommonJS, same style as `lib/draftStorage.js`, importable from both server and UI):
  - `DEFAULT_TERMS: Array<{ name: string, days: number }>`
  - `computeDueDate(invoiceDate: string|Date, days: number): string` returns `'YYYY-MM-DD'`; throws `Error` on a bad date or when `days` is not a whole number >= 0.

- [ ] **Step 1: Write the failing test** (`tests/terms.test.js`)

```js
const { DEFAULT_TERMS, computeDueDate } = require('../lib/terms');

describe('computeDueDate', () => {
  test('adds the term days to the invoice date', () => {
    expect(computeDueDate('2026-01-15', 30)).toBe('2026-02-14');
  });

  test('COD (0 days) is due the same day', () => {
    expect(computeDueDate('2026-03-10', 0)).toBe('2026-03-10');
  });

  test('crosses month ends and short months', () => {
    expect(computeDueDate('2026-01-31', 30)).toBe('2026-03-02');
  });

  test('handles leap years', () => {
    expect(computeDueDate('2028-02-28', 1)).toBe('2028-02-29');
  });

  test('accepts a Date or an ISO timestamp, using only the date part', () => {
    expect(computeDueDate(new Date('2026-05-01T00:00:00Z'), 15)).toBe('2026-05-16');
    expect(computeDueDate('2026-05-01T16:30:00.000Z', 15)).toBe('2026-05-16');
  });

  test('accepts days given as a numeric string (form input)', () => {
    expect(computeDueDate('2026-05-01', '15')).toBe('2026-05-16');
  });

  test('rejects an invalid date', () => {
    expect(() => computeDueDate('not-a-date', 30)).toThrow('Invalid invoice date');
  });

  test('rejects negative or fractional days', () => {
    expect(() => computeDueDate('2026-01-01', -1)).toThrow('whole number');
    expect(() => computeDueDate('2026-01-01', 1.5)).toThrow('whole number');
  });
});

describe('DEFAULT_TERMS', () => {
  test('ships COD, Net 15, Net 30, Net 60', () => {
    expect(DEFAULT_TERMS).toEqual([
      { name: 'COD', days: 0 },
      { name: 'Net 15', days: 15 },
      { name: 'Net 30', days: 30 },
      { name: 'Net 60', days: 60 },
    ]);
  });
});
```

- [ ] **Step 2: Run it, expect FAIL**

Run: `npx jest tests/terms.test.js`
Expected: FAIL, `Cannot find module '../lib/terms'`.

- [ ] **Step 3: Implement `lib/terms.js`**

```js
// Payment-terms helpers shared by the Express API and the Next.js UI.
// CommonJS on purpose (same as lib/draftStorage.js) so both can require it.

const DEFAULT_TERMS = [
  { name: 'COD',    days: 0 },
  { name: 'Net 15', days: 15 },
  { name: 'Net 30', days: 30 },
  { name: 'Net 60', days: 60 },
];

// invoiceDate + days as 'YYYY-MM-DD'. Works in UTC on the date part only, so a
// server in UTC and a browser in Manila always agree on the result.
function computeDueDate(invoiceDate, days) {
  const d = new Date(`${String(invoiceDate instanceof Date ? invoiceDate.toISOString() : invoiceDate).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error('Invalid invoice date');
  const n = Number(days);
  if (!Number.isInteger(n) || n < 0) throw new Error('Terms days must be a whole number of 0 or more');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

module.exports = { DEFAULT_TERMS, computeDueDate };
```

- [ ] **Step 4: Run it, expect PASS**

Run: `npx jest tests/terms.test.js`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/terms.js tests/terms.test.js
git commit -m "feat(terms): shared computeDueDate helper"
```

---

### Task 3: Payment-terms API

**Files:**
- Create: `server/controllers/paymentTermController.js`
- Modify: `server/routes/receivable.js` (register before `router.get('/:id', ...)`)
- Modify: `lib/api.js` (inside `export const receivable`, after `invoices`)
- Modify: `server/controllers/backupController.js` (receivable section, lines ~76-90)
- Test: `tests/paymentTermController.test.js`

**Interfaces:**
- Produces HTTP: `GET /api/receivable/terms?active=true|false`, `POST /api/receivable/terms` (ADMIN, MANAGER), `PUT /api/receivable/terms/:id` (ADMIN, MANAGER). Term JSON: `{ id, businessId, name, days, isActive }`.
- Produces UI client: `receivable.terms.{ list(params), create(data), update(id, data) }`.
- Behaviour: first `GET` for a business with no terms seeds `DEFAULT_TERMS`.

- [ ] **Step 1: Write the failing tests** (`tests/paymentTermController.test.js`)

```js
jest.mock('../server/config/database', () => ({
  paymentTerm: {
    count: jest.fn(), createMany: jest.fn(), findMany: jest.fn(),
    findFirst: jest.fn(), create: jest.fn(), update: jest.fn(),
  },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/paymentTermController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('listTerms', () => {
  test('seeds the four defaults the first time a business lists terms', async () => {
    prisma.paymentTerm.count.mockResolvedValue(0);
    prisma.paymentTerm.findMany.mockResolvedValue([]);

    await run(ctrl.listTerms, {});

    expect(prisma.paymentTerm.createMany).toHaveBeenCalledWith({
      data: [
        { businessId: 1, name: 'COD', days: 0 },
        { businessId: 1, name: 'Net 15', days: 15 },
        { businessId: 1, name: 'Net 30', days: 30 },
        { businessId: 1, name: 'Net 60', days: 60 },
      ],
      skipDuplicates: true,
    });
  });

  test('does not seed when the business already has terms', async () => {
    prisma.paymentTerm.count.mockResolvedValue(3);
    prisma.paymentTerm.findMany.mockResolvedValue([]);

    await run(ctrl.listTerms, {});

    expect(prisma.paymentTerm.createMany).not.toHaveBeenCalled();
  });

  test('only returns this business, and filters by active when asked', async () => {
    prisma.paymentTerm.count.mockResolvedValue(3);
    prisma.paymentTerm.findMany.mockResolvedValue([]);

    await run(ctrl.listTerms, { query: { active: 'true' } });

    expect(prisma.paymentTerm.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { businessId: 1, isActive: true } })
    );
  });
});

describe('createTerm', () => {
  test('creates a trimmed term scoped to the business', async () => {
    prisma.paymentTerm.create.mockResolvedValue({ id: 9 });

    await run(ctrl.createTerm, { body: { name: '  Net 45 ', days: '45' } });

    expect(prisma.paymentTerm.create).toHaveBeenCalledWith({
      data: { businessId: 1, name: 'Net 45', days: 45 },
    });
  });

  test('rejects a blank name, and days that are negative or not whole', async () => {
    await expect(run(ctrl.createTerm, { body: { name: ' ', days: 10 } })).rejects.toThrow('name');
    await expect(run(ctrl.createTerm, { body: { name: 'X', days: -1 } })).rejects.toThrow('days');
    await expect(run(ctrl.createTerm, { body: { name: 'X', days: 2.5 } })).rejects.toThrow('days');
    expect(prisma.paymentTerm.create).not.toHaveBeenCalled();
  });

  test('turns a duplicate name into a friendly error', async () => {
    prisma.paymentTerm.create.mockRejectedValue({ code: 'P2002' });

    await expect(run(ctrl.createTerm, { body: { name: 'Net 30', days: 30 } }))
      .rejects.toThrow('already exists');
  });
});

describe('updateTerm', () => {
  test('404s for a term of another business', async () => {
    prisma.paymentTerm.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.updateTerm, { params: { id: '4' }, body: { name: 'X' } }))
      .rejects.toThrow('not found');
    expect(prisma.paymentTerm.findFirst).toHaveBeenCalledWith({ where: { id: 4, businessId: 1 } });
    expect(prisma.paymentTerm.update).not.toHaveBeenCalled();
  });

  test('updates only the fields that were sent', async () => {
    prisma.paymentTerm.findFirst.mockResolvedValue({ id: 4, businessId: 1 });
    prisma.paymentTerm.update.mockResolvedValue({ id: 4 });

    await run(ctrl.updateTerm, { params: { id: '4' }, body: { isActive: false } });

    expect(prisma.paymentTerm.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { isActive: false } });
  });
});
```

- [ ] **Step 2: Run, expect FAIL** (`Cannot find module ...paymentTermController`)

Run: `npx jest tests/paymentTermController.test.js`

- [ ] **Step 3: Implement the controller**

```js
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { DEFAULT_TERMS } = require('../../lib/terms');

// First visit for a business: give it the standard terms. skipDuplicates keeps a
// race between two first requests harmless (unique on businessId + name).
async function ensureDefaultTerms(businessId) {
  if ((await prisma.paymentTerm.count({ where: { businessId } })) > 0) return;
  await prisma.paymentTerm.createMany({
    data: DEFAULT_TERMS.map((t) => ({ businessId, ...t })),
    skipDuplicates: true,
  });
}

// Validates the fields present in `body`; `partial` allows leaving any of them out.
function readTerm(body, partial) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name ?? '').trim();
    if (!name || name.length > 50) throw createError('Term name is required (50 characters max)', 400);
    out.name = name;
  }
  if (!partial || body.days !== undefined) {
    const days = Number(body.days);
    if (body.days === '' || body.days === null || !Number.isInteger(days) || days < 0 || days > 365) {
      throw createError('Term days must be a whole number from 0 to 365', 400);
    }
    out.days = days;
  }
  if (body.isActive !== undefined) out.isActive = !!body.isActive;
  return out;
}

exports.listTerms = async (req, res, next) => {
  try {
    await ensureDefaultTerms(req.businessId);
    const where = { businessId: req.businessId };
    if (req.query.active !== undefined) where.isActive = req.query.active === 'true';
    res.json(await prisma.paymentTerm.findMany({ where, orderBy: [{ days: 'asc' }, { name: 'asc' }] }));
  } catch (err) { next(err); }
};

exports.createTerm = async (req, res, next) => {
  try {
    const data = readTerm(req.body, false);
    try {
      res.status(201).json(await prisma.paymentTerm.create({ data: { businessId: req.businessId, ...data } }));
    } catch (err) {
      if (err.code === 'P2002') throw createError('A term with that name already exists', 409);
      throw err;
    }
  } catch (err) { next(err); }
};

exports.updateTerm = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const term = await prisma.paymentTerm.findFirst({ where: { id, businessId: req.businessId } });
    if (!term) throw createError('Payment term not found', 404);
    const data = readTerm(req.body, true);
    try {
      res.json(await prisma.paymentTerm.update({ where: { id }, data }));
    } catch (err) {
      if (err.code === 'P2002') throw createError('A term with that name already exists', 409);
      throw err;
    }
  } catch (err) { next(err); }
};
```

- [ ] **Step 4: Run, expect PASS**

Run: `npx jest tests/paymentTermController.test.js`

- [ ] **Step 5: Register routes** in `server/routes/receivable.js`

After the line `const validate = require('../middleware/validate');` add:

```js
const terms = require('../controllers/paymentTermController');
```

Directly after `router.put('/customers/:id', ...)` (before `router.get('/', ...)`, so it is matched ahead of `/:id`) add:

```js
router.get('/terms', terms.listTerms);
router.post('/terms', authorize('ADMIN','MANAGER'), terms.createTerm);
router.put('/terms/:id', authorize('ADMIN','MANAGER'), param('id').isInt(), validate, terms.updateTerm);
```

- [ ] **Step 6: Add the API client** in `lib/api.js` inside `export const receivable`, after the `invoices: { ... },` block

```js
  terms: {
    list: (params) => api.get('/receivable/terms', { params }),
    create: (data) => api.post('/receivable/terms', data),
    update: (id, data) => api.put(`/receivable/terms/${id}`, data),
  },
```

- [ ] **Step 7: Include terms in backup/restore.** In `server/controllers/backupController.js`, in the `receivable:` entry:
  - add to `exportFilter`: `paymentTerm: (biz) => ({ businessId: biz }),`
  - change `insertOrder` to `['paymentTerm', 'customer', 'invoice', 'invoiceLine', 'paymentAR']`
  - add `{ model: 'paymentTerm' },` as the last item of `deleteSequence` (after `{ model: 'customer' }`).

- [ ] **Step 8: Run related tests, then commit**

Run: `npx jest tests/paymentTermController.test.js tests/terms.test.js`
Expected: PASS.

```bash
git add server/controllers/paymentTermController.js server/routes/receivable.js lib/api.js server/controllers/backupController.js tests/paymentTermController.test.js
git commit -m "feat(terms): payment terms API with lazy default seeding"
```

---

### Task 4: Invoice and customer server support

**Files:**
- Modify: `server/controllers/receivableController.js` (`createCustomer` ~126, `updateCustomer` ~148, `createInvoice` ~192, `updateInvoice` ~229)
- Test: `tests/receivableTerms.test.js`

**Interfaces:**
- Consumes: `prisma.paymentTerm.findFirst({ where: { id, businessId } })` from Task 1.
- Produces: `POST/PUT /api/receivable` accept optional `termId`; the stored invoice carries `termId`, `termsName`, `termsDays`. `POST/PUT /api/receivable/customers` accept optional `defaultTermId` (a term of this business or null).

- [ ] **Step 1: Write the failing tests** (`tests/receivableTerms.test.js`)

```js
jest.mock('../server/config/database', () => ({
  invoice: { findFirst: jest.fn(), create: jest.fn() },
  paymentTerm: { findFirst: jest.fn() },
  account: { findMany: jest.fn() },
  customer: { create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/receivableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, user: { id: 1 }, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const invoiceBody = (extra = {}) => ({
  customerId: 7, invoiceDate: '2026-02-01', dueDate: '2026-03-03',
  lines: [{ accountId: 5, description: 'Service', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.invoice.findFirst.mockResolvedValue(null);
  prisma.account.findMany.mockResolvedValue([{ id: 5, normalBalance: 'CREDIT' }]);
  prisma.invoice.create.mockImplementation(async ({ data }) => ({
    id: 1, ...data, customer: { name: 'ACME' }, lines: [],
  }));
});

describe('createInvoice terms', () => {
  test('stores the term and snapshots its name and days', async () => {
    prisma.paymentTerm.findFirst.mockResolvedValue({ id: 2, name: 'Net 30', days: 30 });

    await run(ctrl.createInvoice, { body: invoiceBody({ termId: '2' }) });

    expect(prisma.paymentTerm.findFirst).toHaveBeenCalledWith({ where: { id: 2, businessId: 1 } });
    expect(prisma.invoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ termId: 2, termsName: 'Net 30', termsDays: 30 }),
    }));
  });

  test('works without terms (all three fields null)', async () => {
    await run(ctrl.createInvoice, { body: invoiceBody() });

    expect(prisma.paymentTerm.findFirst).not.toHaveBeenCalled();
    expect(prisma.invoice.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ termId: null, termsName: null, termsDays: null }),
    }));
  });

  test("rejects another business's term and creates nothing", async () => {
    prisma.paymentTerm.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.createInvoice, { body: invoiceBody({ termId: 99 }) }))
      .rejects.toThrow('Payment terms not found');
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });
});

describe('customer default terms', () => {
  test('createCustomer saves a default term of this business', async () => {
    prisma.paymentTerm.findFirst.mockResolvedValue({ id: 3 });
    prisma.customer.create.mockResolvedValue({ id: 1 });

    await run(ctrl.createCustomer, { body: { customerCode: 'CUS-100', name: 'ACME', defaultTermId: '3' } });

    expect(prisma.customer.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ defaultTermId: 3 }),
    });
  });

  test("createCustomer rejects another business's default term", async () => {
    prisma.paymentTerm.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.createCustomer, { body: { customerCode: 'CUS-100', name: 'ACME', defaultTermId: 99 } }))
      .rejects.toThrow('Payment terms not found');
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  test('updateCustomer can clear the default term with null', async () => {
    prisma.customer.update.mockResolvedValue({ id: 1 });

    await run(ctrl.updateCustomer, { params: { id: '1' }, body: { name: 'ACME', defaultTermId: null } });

    expect(prisma.customer.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ defaultTermId: null }),
    }));
  });
});
```

- [ ] **Step 2: Run, expect FAIL**

Run: `npx jest tests/receivableTerms.test.js`
Expected: FAIL (`termId` missing in create data; no term lookup).

- [ ] **Step 3: Add the two helpers** to `receivableController.js`, directly above `exports.listCustomers`

```js
// Resolves the term picked on an invoice into the snapshot stored with it.
// An inactive term is still accepted so an old invoice can be re-saved.
async function termSnapshot(termId, businessId) {
  if (termId === undefined || termId === null || termId === '') {
    return { termId: null, termsName: null, termsDays: null };
  }
  const term = await prisma.paymentTerm.findFirst({ where: { id: Number(termId), businessId } });
  if (!term) throw createError('Payment terms not found', 400);
  return { termId: term.id, termsName: term.name, termsDays: term.days };
}

// Customer.defaultTermId: undefined = leave alone, null/'' = clear, id = must be this business's term.
async function defaultTermValue(defaultTermId, businessId) {
  if (defaultTermId === undefined) return undefined;
  if (defaultTermId === null || defaultTermId === '') return null;
  const term = await prisma.paymentTerm.findFirst({ where: { id: Number(defaultTermId), businessId } });
  if (!term) throw createError('Payment terms not found', 400);
  return term.id;
}
```

- [ ] **Step 4: Wire customers.** In `createCustomer` replace the destructure/`base` lines with:

```js
    const { customerCode, name, tin, address, contactName, email, phone, defaultTermId } = req.body;
    const base = { businessId: req.businessId, name, tin, address, contactName, email, phone };
    const termValue = await defaultTermValue(defaultTermId, req.businessId);
    if (termValue !== undefined) base.defaultTermId = termValue;
```

In `updateCustomer` replace the body with:

```js
    const id = Number(req.params.id);
    const { name, tin, address, contactName, email, phone, isActive, defaultTermId } = req.body;
    const termValue = await defaultTermValue(defaultTermId, req.businessId);
    res.json(await prisma.customer.update({
      where: { id },
      data: { name, tin, address, contactName, email, phone, isActive,
        ...(termValue !== undefined && { defaultTermId: termValue }) },
    }));
```

- [ ] **Step 5: Wire invoices.**
  - `createInvoice`: after `const invoiceNo = await genInvNo();` add `const terms = await termSnapshot(req.body.termId, req.businessId);` and add `...terms,` to the `data` object (next to `description, notes, ...`).
  - `updateInvoice`: before `const updated = await prisma.invoice.update(` add `const terms = 'termId' in req.body ? await termSnapshot(req.body.termId, req.businessId) : {};` and add `...terms,` in the update `data`.

- [ ] **Step 6: Run, expect PASS; run the rest of the receivable-related tests**

Run: `npx jest tests/receivableTerms.test.js`
Then: `npx jest` (full suite; no previously passing test may fail).

- [ ] **Step 7: Commit**

```bash
git add server/controllers/receivableController.js tests/receivableTerms.test.js
git commit -m "feat(terms): invoices snapshot terms; customers carry a default term"
```

---

### Task 5: Settings panel for managing terms

**Files:**
- Create: `components/settings/PaymentTermsPanel.jsx`
- Modify: `app/(dashboard)/settings/page.jsx` (imports ~line 17-21, `TABS` ~line 22, tab render ~line 662)

**Interfaces:**
- Consumes: `receivable.terms.list/create/update` (Task 3).

- [ ] **Step 1: Create `components/settings/PaymentTermsPanel.jsx`**

```jsx
'use client';
import { useState, useEffect, useCallback } from 'react';
import { receivable as rApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Edit2, Check, X, ToggleLeft, ToggleRight } from 'lucide-react';

const daysLabel = (d) => (d === 0 ? 'Due on invoice date' : `Due ${d} day${d === 1 ? '' : 's'} after invoice date`);

export default function PaymentTermsPanel() {
  const [terms, setTerms]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [draft, setDraft]     = useState({ name: '', days: '' });
  const [editing, setEditing] = useState(null); // { id, name, days }

  const load = useCallback(async () => {
    setLoading(true);
    try { setTerms((await rApi.terms.list()).data); }
    catch { toast.error('Failed to load payment terms'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const call = async (fn, okMsg) => {
    setSaving(true);
    try { await fn(); toast.success(okMsg); await load(); return true; }
    catch (err) { toast.error(err.response?.data?.error || 'Could not save'); return false; }
    finally { setSaving(false); }
  };

  const add = async (e) => {
    e.preventDefault();
    const ok = await call(() => rApi.terms.create({ name: draft.name, days: draft.days }), 'Term added');
    if (ok) setDraft({ name: '', days: '' });
  };

  const saveEdit = async () => {
    const ok = await call(() => rApi.terms.update(editing.id, { name: editing.name, days: editing.days }), 'Term updated');
    if (ok) setEditing(null);
  };

  const toggle = (t) => call(() => rApi.terms.update(t.id, { isActive: !t.isActive }), t.isActive ? 'Term disabled' : 'Term enabled');

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-semibold text-gray-900">Payment Terms</h3>
        <p className="text-sm text-gray-500 mt-0.5">
          Pick terms on an invoice and the due date fills itself in. Changing a term here does not change invoices already issued.
        </p>
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-3">
        <div className="form-group">
          <label className="label">Name</label>
          <input className="input" required maxLength={50} placeholder="e.g. Net 45"
            value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} />
        </div>
        <div className="form-group">
          <label className="label">Days</label>
          <input className="input w-28" required type="number" min="0" max="365" step="1" placeholder="45"
            value={draft.days} onChange={(e) => setDraft((d) => ({ ...d, days: e.target.value }))} />
        </div>
        <button type="submit" disabled={saving} className="btn-primary"><Plus className="w-4 h-4" /> Add term</button>
      </form>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : (
        <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
          {terms.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              {editing?.id === t.id ? (
                <>
                  <input className="input w-40" value={editing.name} maxLength={50}
                    onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} />
                  <input className="input w-24" type="number" min="0" max="365" step="1" value={editing.days}
                    onChange={(e) => setEditing((x) => ({ ...x, days: e.target.value }))} />
                  <button type="button" onClick={saveEdit} disabled={saving} className="text-green-600 p-1" title="Save"><Check className="w-4 h-4" /></button>
                  <button type="button" onClick={() => setEditing(null)} className="text-gray-400 p-1" title="Cancel"><X className="w-4 h-4" /></button>
                </>
              ) : (
                <>
                  <div className={`flex-1 min-w-[10rem] ${t.isActive ? '' : 'opacity-50'}`}>
                    <p className="text-sm font-medium text-gray-800">{t.name}</p>
                    <p className="text-xs text-gray-400">{daysLabel(t.days)}</p>
                  </div>
                  {!t.isActive && <span className="badge badge-gray">Disabled</span>}
                  <button type="button" onClick={() => setEditing({ id: t.id, name: t.name, days: String(t.days) })}
                    className="text-gray-400 hover:text-blue-600 p-1" title="Edit"><Edit2 className="w-4 h-4" /></button>
                  <button type="button" onClick={() => toggle(t)} disabled={saving}
                    className={t.isActive ? 'text-green-500' : 'text-gray-300'} title={t.isActive ? 'Disable' : 'Enable'}>
                    {t.isActive ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7" />}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the tab in `app/(dashboard)/settings/page.jsx`**
  - After `import OrdersPanel from '@/components/settings/OrdersPanel';` add `import PaymentTermsPanel from '@/components/settings/PaymentTermsPanel';`
  - In `TABS`, after the `numbering` entry add: `{ key: 'terms',      label: 'Payment Terms', icon: Clock,        roles: ['ADMIN', 'MANAGER'] },` (`Clock` is already imported from lucide-react).
  - After the line `{activeTab === 'orders'     && <OrdersPanel />}` add: `{activeTab === 'terms'      && <PaymentTermsPanel />}`

- [ ] **Step 3: Verify (see Task 8 for the full browser check)** that `npm run build` in the worktree compiles (run it in the worktree directory only).

- [ ] **Step 4: Commit**

```bash
git add components/settings/PaymentTermsPanel.jsx "app/(dashboard)/settings/page.jsx"
git commit -m "feat(terms): Settings > Payment Terms panel"
```

---

### Task 6: Default term on the customer form

**Files:**
- Modify: `app/(dashboard)/receivable/customers/page.jsx` (`CustomerModal`, lines ~14-120)

- [ ] **Step 1: Load active terms inside `CustomerModal`.** After `const [saving, setSaving] = useState(false);` add:

```jsx
  const [terms, setTerms] = useState([]);
  useEffect(() => {
    rApi.terms.list({ active: 'true' }).then((r) => setTerms(r.data)).catch(() => {}); // select just stays empty
  }, []);
```

- [ ] **Step 2: Add the field.** Directly after the Address `form-group` (the `</div>` that closes the `<textarea ... placeholder="Complete business address" />` block, before `<hr className="border-gray-100" />`) insert:

```jsx
            <div className="form-group">
              <label className="label">Default Payment Terms</label>
              <select
                className="select"
                value={form.defaultTermId ? String(form.defaultTermId) : ''}
                onChange={(e) => setForm((f) => ({ ...f, defaultTermId: e.target.value ? Number(e.target.value) : null }))}
              >
                <option value="">— None —</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.days === 0 ? 'on invoice date' : `${t.days} days`})</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Pre-selected when you create an invoice for this customer.</p>
            </div>
```

(`useEffect` is already imported at the top of the file.)

- [ ] **Step 3: Commit**

```bash
git add "app/(dashboard)/receivable/customers/page.jsx"
git commit -m "feat(terms): default payment terms on the customer form"
```

---

### Task 7: Terms on the invoice form, list and print

**Files:**
- Modify: `app/(dashboard)/receivable/page.jsx` (`CreateInvoiceModal` ~554-760, invoice print ~110-115, list row ~1191)

**Interfaces:**
- Consumes: `computeDueDate` from `@/lib/terms`, `rApi.terms.list`, `customer.defaultTermId` (customers list returns every column), invoice fields `termId` / `termsName`.

- [ ] **Step 1: Import the helper.** After `import { useDraftGuard } from '@/lib/useDraftGuard';` add:

```jsx
import { computeDueDate } from '@/lib/terms';
```

- [ ] **Step 2: Form state.** In the `useState` initializer of `CreateInvoiceModal`:
  - in the edit branch add `termId: invoice.termId ? String(invoice.termId) : '',` after `dueDate: ...`;
  - in the new-invoice branch add `termId: '',` after `dueDate: due.toISOString()...,`.

- [ ] **Step 3: Load terms and add the handlers.** After the existing `const [packages, setPackages] = useState([]);` add:

```jsx
  const [terms, setTerms] = useState([]);
  useEffect(() => {
    rApi.terms.list({ active: 'true' }).then((r) => setTerms(r.data)).catch(() => {}); // picker stays empty
  }, []);
```

After the `set = (k) => ...` helper add:

```jsx
  // Picking terms (or changing the invoice date while terms are set) recomputes the
  // due date. The due date stays an editable field, so a manual date still wins
  // until the terms or date are changed again.
  const dueFor = (termId, invoiceDate) => {
    const term = terms.find((t) => String(t.id) === String(termId));
    if (!term || !invoiceDate) return null;
    try { return computeDueDate(invoiceDate, term.days); } catch { return null; }
  };
  const setTerm = (termId) =>
    setForm((f) => ({ ...f, termId, dueDate: dueFor(termId, f.invoiceDate) || f.dueDate }));
  const setInvoiceDate = (invoiceDate) =>
    setForm((f) => ({ ...f, invoiceDate, dueDate: dueFor(f.termId, invoiceDate) || f.dueDate }));
  const setCustomer = (id) => {
    setForm((f) => {
      const next = { ...f, customerId: id };
      // New invoices only: a customer's default terms pre-select (an edit keeps its own terms).
      const def = !invoice && customers.find((c) => String(c.id) === String(id))?.defaultTermId;
      if (def && terms.some((t) => t.id === def)) {
        next.termId = String(def);
        next.dueDate = dueFor(def, f.invoiceDate) || f.dueDate;
      }
      return next;
    });
  };
```

- [ ] **Step 4: Replace the header fields.** Change `onChange={(id) => setForm((f) => ({ ...f, customerId: id }))}` on `CustomerSelect` to `onChange={setCustomer}`. Then replace the two form-groups for Invoice Date and Due Date (the last two children of the `grid grid-cols-1 md:grid-cols-2 gap-4` block) by closing that grid after the Description group and adding a second row:

```jsx
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="form-group">
                <label className="label">Invoice Date *</label>
                <input type="date" className="input" required value={form.invoiceDate}
                  onChange={(e) => setInvoiceDate(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">Terms</label>
                <select className="select" value={form.termId} onChange={(e) => setTerm(e.target.value)}>
                  <option value="">— No terms —</option>
                  {invoice?.termId && !terms.some((t) => t.id === invoice.termId) && (
                    <option value={String(invoice.termId)}>{invoice.termsName} (disabled)</option>
                  )}
                  {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Due Date *</label>
                <input type="date" className="input" required value={form.dueDate} onChange={set('dueDate')} />
              </div>
            </div>
```

`handleSubmit` already spreads `...form` into the payload, so `termId` is sent; change the line `customerId: Number(form.customerId),` to also include `termId: form.termId ? Number(form.termId) : null,`.

- [ ] **Step 5: Print.** In the invoice print `info-grid`, replace the Due Date box with:

```js
        <div class="info-box"><div class="info-lbl">Due Date</div><div class="info-val">${dateFmt(invoice.dueDate)}${invoice.termsName ? ` (${invoice.termsName})` : ''}</div></div>
```

- [ ] **Step 6: List row.** In the invoice table cell that renders `{formatDate(inv.dueDate)}` (~line 1191), add directly after it:

```jsx
                        {inv.termsName && <span className="block text-xs text-gray-400">{inv.termsName}</span>}
```

- [ ] **Step 7: Commit**

```bash
git add "app/(dashboard)/receivable/page.jsx"
git commit -m "feat(terms): terms picker, auto due date, and terms on invoice list/print"
```

---

### Task 8: Verify end to end

- [ ] **Step 1:** `npx jest` from the worktree. Expected: all suites pass.
- [ ] **Step 2:** `npm run build` in the worktree directory (never in the directory the user's dev server runs in). Expected: build completes with no errors.
- [ ] **Step 3:** With the user's sign-off, run the app from the worktree (memory: live-dev-server-verification-in-worktree; businessId=2 is the real business) or ask the user to check these by hand:
  1. Settings > Payment Terms lists COD, Net 15, Net 30, Net 60; add "Net 45"; edit it; disable it (disappears from invoice picker).
  2. Customers > edit a customer, set Default Payment Terms = Net 30, save.
  3. Receivables > New Invoice, choose that customer: Terms shows Net 30 and Due Date = invoice date + 30. Change Invoice Date: due date follows. Pick COD: due date = invoice date. Hand-edit the due date: it stays until terms/date change again.
  4. Save: the invoice list shows the terms under the due date; Print shows `Due Date  <date> (Net 30)`.
  5. Edit an old invoice (no terms): Terms is blank and its due date is unchanged.
- [ ] **Step 4:** Report results honestly (what passed, what was not checked) before moving to phase 2 (`2026-10-19-receivables-2-aging.md`).

## Self-review against the spec (section 1)

- PaymentTerm model, defaults COD/Net 15/Net 30/Net 60, per business: Tasks 1, 3.
- Settings panel add/edit/disable, disabled terms stay on old docs: Tasks 3, 5, 7 (the invoice form keeps showing a disabled term already on that invoice).
- `Customer.defaultTermId`: Tasks 1, 4, 6.
- `Invoice.termId` + `termsName`/`termsDays` snapshot: Tasks 1, 4.
- Invoice form pre-selects the customer's term and recomputes the due date, due date editable: Task 7.
- Old invoices keep a blank term and their due date: Task 4 (`'termId' in req.body` leaves the snapshot alone) and Task 8 check 5.
- Terms on invoice print and list: Task 7. (SOA and Aging show terms in phases 2 and 3.)
- Due-date computation shared and unit-tested: Task 2.
