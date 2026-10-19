# Payment Terms Implementation Plan (Receivables Docs, Phase 1 of 4, revised)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the payment-terms feature that already exists on the merged `worktree-payment-terms` branch: add a default term per customer, seed the standard terms for a business that has none, close a tenant-isolation hole in the term update/delete endpoints, and show the terms on the invoice list.

**Revision note:** this phase was first planned from scratch, but the repo already had an unmerged branch (`worktree-payment-terms`, Sept 9) with the `PaymentTerm` model, Settings > Payment Terms tab, a terms picker on the invoice form that recomputes the due date, and `paymentTerms` stored on invoices, bills, quotations and POs. It is merged into this worktree (commit `merge: bring payment-terms branch...`). What exists, so it is not rebuilt: `PaymentTerm { name, days, isDefault, isActive, sortOrder }`, `Invoice.paymentTerms` (the term NAME as a string snapshot), API `GET/POST/PUT/DELETE /api/settings/payment-terms`, `settings.listPaymentTerms/...` in `lib/api.js`, invoice form selector, invoice detail/print showing the terms.

**Architecture:** `Customer.defaultTermId` points at a `PaymentTerm`. On a new invoice, choosing a customer pre-selects that customer's term (falling back to the business default term the form already uses); the existing effect then recomputes the due date.

**Tech Stack:** Express + Prisma 5 (MySQL), Next.js 14, Jest.

Spec: `docs/superpowers/specs/2026-10-19-receivables-docs-design.md` (section 1; the snapshot field is `Invoice.paymentTerms`, not `termsName`/`termsDays`).

## Global Constraints

- Work only in the worktree `D:\Accounting System ERP\.claude\worktrees\receivables-docs` (branch `feat/receivables-docs`). Its `node_modules` is a junction to the main checkout and `.env` was copied (both git-ignored). Never `git add` from the main checkout, which has uncommitted user changes. No `isolation: "worktree"` for subagents inside this worktree.
- Every Prisma query is scoped by `req.businessId`.
- Migration SQL is hand-written with the Write tool (no BOM), applied with `npm run db:deploy`; the user has stopped their dev server for `npm run db:generate` (Windows EPERM otherwise). Never start a competing dev server; never run `next build` where the user's dev server runs.
- UI follows existing conventions (`card`, `btn-primary`, `input`, `label`, `badge-*`, Lucide icons, `react-hot-toast`).
- Tests: `npx jest tests/<file>.test.js`. Commits list explicit paths and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

---

### Task 1: Customer default term column

**Files:**
- Modify: `prisma/schema.prisma` (`model Customer`)
- Create: `prisma/migrations/20261019090000_add_customer_default_term/migration.sql`

- [ ] **Step 1:** In `model Customer` add, after the `phone` line: `defaultTermId Int?`
- [ ] **Step 2:** Write `prisma/migrations/20261019090000_add_customer_default_term/migration.sql` (Write tool):

```sql
-- AlterTable
ALTER TABLE `customers` ADD COLUMN `defaultTermId` INTEGER NULL;
```

- [ ] **Step 3:** `npx prisma validate` (expect "is valid"), then `npm run db:deploy` and `npm run db:generate`. Expected: `Applying migration 20261019090000_add_customer_default_term`, `Generated Prisma Client`.
- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261019090000_add_customer_default_term/migration.sql
git commit -m "feat(terms): Customer.defaultTermId"
```

---

### Task 2: Term endpoints: tenant scoping and default seeding

**Files:**
- Modify: `server/controllers/settingsController.js` (`listPaymentTerms`, `updatePaymentTerm`, `deletePaymentTerm`)
- Modify: `tests/settingsPaymentTerms.test.js`

**Interfaces:**
- Produces: `GET /api/settings/payment-terms` seeds Due on Receipt / COD / Net 15 / Net 30 (default) / Net 60 for a business that has no terms (same set as `prisma/seed.js`). `PUT` and `DELETE` return 404 for a term of another business.

- [ ] **Step 1: Update the tests first.** In `tests/settingsPaymentTerms.test.js`:
  - extend the mock: `paymentTerm: { findMany, create, update, updateMany, delete, count: jest.fn(), createMany: jest.fn(), findFirst: jest.fn() }`;
  - in the top-level `beforeEach` after `jest.clearAllMocks()` add `prisma.paymentTerm.count.mockResolvedValue(5); prisma.paymentTerm.findFirst.mockResolvedValue({ id: 1, businessId: 1 });`;
  - add these tests inside the `describe`:

```js
  test('listPaymentTerms seeds the standard terms for a business that has none', async () => {
    prisma.paymentTerm.count.mockResolvedValue(0);
    prisma.paymentTerm.findMany.mockResolvedValue([]);

    await run(ctrl.listPaymentTerms, {});

    expect(prisma.paymentTerm.createMany).toHaveBeenCalledWith({
      data: [
        { businessId: 1, name: 'Due on Receipt', days: 0,  isDefault: false, sortOrder: 0 },
        { businessId: 1, name: 'COD',            days: 0,  isDefault: false, sortOrder: 1 },
        { businessId: 1, name: 'Net 15',         days: 15, isDefault: false, sortOrder: 2 },
        { businessId: 1, name: 'Net 30',         days: 30, isDefault: true,  sortOrder: 3 },
        { businessId: 1, name: 'Net 60',         days: 60, isDefault: false, sortOrder: 4 },
      ],
      skipDuplicates: true,
    });
  });

  test('listPaymentTerms does not seed when the business already has terms', async () => {
    prisma.paymentTerm.findMany.mockResolvedValue([]);

    await run(ctrl.listPaymentTerms, {});

    expect(prisma.paymentTerm.createMany).not.toHaveBeenCalled();
  });

  test('updatePaymentTerm 404s for a term of another business and changes nothing', async () => {
    prisma.paymentTerm.findFirst.mockResolvedValue(null);

    const { statusCode } = await run(ctrl.updatePaymentTerm, { params: { id: '3' }, body: { isDefault: true } });

    expect(statusCode).toBe(404);
    expect(prisma.paymentTerm.findFirst).toHaveBeenCalledWith({ where: { id: 3, businessId: 1 } });
    expect(prisma.paymentTerm.updateMany).not.toHaveBeenCalled();
    expect(prisma.paymentTerm.update).not.toHaveBeenCalled();
  });

  test('deletePaymentTerm 404s for a term of another business and deletes nothing', async () => {
    prisma.paymentTerm.findFirst.mockResolvedValue(null);

    const { statusCode } = await run(ctrl.deletePaymentTerm, { params: { id: '7' } });

    expect(statusCode).toBe(404);
    expect(prisma.paymentTerm.delete).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run, expect FAIL**: `npx jest tests/settingsPaymentTerms.test.js` (new tests fail; the seed/404 behaviour does not exist yet).
- [ ] **Step 3: Implement.** In `settingsController.js` above `listPaymentTerms` add:

```js
const STANDARD_TERMS = [
  { name: 'Due on Receipt', days: 0,  isDefault: false },
  { name: 'COD',            days: 0,  isDefault: false },
  { name: 'Net 15',         days: 15, isDefault: false },
  { name: 'Net 30',         days: 30, isDefault: true  },
  { name: 'Net 60',         days: 60, isDefault: false },
];

// A business with no terms at all gets the standard set. skipDuplicates makes a race
// between two first requests harmless (unique on businessId + name).
async function ensureStandardTerms(businessId) {
  if ((await prisma.paymentTerm.count({ where: { businessId } })) > 0) return;
  await prisma.paymentTerm.createMany({
    data: STANDARD_TERMS.map((t, i) => ({ businessId, ...t, sortOrder: i })),
    skipDuplicates: true,
  });
}
```

At the start of `listPaymentTerms`' `try` block add `await ensureStandardTerms(req.businessId);`.

In `updatePaymentTerm`, right after `const { id } = req.params;` add:

```js
    const owned = await prisma.paymentTerm.findFirst({ where: { id: Number(id), businessId: req.businessId } });
    if (!owned) return res.status(404).json({ error: 'Payment term not found' });
```

In `deletePaymentTerm`, right after `const { id } = req.params;` add the same two lines. (The existing `update`/`delete` calls stay as they are; the ownership check now precedes them.)

- [ ] **Step 4: Run, expect PASS**: `npx jest tests/settingsPaymentTerms.test.js`.
- [ ] **Step 5: Commit**

```bash
git add server/controllers/settingsController.js tests/settingsPaymentTerms.test.js
git commit -m "fix(terms): scope term update/delete by business; seed standard terms on first list"
```

---

### Task 3: Customers carry a default term (server)

**Files:**
- Modify: `server/controllers/receivableController.js` (`createCustomer`, `updateCustomer`)
- Test: `tests/customerDefaultTerm.test.js`

**Interfaces:**
- Produces: `POST/PUT /api/receivable/customers` accept optional `defaultTermId` (a term of this business, or `null`/`''` to clear). Customer JSON includes `defaultTermId`.

- [ ] **Step 1: Write the failing tests** (`tests/customerDefaultTerm.test.js`)

```js
jest.mock('../server/config/database', () => ({
  customer: { create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  paymentTerm: { findFirst: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/receivableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, user: { id: 1 }, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('customer default payment term', () => {
  test('createCustomer saves a default term of this business', async () => {
    prisma.paymentTerm.findFirst.mockResolvedValue({ id: 3 });
    prisma.customer.create.mockResolvedValue({ id: 1 });

    await run(ctrl.createCustomer, { body: { customerCode: 'CUS-100', name: 'ACME', defaultTermId: '3' } });

    expect(prisma.paymentTerm.findFirst).toHaveBeenCalledWith({ where: { id: 3, businessId: 1 } });
    expect(prisma.customer.create).toHaveBeenCalledWith({ data: expect.objectContaining({ defaultTermId: 3 }) });
  });

  test("createCustomer rejects another business's term and creates nothing", async () => {
    prisma.paymentTerm.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.createCustomer, { body: { customerCode: 'CUS-100', name: 'ACME', defaultTermId: 99 } }))
      .rejects.toThrow('Payment term not found');
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  test('createCustomer without a term leaves defaultTermId out', async () => {
    prisma.customer.create.mockResolvedValue({ id: 1 });

    await run(ctrl.createCustomer, { body: { customerCode: 'CUS-100', name: 'ACME' } });

    expect(prisma.customer.create.mock.calls[0][0].data).not.toHaveProperty('defaultTermId');
  });

  test('updateCustomer can set, and clear, the default term', async () => {
    prisma.customer.update.mockResolvedValue({ id: 1 });
    prisma.paymentTerm.findFirst.mockResolvedValue({ id: 4 });

    await run(ctrl.updateCustomer, { params: { id: '1' }, body: { name: 'ACME', defaultTermId: 4 } });
    expect(prisma.customer.update.mock.calls[0][0].data).toMatchObject({ defaultTermId: 4 });

    await run(ctrl.updateCustomer, { params: { id: '1' }, body: { name: 'ACME', defaultTermId: null } });
    expect(prisma.customer.update.mock.calls[1][0].data).toMatchObject({ defaultTermId: null });
  });

  test('updateCustomer leaves the term alone when the field is not sent', async () => {
    prisma.customer.update.mockResolvedValue({ id: 1 });

    await run(ctrl.updateCustomer, { params: { id: '1' }, body: { name: 'ACME' } });

    expect(prisma.customer.update.mock.calls[0][0].data).not.toHaveProperty('defaultTermId');
  });
});
```

- [ ] **Step 2: Run, expect FAIL**: `npx jest tests/customerDefaultTerm.test.js`.
- [ ] **Step 3: Implement.** In `receivableController.js`, directly above `exports.listCustomers` add:

```js
// Customer.defaultTermId: undefined = leave alone, null/'' = clear, id = must be this business's term.
async function defaultTermValue(defaultTermId, businessId) {
  if (defaultTermId === undefined) return undefined;
  if (defaultTermId === null || defaultTermId === '') return null;
  const term = await prisma.paymentTerm.findFirst({ where: { id: Number(defaultTermId), businessId } });
  if (!term) throw createError('Payment term not found', 400);
  return term.id;
}
```

In `createCustomer` replace the destructure and `base` lines with:

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

- [ ] **Step 4: Run, expect PASS**: `npx jest tests/customerDefaultTerm.test.js`, then `npx jest` (no regressions).
- [ ] **Step 5: Commit**

```bash
git add server/controllers/receivableController.js tests/customerDefaultTerm.test.js
git commit -m "feat(terms): customers carry a default payment term"
```

---

### Task 4: UI: customer form, invoice pre-selection, invoice list

**Files:**
- Modify: `app/(dashboard)/receivable/customers/page.jsx` (`CustomerModal`)
- Modify: `app/(dashboard)/receivable/page.jsx` (`CreateInvoiceModal`, invoice list due-date cell)

- [ ] **Step 1: Customer form.** In `customers/page.jsx` add `import { settings as settingsApi } from '@/lib/api';` merged into the existing `import { receivable as rApi } from '@/lib/api';` line (`import { receivable as rApi, settings as settingsApi } from '@/lib/api';`). In `CustomerModal` after `const [saving, setSaving] = useState(false);` add:

```jsx
  const [terms, setTerms] = useState([]);
  useEffect(() => {
    settingsApi.listPaymentTerms().then((r) => setTerms(r.data.filter((t) => t.isActive))).catch(() => {}); // select stays empty
  }, []);
```

Directly after the Address `form-group` (the `</div>` that closes the `<textarea ... placeholder="Complete business address" />` group, before `<hr className="border-gray-100" />`) insert:

```jsx
            <div className="form-group">
              <label className="label">Default Payment Terms</label>
              <select
                className="select"
                value={form.defaultTermId ? String(form.defaultTermId) : ''}
                onChange={(e) => setForm((f) => ({ ...f, defaultTermId: e.target.value ? Number(e.target.value) : null }))}
              >
                <option value="">— None (use the business default) —</option>
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.days === 0 ? 'on invoice date' : `${t.days} days`})</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Pre-selected when you create an invoice for this customer.</p>
            </div>
```

- [ ] **Step 2: Invoice pre-selection.** In `CreateInvoiceModal` (`receivable/page.jsx`), after the `set = (k) => ...` helper add:

```jsx
  // New invoices only: choosing a customer pre-selects that customer's default term.
  // The due-date effect below then recomputes the date. An edit keeps its own terms.
  const setCustomer = (id) => {
    setForm((f) => {
      const next = { ...f, customerId: id };
      const termId = !invoice && customers.find((c) => String(c.id) === String(id))?.defaultTermId;
      const term = termId && paymentTerms.find((t) => t.id === termId);
      if (term) next.paymentTerms = term.name;
      return next;
    });
  };
```

and change `onChange={(id) => setForm((f) => ({ ...f, customerId: id }))}` on the `CustomerSelect` to `onChange={setCustomer}`.

- [ ] **Step 3: Terms on the invoice list.** In the invoice table, in the cell that renders `{formatDate(inv.dueDate)}` add right after it:

```jsx
                        {inv.paymentTerms && <span className="block text-xs text-gray-400">{inv.paymentTerms}</span>}
```

- [ ] **Step 4: Build check.** `npx jest` (all pass). `npm run build` in the worktree directory (never in the user's dev-server directory).
- [ ] **Step 5: Commit**

```bash
git add "app/(dashboard)/receivable/customers/page.jsx" "app/(dashboard)/receivable/page.jsx"
git commit -m "feat(terms): default term on the customer form; invoice pre-selects it; terms in invoice list"
```

---

### Task 5: Verify

- [ ] **Step 1:** `npx jest` and `npm run build` in the worktree. Expected: all pass, build succeeds.
- [ ] **Step 2:** With the user's sign-off (real business is businessId=2), check in the browser or ask the user to:
  1. Settings > Payment Terms for the real business lists the standard five (first visit seeds them) and the existing add/default/active/delete controls still work.
  2. Customers > edit a customer, set Default Payment Terms = Net 15, save.
  3. New Invoice, pick that customer: Payment Terms shows Net 15 and Due Date = invoice date + 15. Change the invoice date: due date follows. A customer with no default term keeps the business default term.
  4. The invoice list shows the terms under the due date; print shows Payment Terms.
- [ ] **Step 3:** Report what passed and what was not checked before phase 2.

## Self-review against the spec (section 1)

- PaymentTerm model, standard terms per business, Settings panel add/edit/disable: already on the merged branch; seeding for an empty business added in Task 2.
- `Customer.defaultTermId`: Tasks 1, 3, 4. Invoice picks the customer's term, due date recomputes, still editable: Task 4 plus the existing effect.
- Invoice keeps a term snapshot: the existing `Invoice.paymentTerms` string (the name). A later rename of a term does not rewrite old invoices because only the name string is stored.
- Terms on invoice list and print: list in Task 4; print already present.
- Tenant isolation of term update/delete: Task 2 (a defect found in the merged code).
