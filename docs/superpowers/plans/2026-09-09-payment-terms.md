# Declarable Payment Terms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the business define named payment terms (Net 15, Net 30, COD, etc.) once in Settings, then pick one on an Invoice, Bill, Quotation, or Purchase Order to auto-compute that document's due/valid/expected date — replacing today's hardcoded "+30 days" default everywhere it appears.

**Architecture:** A new `PaymentTerm` master-data model (per-business, CRUD via a new Settings tab) feeds a dropdown on the four document forms. Each document stores the chosen term's **name as a snapshot string** (not a foreign key) in a new nullable column, so renaming/deactivating/deleting a term later never rewrites history. Quotation→Invoice and PO→Bill conversion carry the source document's term forward as the new document's default.

**Tech Stack:** Next.js 14 (App Router) frontend, Express.js backend, Prisma ORM 5 / MySQL 8, Jest for backend unit tests (mocked Prisma client, no frontend component-test framework in this repo).

## Global Constraints

- Snapshot-string design: `paymentTerms` columns on `Invoice`/`Bill`/`Quotation`/`PurchaseOrder` are plain `String?` — never a foreign key to `PaymentTerm`.
- No per-Customer/Vendor default term — out of scope per the approved spec (`docs/superpowers/specs/2026-09-09-payment-terms-design.md`).
- Only one `PaymentTerm` per business may have `isDefault: true` at a time.
- Existing manual date-picker behavior on all 4 forms must be preserved — selecting a term sets the date, but the date field stays independently editable afterward.
- On Windows, stop the dev server (`npm run dev`) before running `npm run db:generate` / `npm run db:migrate` — Prisma generate holds a DLL lock otherwise.
- Backend tests follow this repo's existing convention exactly: `jest.mock('../server/config/database', () => ({ <model>: { <method>: jest.fn() } }))`, a local `run()` helper that fakes `(req, res, next)`, and `beforeEach(() => jest.clearAllMocks())`. See `tests/settingsUpdateUserRole.test.js` and `tests/payableControllerCreateBill.test.js` for the exact shape to match.
- Frontend changes have no component-test harness in this repo — verify them by running `npm run dev` and exercising the feature in a browser, per `CLAUDE.md`'s UI-verification requirement, not by writing new frontend unit tests.

---

### Task 1: `PaymentTerm` model, snapshot columns, migration, seed defaults

**Files:**
- Modify: `prisma/schema.prisma`
- Modify: `prisma/seed.js`

**Interfaces:**
- Produces: Prisma model `PaymentTerm { id, businessId, name, days, isDefault, isActive, sortOrder, createdAt, updatedAt }`, mapped to table `payment_terms`, unique on `[businessId, name]`.
- Produces: new nullable column `paymentTerms String? @db.VarChar(50)` on `Invoice`, `Bill`, `Quotation`, `PurchaseOrder`.
- Produces (seed): 5 rows per business (`Due on Receipt`/0, `COD`/0, `Net 15`/15, `Net 30`/30/`isDefault:true`, `Net 60`/60) that every later task can rely on existing after `npm run db:seed`.

- [ ] **Step 1: Add the `PaymentTerm` model**

In `prisma/schema.prisma`, right after the `SystemSetting` model (ends at line 575 with `@@map("system_settings")` followed by `}`), insert:

```prisma
// ─── Payment Terms ──────────────────────────────────────────
model PaymentTerm {
  id         Int      @id @default(autoincrement())
  businessId Int      @default(1)
  name       String   @db.VarChar(50)
  days       Int      @default(0)
  isDefault  Boolean  @default(false)
  isActive   Boolean  @default(true)
  sortOrder  Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([businessId, name])
  @@index([businessId])
  @@map("payment_terms")
}
```

- [ ] **Step 2: Add the snapshot column to `Invoice`**

In `prisma/schema.prisma`, find (around line 337):

```prisma
  invoiceDate DateTime      @db.Date
  dueDate     DateTime      @db.Date
  description String?       @db.Text
```

Change to:

```prisma
  invoiceDate DateTime      @db.Date
  dueDate     DateTime      @db.Date
  paymentTerms String?      @db.VarChar(50)
  description String?       @db.Text
```

- [ ] **Step 3: Add the snapshot column to `Bill`**

Find (around line 228):

```prisma
  billDate    DateTime   @db.Date
  dueDate     DateTime   @db.Date
  description String?    @db.Text
```

Change to:

```prisma
  billDate    DateTime   @db.Date
  dueDate     DateTime   @db.Date
  paymentTerms String?   @db.VarChar(50)
  description String?    @db.Text
```

- [ ] **Step 4: Add the snapshot column to `Quotation`**

Find (around line 416):

```prisma
  quotationDate DateTime        @db.Date
  validUntil    DateTime        @db.Date
  description   String?         @db.Text
```

Change to:

```prisma
  quotationDate DateTime        @db.Date
  validUntil    DateTime        @db.Date
  paymentTerms  String?         @db.VarChar(50)
  description   String?         @db.Text
```

- [ ] **Step 5: Add the snapshot column to `PurchaseOrder`**

Find (around line 896):

```prisma
  orderDate    DateTime  @db.Date
  expectedDate DateTime? @db.Date
  status       POStatus  @default(DRAFT)
```

Change to:

```prisma
  orderDate    DateTime  @db.Date
  expectedDate DateTime? @db.Date
  paymentTerms String?   @db.VarChar(50)
  status       POStatus  @default(DRAFT)
```

- [ ] **Step 6: Stop the dev server, then generate and migrate**

Tell the user to stop `npm run dev` if it's running (Prisma generate locks its DLL on Windows otherwise), then run:

```bash
npm run db:generate
npm run db:migrate
```

When prompted for a migration name, use `add_payment_terms`.
Expected: migration applies cleanly, Prisma Client regenerates with `prisma.paymentTerm` available.

- [ ] **Step 7: Seed 5 starter payment terms**

In `prisma/seed.js`, after the `// ─── Sample Employee ───────────────────────────────────────` block and before `// ─── Inventory Categories ──────────────────────────────────` (around line 385), insert:

```js
  // ─── Payment Terms ─────────────────────────────────────────
  const paymentTerms = [
    { name: 'Due on Receipt', days: 0,  isDefault: false },
    { name: 'COD',            days: 0,  isDefault: false },
    { name: 'Net 15',         days: 15, isDefault: false },
    { name: 'Net 30',         days: 30, isDefault: true  },
    { name: 'Net 60',         days: 60, isDefault: false },
  ];
  for (const term of paymentTerms) {
    await prisma.paymentTerm.upsert({
      where:  { businessId_name: { businessId: 1, name: term.name } },
      update: {},
      create: { businessId: 1, ...term },
    });
  }
  console.log(`✅ ${paymentTerms.length} payment terms seeded`);
```

- [ ] **Step 8: Run the seed and verify**

```bash
npm run db:seed
```

Expected output includes `✅ 5 payment terms seeded`. Confirm no errors.

- [ ] **Step 9: Commit**

```bash
git add prisma/schema.prisma prisma/seed.js prisma/migrations
git commit -m "$(cat <<'EOF'
feat(schema): add PaymentTerm model and document snapshot columns

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: `settingsController` CRUD for Payment Terms

**Files:**
- Modify: `server/controllers/settingsController.js`
- Create: `tests/settingsPaymentTerms.test.js`

**Interfaces:**
- Consumes: `prisma.paymentTerm` (from Task 1).
- Produces: `listPaymentTerms(req, res, next)`, `createPaymentTerm(req, res, next)`, `updatePaymentTerm(req, res, next)`, `deletePaymentTerm(req, res, next)` — added to this controller's `module.exports`, used by Task 3's routes.

- [ ] **Step 1: Write the failing tests**

Create `tests/settingsPaymentTerms.test.js`:

```js
jest.mock('../server/config/database', () => ({
  paymentTerm: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
}));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/settingsController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, body: {}, ...req },
     { status: (code) => ({ json: (body) => resolve({ statusCode: code, body }) }), json: (body) => resolve({ statusCode: 200, body }) },
     reject);
});

beforeEach(() => jest.clearAllMocks());

describe('settingsController — payment terms', () => {
  test('listPaymentTerms scopes by businessId and orders by sortOrder', async () => {
    prisma.paymentTerm.findMany.mockResolvedValue([{ id: 1, name: 'Net 30' }]);
    const { statusCode, body } = await run(ctrl.listPaymentTerms, {});
    expect(statusCode).toBe(200);
    expect(body).toEqual([{ id: 1, name: 'Net 30' }]);
    expect(prisma.paymentTerm.findMany).toHaveBeenCalledWith({
      where: { businessId: 1 },
      orderBy: { sortOrder: 'asc' },
    });
  });

  test('createPaymentTerm rejects a blank name', async () => {
    const { statusCode, body } = await run(ctrl.createPaymentTerm, { body: { name: '  ', days: 30 } });
    expect(statusCode).toBe(400);
    expect(body.error).toMatch(/name/i);
    expect(prisma.paymentTerm.create).not.toHaveBeenCalled();
  });

  test('createPaymentTerm rejects negative days', async () => {
    const { statusCode, body } = await run(ctrl.createPaymentTerm, { body: { name: 'Net 30', days: -5 } });
    expect(statusCode).toBe(400);
    expect(body.error).toMatch(/days/i);
    expect(prisma.paymentTerm.create).not.toHaveBeenCalled();
  });

  test('createPaymentTerm with isDefault clears isDefault on every other term first', async () => {
    prisma.paymentTerm.create.mockResolvedValue({ id: 2, name: 'Net 45', days: 45, isDefault: true });
    const { statusCode } = await run(ctrl.createPaymentTerm, { body: { name: 'Net 45', days: 45, isDefault: true } });
    expect(statusCode).toBe(201);
    expect(prisma.paymentTerm.updateMany).toHaveBeenCalledWith({
      where: { businessId: 1, isDefault: true },
      data: { isDefault: false },
    });
    expect(prisma.paymentTerm.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ businessId: 1, name: 'Net 45', days: 45, isDefault: true }),
    }));
  });

  test('createPaymentTerm surfaces a duplicate-name error as 400', async () => {
    prisma.paymentTerm.create.mockRejectedValue({ code: 'P2002' });
    const { statusCode, body } = await run(ctrl.createPaymentTerm, { body: { name: 'Net 30', days: 30 } });
    expect(statusCode).toBe(400);
    expect(body.error).toMatch(/already exists/i);
  });

  test('updatePaymentTerm with isDefault:true clears every other term first', async () => {
    prisma.paymentTerm.update.mockResolvedValue({ id: 3, isDefault: true });
    const { statusCode } = await run(ctrl.updatePaymentTerm, { params: { id: '3' }, body: { isDefault: true } });
    expect(statusCode).toBe(200);
    expect(prisma.paymentTerm.updateMany).toHaveBeenCalledWith({
      where: { businessId: 1, isDefault: true },
      data: { isDefault: false },
    });
    expect(prisma.paymentTerm.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { isDefault: true },
    });
  });

  test('updatePaymentTerm without isDefault only updates the given fields', async () => {
    prisma.paymentTerm.update.mockResolvedValue({ id: 3, isActive: false });
    await run(ctrl.updatePaymentTerm, { params: { id: '3' }, body: { isActive: false } });
    expect(prisma.paymentTerm.updateMany).not.toHaveBeenCalled();
    expect(prisma.paymentTerm.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { isActive: false },
    });
  });

  test('deletePaymentTerm deletes by id regardless of past usage', async () => {
    prisma.paymentTerm.delete.mockResolvedValue({});
    const { statusCode, body } = await run(ctrl.deletePaymentTerm, { params: { id: '7' } });
    expect(statusCode).toBe(200);
    expect(body.message).toMatch(/deleted/i);
    expect(prisma.paymentTerm.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/settingsPaymentTerms.test.js
```

Expected: FAIL — `ctrl.listPaymentTerms is not a function` (and similar for the other three).

- [ ] **Step 3: Implement the four controller functions**

In `server/controllers/settingsController.js`, after the `resetUserPassword` function (ends around line 299) and before the `module.exports` line, insert:

```js
// ─── Payment Terms ────────────────────────────────────────────
const listPaymentTerms = async (req, res, next) => {
  try {
    const terms = await prisma.paymentTerm.findMany({
      where: { businessId: req.businessId },
      orderBy: { sortOrder: 'asc' },
    });
    res.json(terms);
  } catch (err) { next(err); }
};

const createPaymentTerm = async (req, res, next) => {
  try {
    const { name, days, isDefault } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
    if (days === undefined || days === null || Number(days) < 0) {
      return res.status(400).json({ error: 'Days must be 0 or more' });
    }

    if (isDefault) {
      await prisma.paymentTerm.updateMany({
        where: { businessId: req.businessId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const term = await prisma.paymentTerm.create({
      data: {
        businessId: req.businessId,
        name: String(name).trim(),
        days: Number(days),
        isDefault: !!isDefault,
      },
    });
    res.status(201).json(term);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'A payment term with that name already exists' });
    next(err);
  }
};

const updatePaymentTerm = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, days, isDefault, isActive } = req.body;

    if (isDefault) {
      await prisma.paymentTerm.updateMany({
        where: { businessId: req.businessId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const term = await prisma.paymentTerm.update({
      where: { id: Number(id) },
      data: {
        ...(name !== undefined && { name: String(name).trim() }),
        ...(days !== undefined && { days: Number(days) }),
        ...(isDefault !== undefined && { isDefault: !!isDefault }),
        ...(isActive !== undefined && { isActive: !!isActive }),
      },
    });
    res.json(term);
  } catch (err) {
    if (err.code === 'P2002') return res.status(400).json({ error: 'A payment term with that name already exists' });
    next(err);
  }
};

const deletePaymentTerm = async (req, res, next) => {
  try {
    const { id } = req.params;
    await prisma.paymentTerm.delete({ where: { id: Number(id) } });
    res.json({ message: 'Payment term deleted' });
  } catch (err) { next(err); }
};
```

Then change the `module.exports` line to:

```js
module.exports = {
  getAll, saveAll, resetDefaults, backupDatabase, resetDatabase, getDbStats,
  listUsers, updateUser, deleteUser, resetUserPassword,
  listPaymentTerms, createPaymentTerm, updatePaymentTerm, deletePaymentTerm,
  DEFAULTS,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/settingsPaymentTerms.test.js
```

Expected: PASS — all 8 tests green.

- [ ] **Step 5: Commit**

```bash
git add server/controllers/settingsController.js tests/settingsPaymentTerms.test.js
git commit -m "$(cat <<'EOF'
feat(settings): add payment terms CRUD to settingsController

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Routes + `lib/api.js` helpers for Payment Terms

**Files:**
- Modify: `server/routes/settings.js`
- Modify: `lib/api.js`

**Interfaces:**
- Consumes: `ctrl.listPaymentTerms/createPaymentTerm/updatePaymentTerm/deletePaymentTerm` (Task 2).
- Produces: `settings.listPaymentTerms()`, `settings.createPaymentTerm(data)`, `settings.updatePaymentTerm(id, data)`, `settings.deletePaymentTerm(id)` in `lib/api.js`'s `settings` export — consumed by Task 4 and all frontend-form tasks (9–12).

- [ ] **Step 1: Add the routes**

In `server/routes/settings.js`, after the existing user-management block (ends at line 22 with `router.post('/users/:id/reset-password', ...)`) and before `module.exports = router;`, insert:

```js

// Payment Terms
router.get('/payment-terms',        ctrl.listPaymentTerms);
router.post('/payment-terms',       authorize('ADMIN', 'MANAGER'), ctrl.createPaymentTerm);
router.put('/payment-terms/:id',    authorize('ADMIN', 'MANAGER'), ctrl.updatePaymentTerm);
router.delete('/payment-terms/:id', authorize('ADMIN', 'MANAGER'), ctrl.deletePaymentTerm);
```

- [ ] **Step 2: Add the `lib/api.js` helpers**

In `lib/api.js`, inside the `export const settings = { ... }` block, change:

```js
  listUsers:      ()       => api.get('/settings/users'),
  updateUser:     (id, d)  => api.put(`/settings/users/${id}`, d),
  deleteUser:     (id)     => api.delete(`/settings/users/${id}`),
  resetPassword:  (id, d)  => api.post(`/settings/users/${id}/reset-password`, d),
};
```

to:

```js
  listUsers:      ()       => api.get('/settings/users'),
  updateUser:     (id, d)  => api.put(`/settings/users/${id}`, d),
  deleteUser:     (id)     => api.delete(`/settings/users/${id}`),
  resetPassword:  (id, d)  => api.post(`/settings/users/${id}/reset-password`, d),
  // Payment Terms
  listPaymentTerms:  ()      => api.get('/settings/payment-terms'),
  createPaymentTerm: (d)     => api.post('/settings/payment-terms', d),
  updatePaymentTerm: (id, d) => api.put(`/settings/payment-terms/${id}`, d),
  deletePaymentTerm: (id)    => api.delete(`/settings/payment-terms/${id}`),
};
```

- [ ] **Step 3: Verify the server starts cleanly**

```bash
node -e "require('./server/routes/settings.js'); console.log('settings routes OK')"
```

Expected: prints `settings routes OK` with no errors (confirms no syntax errors and `ctrl.listPaymentTerms` etc. resolve since Task 2 already exported them).

- [ ] **Step 4: Commit**

```bash
git add server/routes/settings.js lib/api.js
git commit -m "$(cat <<'EOF'
feat(settings): wire payment terms routes and API client helpers

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Settings UI — "Payment Terms" tab

**Files:**
- Modify: `app/(dashboard)/settings/page.jsx`

**Interfaces:**
- Consumes: `settingsApi.listPaymentTerms/createPaymentTerm/updatePaymentTerm/deletePaymentTerm` (Task 3).
- Produces: a working Settings tab where ADMIN/MANAGER can add, rename, delete, activate/deactivate, and set-default payment terms — the data source Task 9–12's dropdowns read from.

- [ ] **Step 1: Add the `CalendarClock` icon import**

In `app/(dashboard)/settings/page.jsx`, change the `lucide-react` import block:

```js
import {
  Building2, FileText, Users, Database, Settings as SettingsIcon,
  Calculator, Hash, Shield, Save, RefreshCw, Download, AlertTriangle,
  CheckCircle, Eye, EyeOff, Trash2, Plus, Edit2, Key, ToggleLeft,
  ToggleRight, Server, HardDrive, Clock, Globe, Loader2, X, ChevronDown,
  Inbox, HelpCircle, Blocks, Mail,
} from 'lucide-react';
```

to:

```js
import {
  Building2, FileText, Users, Database, Settings as SettingsIcon,
  Calculator, Hash, Shield, Save, RefreshCw, Download, AlertTriangle,
  CheckCircle, Eye, EyeOff, Trash2, Plus, Edit2, Key, ToggleLeft,
  ToggleRight, Server, HardDrive, Clock, Globe, Loader2, X, ChevronDown,
  Inbox, HelpCircle, Blocks, Mail, CalendarClock,
} from 'lucide-react';
```

- [ ] **Step 2: Add the tab entry**

In the `TABS` array, change:

```js
  { key: 'numbering',  label: 'Numbering',    icon: Hash,         roles: ['ADMIN', 'MANAGER'] },
  { key: 'users',      label: 'Users',         icon: Users,        roles: ['ADMIN'] },
```

to:

```js
  { key: 'numbering',  label: 'Numbering',    icon: Hash,         roles: ['ADMIN', 'MANAGER'] },
  { key: 'paymentTerms', label: 'Payment Terms', icon: CalendarClock, roles: ['ADMIN', 'MANAGER'] },
  { key: 'users',      label: 'Users',         icon: Users,        roles: ['ADMIN'] },
```

- [ ] **Step 3: Add state and the loader**

Change:

```js
  const [users,     setUsers]     = useState([]);
```

to:

```js
  const [users,         setUsers]         = useState([]);
  const [paymentTerms,  setPaymentTerms]  = useState([]);
  const [newTermName,   setNewTermName]   = useState('');
  const [newTermDays,   setNewTermDays]   = useState('30');
  const [addingTerm,    setAddingTerm]    = useState(false);
```

Change:

```js
  // Load users
  const loadUsers = useCallback(async () => {
    try {
      const r = await settingsApi.listUsers();
      setUsers(r.data);
    } catch { toast.error('Failed to load users'); }
  }, []);
```

to:

```js
  // Load users
  const loadUsers = useCallback(async () => {
    try {
      const r = await settingsApi.listUsers();
      setUsers(r.data);
    } catch { toast.error('Failed to load users'); }
  }, []);

  // Load payment terms
  const loadPaymentTerms = useCallback(async () => {
    try {
      const r = await settingsApi.listPaymentTerms();
      setPaymentTerms(r.data);
    } catch { toast.error('Failed to load payment terms'); }
  }, []);
```

- [ ] **Step 4: Dispatch the loader when the tab is active**

Change:

```js
  useEffect(() => {
    if (activeTab === 'users')       loadUsers();
    if (activeTab === 'database')    { loadDbStats(); loadModuleList(); }
    if (activeTab === 'permissions') loadPermissions();
    if (activeTab === 'inquiries')   loadInquiries();
    if (activeTab === 'modules')     loadDisabledMods();
  }, [activeTab]);
```

to:

```js
  useEffect(() => {
    if (activeTab === 'users')         loadUsers();
    if (activeTab === 'paymentTerms')  loadPaymentTerms();
    if (activeTab === 'database')      { loadDbStats(); loadModuleList(); }
    if (activeTab === 'permissions')   loadPermissions();
    if (activeTab === 'inquiries')     loadInquiries();
    if (activeTab === 'modules')       loadDisabledMods();
  }, [activeTab]);
```

- [ ] **Step 5: Add the handlers**

Change:

```js
  const handleDeleteUser = async (user) => {
```

to (inserting new handlers immediately before it):

```js
  const handleAddTerm = async () => {
    if (!newTermName.trim()) { toast.error('Enter a term name'); return; }
    setAddingTerm(true);
    try {
      await settingsApi.createPaymentTerm({ name: newTermName.trim(), days: Number(newTermDays) || 0 });
      setNewTermName(''); setNewTermDays('30');
      toast.success('Payment term added');
      loadPaymentTerms();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to add term'); }
    finally { setAddingTerm(false); }
  };

  const handleSetDefaultTerm = async (term) => {
    try {
      await settingsApi.updatePaymentTerm(term.id, { isDefault: true });
      loadPaymentTerms();
    } catch { toast.error('Failed to set default'); }
  };

  const handleToggleTermActive = async (term) => {
    try {
      await settingsApi.updatePaymentTerm(term.id, { isActive: !term.isActive });
      loadPaymentTerms();
    } catch { toast.error('Failed to update term'); }
  };

  const handleDeleteTerm = async (term) => {
    if (!confirm(`Delete payment term "${term.name}"?`)) return;
    try {
      await settingsApi.deletePaymentTerm(term.id);
      toast.success('Payment term deleted');
      loadPaymentTerms();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to delete'); }
  };

  const handleDeleteUser = async (user) => {
```

- [ ] **Step 6: Add the tab's JSX section**

In the tab-content area, change:

```jsx
          {/* ── Fiscal & Tax ── */}
          {activeTab === 'fiscal' && (
```

to (inserting a new section immediately before it):

```jsx
          {/* ── Payment Terms ── */}
          {activeTab === 'paymentTerms' && (
            <>
              <SectionTitle icon={CalendarClock}>Payment Terms</SectionTitle>
              <p className="text-xs text-gray-400 -mt-2 mb-2">
                Named terms selectable on Invoices, Bills, Quotations, and Purchase Orders — picking one auto-fills the due/valid/expected date, which you can still edit afterward.
              </p>

              <div className="flex items-end gap-3 p-4 bg-gray-50 rounded-xl">
                <div className="form-group flex-1 mb-0">
                  <label className="label">Name</label>
                  <input className="input" value={newTermName} onChange={(e) => setNewTermName(e.target.value)} placeholder="e.g. Net 45" maxLength={50} />
                </div>
                <div className="form-group w-32 mb-0">
                  <label className="label">Days</label>
                  <input type="number" min="0" className="input" value={newTermDays} onChange={(e) => setNewTermDays(e.target.value)} />
                </div>
                <button onClick={handleAddTerm} disabled={addingTerm} className="btn-primary btn-sm">
                  <Plus className="w-3.5 h-3.5" /> Add Term
                </button>
              </div>

              <div className="table-wrapper">
                <table className="table text-sm">
                  <thead>
                    <tr><th>Name</th><th className="text-right">Days</th><th>Default</th><th>Active</th><th className="text-center">Actions</th></tr>
                  </thead>
                  <tbody>
                    {paymentTerms.map((t) => (
                      <tr key={t.id}>
                        <td className="font-medium">{t.name}</td>
                        <td className="text-right font-mono">{t.days}</td>
                        <td>
                          {t.isDefault
                            ? <span className="badge badge-blue text-xs">Default</span>
                            : <button onClick={() => handleSetDefaultTerm(t)} className="text-xs text-gray-400 hover:text-blue-600">Set default</button>}
                        </td>
                        <td>
                          <button onClick={() => handleToggleTermActive(t)} title={t.isActive ? 'Deactivate' : 'Activate'}
                            className={`p-1.5 rounded-lg transition-colors ${t.isActive ? 'text-green-500 hover:bg-green-50' : 'text-gray-300 hover:bg-gray-50'}`}>
                            {t.isActive ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                        <td className="text-center">
                          <button onClick={() => handleDeleteTerm(t)} title="Delete" className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ── Fiscal & Tax ── */}
          {activeTab === 'fiscal' && (
```

- [ ] **Step 7: Manually verify in the browser**

Start the dev server (`npm run dev`, or ask the user to if one is already running per this repo's convention of the user owning `npm run dev`), log in as ADMIN, go to Settings → Payment Terms. Confirm:
- The 5 seeded terms (Task 1) display, with "Net 30" showing the "Default" badge.
- Adding a new term (e.g. "Net 45" / 45 days) appears in the table immediately.
- Clicking "Set default" on a different row moves the "Default" badge to that row only.
- Toggling Active/Inactive and deleting a row both work and persist on reload.

- [ ] **Step 8: Commit**

```bash
git add "app/(dashboard)/settings/page.jsx"
git commit -m "$(cat <<'EOF'
feat(settings): add Payment Terms management tab

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Invoice controller stores `paymentTerms`

**Files:**
- Modify: `server/controllers/receivableController.js`
- Create: `tests/receivableControllerPaymentTerms.test.js`

**Interfaces:**
- Produces: `createInvoice`/`updateInvoice` accept an optional `paymentTerms` string in `req.body` and persist it on the `Invoice` row — consumed by Task 9's frontend form and Task 11's conversion wiring (the created invoice's `paymentTerms` is read back by the UI).

- [ ] **Step 1: Write the failing test**

Create `tests/receivableControllerPaymentTerms.test.js`:

```js
jest.mock('../server/config/database', () => ({
  invoice: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  journalEntry: { findFirst: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/receivableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('receivableController — paymentTerms snapshot', () => {
  test('createInvoice stores the submitted paymentTerms label', async () => {
    let created;
    prisma.invoice.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, invoiceNo: 'INV-1000', customer: { name: 'Acme' }, ...args.data, lines: [] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createInvoice, {
      body: {
        customerId: 1, invoiceDate: '2026-09-09', dueDate: '2026-10-09', paymentTerms: 'Net 30',
        lines: [{ accountId: 1, description: 'Service', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(created.paymentTerms).toBe('Net 30');
  });

  test('createInvoice stores null when no paymentTerms is submitted', async () => {
    let created;
    prisma.invoice.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, invoiceNo: 'INV-1000', customer: { name: 'Acme' }, ...args.data, lines: [] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createInvoice, {
      body: {
        customerId: 1, invoiceDate: '2026-09-09', dueDate: '2026-10-09',
        lines: [{ accountId: 1, description: 'Service', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(created.paymentTerms).toBeNull();
  });

  test('updateInvoice stores an updated paymentTerms label', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ id: 1, status: 'OPEN', paidAmount: 0, invoiceNo: 'INV-1000' });
    let updatedData;
    prisma.invoice.update.mockImplementation((args) => {
      updatedData = args.data;
      return Promise.resolve({ id: 1, invoiceNo: 'INV-1000', customer: { name: 'Acme' }, ...args.data, lines: [], payments: [] });
    });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, {
      params: { id: '1' },
      body: {
        customerId: 1, invoiceDate: '2026-09-09', dueDate: '2026-10-24', paymentTerms: 'Net 45',
        lines: [{ accountId: 1, description: 'Service', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(updatedData.paymentTerms).toBe('Net 45');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/receivableControllerPaymentTerms.test.js
```

Expected: FAIL — `created.paymentTerms` is `undefined`, not `'Net 30'` / not `null`.

- [ ] **Step 3: Implement**

In `server/controllers/receivableController.js`, change `createInvoice`:

```js
exports.createInvoice = async (req, res, next) => {
  try {
    const { customerId, invoiceDate, dueDate, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeInvoiceTotals(lines);

    const invoiceNo = await genInvNo();
    const inv = await prisma.invoice.create({
      data: {
        businessId: req.businessId,
        invoiceNo, customerId: Number(customerId),
        invoiceDate: new Date(invoiceDate), dueDate: new Date(dueDate),
        description, notes, subtotal, vatAmount, totalAmount,
```

to:

```js
exports.createInvoice = async (req, res, next) => {
  try {
    const { customerId, invoiceDate, dueDate, paymentTerms, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeInvoiceTotals(lines);

    const invoiceNo = await genInvNo();
    const inv = await prisma.invoice.create({
      data: {
        businessId: req.businessId,
        invoiceNo, customerId: Number(customerId),
        invoiceDate: new Date(invoiceDate), dueDate: new Date(dueDate), paymentTerms: paymentTerms || null,
        description, notes, subtotal, vatAmount, totalAmount,
```

Then change `updateInvoice`:

```js
    const { customerId, invoiceDate, dueDate, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeInvoiceTotals(lines);

    if (totalAmount < Number(inv.paidAmount) - 0.01) {
```

to:

```js
    const { customerId, invoiceDate, dueDate, paymentTerms, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeInvoiceTotals(lines);

    if (totalAmount < Number(inv.paidAmount) - 0.01) {
```

and:

```js
      data: {
        customerId: Number(customerId),
        invoiceDate: new Date(invoiceDate),
        dueDate: new Date(dueDate),
        description, notes, subtotal, vatAmount, totalAmount, status,
```

to:

```js
      data: {
        customerId: Number(customerId),
        invoiceDate: new Date(invoiceDate),
        dueDate: new Date(dueDate),
        paymentTerms: paymentTerms || null,
        description, notes, subtotal, vatAmount, totalAmount, status,
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tests/receivableControllerPaymentTerms.test.js
```

Expected: PASS — all 3 tests green.

- [ ] **Step 5: Run the full existing receivable test suite to check for regressions**

```bash
npx jest tests/receivableController.test.js
```

Expected: PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add server/controllers/receivableController.js tests/receivableControllerPaymentTerms.test.js
git commit -m "$(cat <<'EOF'
feat(receivable): store payment terms snapshot on invoice create/update

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Bill controller stores `paymentTerms`

**Files:**
- Modify: `server/controllers/payableController.js`
- Create: `tests/payableControllerPaymentTerms.test.js`

**Interfaces:**
- Produces: `createBill`/`updateBill` accept an optional `paymentTerms` string in `req.body` and persist it on the `Bill` row — consumed by Task 10's frontend form and Task 12's conversion wiring.

- [ ] **Step 1: Write the failing test**

Create `tests/payableControllerPaymentTerms.test.js`:

```js
jest.mock('../server/config/database', () => ({
  bill: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  account: { findMany: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('payableController — paymentTerms snapshot', () => {
  test('createBill stores the submitted paymentTerms label', async () => {
    prisma.account.findMany.mockResolvedValue([{ id: 1, normalBalance: 'DEBIT' }]);
    prisma.bill.count.mockResolvedValue(0);
    let created;
    prisma.bill.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, billNo: 'BILL-000001', vendor: { name: 'Acme Supply' }, ...args.data, lines: [] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createBill, {
      body: {
        vendorId: 1, billDate: '2026-08-28', dueDate: '2026-09-27', paymentTerms: 'Net 30',
        lines: [{ accountId: 1, description: 'Item A', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(created.paymentTerms).toBe('Net 30');
  });

  test('createBill stores null when no paymentTerms is submitted', async () => {
    prisma.account.findMany.mockResolvedValue([{ id: 1, normalBalance: 'DEBIT' }]);
    prisma.bill.count.mockResolvedValue(0);
    let created;
    prisma.bill.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, billNo: 'BILL-000001', vendor: { name: 'Acme Supply' }, ...args.data, lines: [] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createBill, {
      body: {
        vendorId: 1, billDate: '2026-08-28', dueDate: '2026-09-27',
        lines: [{ accountId: 1, description: 'Item A', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(created.paymentTerms).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/payableControllerPaymentTerms.test.js
```

Expected: FAIL — `created.paymentTerms` is `undefined`.

- [ ] **Step 3: Implement**

In `server/controllers/payableController.js`, change `createBill`:

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
```

to:

```js
exports.createBill = async (req, res, next) => {
  try {
    const { vendorId, billDate, dueDate, paymentTerms, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeBillTotals(lines);

    const billNo = await genBillNo();
    const bill = await prisma.bill.create({
      data: {
        businessId: req.businessId,
        billNo, vendorId: Number(vendorId),
        billDate: new Date(billDate), dueDate: new Date(dueDate), paymentTerms: paymentTerms || null,
        description, notes, subtotal, vatAmount, totalAmount,
```

Then change `updateBill`:

```js
    const { vendorId, billDate, dueDate, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeBillTotals(lines);

    if (totalAmount < Number(bill.paidAmount) - 0.01) {
```

to:

```js
    const { vendorId, billDate, dueDate, paymentTerms, description, notes, lines } = req.body;
    const { subtotal, vatAmount, totalAmount, processedLines } = await computeBillTotals(lines);

    if (totalAmount < Number(bill.paidAmount) - 0.01) {
```

and:

```js
      data: {
        vendorId: Number(vendorId),
        billDate: new Date(billDate),
        dueDate: new Date(dueDate),
        description, notes, subtotal, vatAmount, totalAmount, status,
```

to:

```js
      data: {
        vendorId: Number(vendorId),
        billDate: new Date(billDate),
        dueDate: new Date(dueDate),
        paymentTerms: paymentTerms || null,
        description, notes, subtotal, vatAmount, totalAmount, status,
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tests/payableControllerPaymentTerms.test.js
```

Expected: PASS — both tests green.

- [ ] **Step 5: Run the full existing payable test suite to check for regressions**

```bash
npx jest tests/payableControllerCreateBill.test.js tests/payableControllerUpdateBill.test.js
```

Expected: PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add server/controllers/payableController.js tests/payableControllerPaymentTerms.test.js
git commit -m "$(cat <<'EOF'
feat(payable): store payment terms snapshot on bill create/update

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Quotation controller stores/carries `paymentTerms`

**Files:**
- Modify: `server/controllers/quotationController.js`
- Create: `tests/quotationControllerPaymentTerms.test.js`

**Interfaces:**
- Produces: `create`/`update` accept+store `paymentTerms`. `convertPreview` additionally returns `paymentTerms` and `quotationDate` in its JSON (consumed by Task 11's `ConvertModal` to compute a sensible default due date). `convert` accepts an optional `paymentTerms` in `req.body` and stores it on the newly created `Invoice`.

- [ ] **Step 1: Write the failing test**

Create `tests/quotationControllerPaymentTerms.test.js`:

```js
jest.mock('../server/config/database', () => ({
  quotation: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  account: { findFirst: jest.fn(), findMany: jest.fn() },
  invoice: { create: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/quotationController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('quotationController — paymentTerms snapshot and carry-forward', () => {
  test('create stores the submitted paymentTerms label', async () => {
    let created;
    prisma.quotation.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, quotationNo: 'QTN-1000', customer: { name: 'Acme' }, ...args.data, lines: [] });
    });

    await run(ctrl.create, {
      body: {
        customerId: 1, quotationDate: '2026-09-09', validUntil: '2026-10-09', paymentTerms: 'Net 30',
        lines: [{ description: 'Service', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(created.paymentTerms).toBe('Net 30');
  });

  test('convertPreview returns the quotation\'s paymentTerms and quotationDate', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      id: 5, quotationNo: 'QTN-1005', status: 'SENT', totalAmount: 1000,
      paymentTerms: 'Net 45', quotationDate: new Date('2026-09-01'),
      customer: { name: 'Acme' }, lines: [],
    });
    prisma.account.findFirst.mockResolvedValue({ id: 10 });

    const result = await run(ctrl.convertPreview, { params: { id: '5' } });

    expect(result.paymentTerms).toBe('Net 45');
    expect(result.quotationDate).toEqual(new Date('2026-09-01'));
  });

  test('convert stores the submitted paymentTerms on the new invoice', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      id: 5, quotationNo: 'QTN-1005', status: 'SENT', businessId: 1, customerId: 1,
      description: '', lines: [{ id: 1, accountId: 10, itemName: '', description: 'Service', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
    });
    prisma.account.findMany.mockResolvedValue([{ id: 10, normalBalance: 'CREDIT' }]);
    let created;
    prisma.invoice.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, invoiceNo: 'INV-1000', customer: { name: 'Acme' }, ...args.data, lines: [] });
    });
    prisma.quotation.update.mockResolvedValue({});
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.convert, {
      params: { id: '5' },
      body: { dueDate: '2026-10-24', paymentTerms: 'Net 45', accounts: [{ lineId: 1, accountId: 10 }] },
    });

    expect(created.paymentTerms).toBe('Net 45');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/quotationControllerPaymentTerms.test.js
```

Expected: FAIL — `created.paymentTerms` undefined, `result.paymentTerms` undefined.

- [ ] **Step 3: Implement — `create`**

Change:

```js
exports.create = async (req, res, next) => {
  try {
    const { customerId, quotationDate, validUntil, description, notes, lines } = req.body;
    const { subtotal, vatAmount, processed } = computeTotals(lines);
```

to:

```js
exports.create = async (req, res, next) => {
  try {
    const { customerId, quotationDate, validUntil, paymentTerms, description, notes, lines } = req.body;
    const { subtotal, vatAmount, processed } = computeTotals(lines);
```

and:

```js
            quotationNo, customerId: Number(customerId),
            quotationDate: new Date(quotationDate), validUntil: new Date(validUntil),
            description, notes, subtotal, vatAmount, totalAmount: subtotal + vatAmount,
```

to:

```js
            quotationNo, customerId: Number(customerId),
            quotationDate: new Date(quotationDate), validUntil: new Date(validUntil), paymentTerms: paymentTerms || null,
            description, notes, subtotal, vatAmount, totalAmount: subtotal + vatAmount,
```

- [ ] **Step 4: Implement — `update`**

Change:

```js
    const { customerId, quotationDate, validUntil, description, notes, lines } = req.body;
    const { subtotal, vatAmount, processed } = computeTotals(lines || []);

    await prisma.quotation.update({
      where: { id },
      data: {
        customerId:    customerId ? Number(customerId) : undefined,
        quotationDate: quotationDate ? new Date(quotationDate) : undefined,
        validUntil:    validUntil ? new Date(validUntil) : undefined,
        description,
```

to:

```js
    const { customerId, quotationDate, validUntil, paymentTerms, description, notes, lines } = req.body;
    const { subtotal, vatAmount, processed } = computeTotals(lines || []);

    await prisma.quotation.update({
      where: { id },
      data: {
        customerId:    customerId ? Number(customerId) : undefined,
        quotationDate: quotationDate ? new Date(quotationDate) : undefined,
        validUntil:    validUntil ? new Date(validUntil) : undefined,
        paymentTerms:  paymentTerms !== undefined ? (paymentTerms || null) : undefined,
        description,
```

- [ ] **Step 5: Implement — `convertPreview`**

Change:

```js
    res.json({
      quotationNo: q.quotationNo,
      customer:    q.customer,
      totalAmount: q.totalAmount,
      lines: q.lines.map((l) => ({
```

to:

```js
    res.json({
      quotationNo:   q.quotationNo,
      customer:      q.customer,
      totalAmount:   q.totalAmount,
      paymentTerms:  q.paymentTerms,
      quotationDate: q.quotationDate,
      lines: q.lines.map((l) => ({
```

- [ ] **Step 6: Implement — `convert`**

Change:

```js
    const { dueDate, accounts } = req.body;
```

to:

```js
    const { dueDate, paymentTerms, accounts } = req.body;
```

Change:

```js
    const inv = await prisma.invoice.create({
      data: {
        businessId: q.businessId,
        invoiceNo, customerId: q.customerId,
        invoiceDate: new Date(), dueDate: due,
        description: q.description || `From quotation ${q.quotationNo}`,
        subtotal, vatAmount, totalAmount,
```

to:

```js
    const inv = await prisma.invoice.create({
      data: {
        businessId: q.businessId,
        invoiceNo, customerId: q.customerId,
        invoiceDate: new Date(), dueDate: due, paymentTerms: paymentTerms || null,
        description: q.description || `From quotation ${q.quotationNo}`,
        subtotal, vatAmount, totalAmount,
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
npx jest tests/quotationControllerPaymentTerms.test.js
```

Expected: PASS — all 3 tests green.

- [ ] **Step 8: Commit**

```bash
git add server/controllers/quotationController.js tests/quotationControllerPaymentTerms.test.js
git commit -m "$(cat <<'EOF'
feat(quotations): store and carry forward payment terms on convert

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Purchase Order controller stores/carries `paymentTerms`

**Files:**
- Modify: `server/controllers/purchaseOrderController.js`
- Create: `tests/purchaseOrderControllerPaymentTerms.test.js`

**Interfaces:**
- Produces: `create`/`update` accept+store `paymentTerms` on `PurchaseOrder`. `convertToBill` accepts an optional `paymentTerms` in `req.body` and stores it on the newly created `Bill`.

- [ ] **Step 1: Write the failing test**

Create `tests/purchaseOrderControllerPaymentTerms.test.js`:

```js
jest.mock('../server/config/database', () => ({
  purchaseOrder: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), $transaction: jest.fn() },
  purchaseOrderLine: { deleteMany: jest.fn(), createMany: jest.fn() },
  bill: { create: jest.fn() },
  $transaction: jest.fn((arg) => (Array.isArray(arg) ? Promise.all(arg) : arg())),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/purchaseOrderController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, user: { id: 1 }, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('purchaseOrderController — paymentTerms snapshot and carry-forward', () => {
  test('create stores the submitted paymentTerms label', async () => {
    let created;
    prisma.purchaseOrder.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, poNumber: 'PO-1000', vendor: { name: 'Acme Supply' }, ...args.data, lines: [] });
    });

    await run(ctrl.create, {
      body: {
        vendorId: 1, orderDate: '2026-09-09', paymentTerms: 'Net 30',
        lines: [{ description: 'Item A', quantity: 1, unitPrice: 1000, accountId: 1 }],
      },
    });

    expect(created.paymentTerms).toBe('Net 30');
  });

  test('convertToBill stores the submitted paymentTerms on the new bill', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 1, poNumber: 'PO-1000', status: 'RECEIVED', vendorId: 1,
      vendor: { name: 'Acme Supply' },
      lines: [{ accountId: 1, description: 'Item A', quantity: 1, unitPrice: 1000, amount: 1000 }],
      subtotal: 1000, taxAmount: 0, total: 1000,
    });
    let created;
    prisma.bill.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, billNo: 'BILL-000001', vendor: { name: 'Acme Supply' }, ...args.data, lines: [] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.convertToBill, {
      params: { id: '1' },
      body: { billDate: '2026-09-09', dueDate: '2026-10-09', paymentTerms: 'Net 30' },
    });

    expect(created.paymentTerms).toBe('Net 30');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/purchaseOrderControllerPaymentTerms.test.js
```

Expected: FAIL — `created.paymentTerms` undefined.

- [ ] **Step 3: Implement — `create`**

Change:

```js
exports.create = async (req, res, next) => {
  try {
    const { vendorId, orderDate, expectedDate, notes, taxAmount, lines } = req.body;
    if (!lines?.length) throw createError('At least one line item is required', 400);

    const { subtotal, taxAmount: tax, total } = computeTotals(lines, taxAmount);
    const poNumber = await genPONumber();

    const po = await prisma.purchaseOrder.create({
      data: {
        businessId: req.businessId,
        poNumber,
        vendorId: Number(vendorId),
        orderDate: new Date(orderDate),
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        notes,
```

to:

```js
exports.create = async (req, res, next) => {
  try {
    const { vendorId, orderDate, expectedDate, paymentTerms, notes, taxAmount, lines } = req.body;
    if (!lines?.length) throw createError('At least one line item is required', 400);

    const { subtotal, taxAmount: tax, total } = computeTotals(lines, taxAmount);
    const poNumber = await genPONumber();

    const po = await prisma.purchaseOrder.create({
      data: {
        businessId: req.businessId,
        poNumber,
        vendorId: Number(vendorId),
        orderDate: new Date(orderDate),
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        paymentTerms: paymentTerms || null,
        notes,
```

- [ ] **Step 4: Implement — `update`**

Change:

```js
    const { vendorId, orderDate, expectedDate, notes, taxAmount, lines } = req.body;
    const { subtotal, taxAmount: tax, total } = computeTotals(lines || [], taxAmount);
```

to:

```js
    const { vendorId, orderDate, expectedDate, paymentTerms, notes, taxAmount, lines } = req.body;
    const { subtotal, taxAmount: tax, total } = computeTotals(lines || [], taxAmount);
```

Change:

```js
        data: {
          ...(vendorId && { vendorId: Number(vendorId) }),
          ...(orderDate && { orderDate: new Date(orderDate) }),
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          notes,
          ...(lines && { subtotal, taxAmount: tax, total }),
        },
```

to:

```js
        data: {
          ...(vendorId && { vendorId: Number(vendorId) }),
          ...(orderDate && { orderDate: new Date(orderDate) }),
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          paymentTerms: paymentTerms !== undefined ? (paymentTerms || null) : undefined,
          notes,
          ...(lines && { subtotal, taxAmount: tax, total }),
        },
```

- [ ] **Step 5: Implement — `convertToBill`**

Change:

```js
    const { billDate, dueDate } = req.body;
    const billNo = await genBillNo();

    const bill = await prisma.bill.create({
      data: {
        businessId: req.businessId,
        billNo,
        vendorId: po.vendorId,
        billDate: billDate ? new Date(billDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 86400000),
        description: `From ${po.poNumber}`,
```

to:

```js
    const { billDate, dueDate, paymentTerms } = req.body;
    const billNo = await genBillNo();

    const bill = await prisma.bill.create({
      data: {
        businessId: req.businessId,
        billNo,
        vendorId: po.vendorId,
        billDate: billDate ? new Date(billDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 86400000),
        paymentTerms: paymentTerms || null,
        description: `From ${po.poNumber}`,
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
npx jest tests/purchaseOrderControllerPaymentTerms.test.js
```

Expected: PASS — both tests green.

- [ ] **Step 7: Commit**

```bash
git add server/controllers/purchaseOrderController.js tests/purchaseOrderControllerPaymentTerms.test.js
git commit -m "$(cat <<'EOF'
feat(purchase-orders): store and carry forward payment terms on convert

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Invoice form — dropdown, auto-date, display

**Files:**
- Modify: `app/(dashboard)/receivable/page.jsx`

**Interfaces:**
- Consumes: `settings.listPaymentTerms()` (Task 3), `paymentTerms` field now accepted/returned by `createInvoice`/`updateInvoice` (Task 5).
- Produces: a working "Payment Terms" dropdown on the Invoice create/edit form that drives `dueDate`, and a "Payment Terms" line in the detail view and print/email output.

- [ ] **Step 1: Import the settings API and load terms**

Change:

```js
import { receivable as rApi, accounts as acctApi, notifications as notifApi } from '@/lib/api';
```

to:

```js
import { receivable as rApi, accounts as acctApi, notifications as notifApi, settings as settingsApi } from '@/lib/api';
```

Change:

```js
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts]   = useState([]);
```

to:

```js
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
```

Change:

```js
  useEffect(() => {
    rApi.customers.list({ active: true }).then((r) => setCustomers(r.data));
    acctApi.list({ active: true }).then((r) => setAccounts(r.data));
  }, []);
```

to:

```js
  useEffect(() => {
    rApi.customers.list({ active: true }).then((r) => setCustomers(r.data));
    acctApi.list({ active: true }).then((r) => setAccounts(r.data));
    settingsApi.listPaymentTerms().then((r) => setPaymentTerms(r.data.filter((t) => t.isActive)));
  }, []);
```

- [ ] **Step 2: Pass `paymentTerms` into both `CreateInvoiceModal` instances**

Change both occurrences of:

```jsx
        <CreateInvoiceModal
          customers={customers}
          accounts={accounts}
```

to:

```jsx
        <CreateInvoiceModal
          customers={customers}
          accounts={accounts}
          paymentTerms={paymentTerms}
```

(There are two such blocks — the `modal?.type === 'create'` and `modal?.type === 'edit'` renders — update both.)

- [ ] **Step 3: Accept the prop and seed the form's `paymentTerms` field**

Change:

```js
function CreateInvoiceModal({ customers, accounts, invoice, onClose, onSaved, onCustomerAdded }) {
  const [form, setForm] = useState(() => {
    if (invoice) return {
      customerId:  String(invoice.customerId),
      invoiceDate: invoice.invoiceDate.slice(0, 10),
      dueDate:     invoice.dueDate.slice(0, 10),
      description: invoice.description || '',
      notes:       invoice.notes || '',
      lines: invoice.lines.map((l) => ({
        accountId: String(l.accountId), description: l.description,
        quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatCode: l.vatCode,
      })),
    };
    const invoiceDate = new Date().toISOString().split('T')[0];
    const due = new Date(invoiceDate);
    due.setDate(due.getDate() + 30);
    return {
      customerId:   '',
      invoiceDate,
      dueDate:      due.toISOString().split('T')[0],
      description:  '',
      notes:        '',
      lines: [
        { accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' },
      ],
    };
  });
```

to:

```js
function CreateInvoiceModal({ customers, accounts, paymentTerms, invoice, onClose, onSaved, onCustomerAdded }) {
  const [form, setForm] = useState(() => {
    if (invoice) return {
      customerId:  String(invoice.customerId),
      invoiceDate: invoice.invoiceDate.slice(0, 10),
      dueDate:     invoice.dueDate.slice(0, 10),
      paymentTerms: invoice.paymentTerms || '',
      description: invoice.description || '',
      notes:       invoice.notes || '',
      lines: invoice.lines.map((l) => ({
        accountId: String(l.accountId), description: l.description,
        quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatCode: l.vatCode,
      })),
    };
    const defaultTerm = paymentTerms.find((t) => t.isDefault);
    const invoiceDate = new Date().toISOString().split('T')[0];
    const due = new Date(invoiceDate);
    due.setDate(due.getDate() + (defaultTerm ? defaultTerm.days : 30));
    return {
      customerId:   '',
      invoiceDate,
      dueDate:      due.toISOString().split('T')[0],
      paymentTerms: defaultTerm ? defaultTerm.name : '',
      description:  '',
      notes:        '',
      lines: [
        { accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' },
      ],
    };
  });
```

- [ ] **Step 4: Replace the auto-due-date effect to use the selected term's days**

Change:

```js
  // Auto due date: +30 days from invoice date
  useEffect(() => {
    if (form.invoiceDate && !form.dueDate) {
      const d = new Date(form.invoiceDate);
      d.setDate(d.getDate() + 30);
      setForm((f) => ({ ...f, dueDate: d.toISOString().split('T')[0] }));
    }
  }, [form.invoiceDate]);
```

to:

```js
  // Due date = invoice date + the selected term's days (falls back to 30 if no term is set)
  useEffect(() => {
    if (!form.invoiceDate) return;
    const term = paymentTerms.find((t) => t.name === form.paymentTerms);
    const days = term ? term.days : 30;
    const d = new Date(form.invoiceDate);
    d.setDate(d.getDate() + days);
    setForm((f) => ({ ...f, dueDate: d.toISOString().split('T')[0] }));
  }, [form.invoiceDate, form.paymentTerms]);
```

- [ ] **Step 5: Include `paymentTerms` in the submit payload**

This is already covered — `payload = { ...form, ... }` spreads `form.paymentTerms` through automatically. No change needed here; verify by reading the `handleSubmit` function after Step 3/4 to confirm `...form` is still the first spread key (it is, per the file read earlier).

- [ ] **Step 6: Add the dropdown to the form UI**

Change:

```jsx
              <div className="form-group">
                <label className="label">Due Date *</label>
                <input type="date" className="input" required value={form.dueDate} onChange={set('dueDate')} />
              </div>
            </div>
```

to:

```jsx
              <div className="form-group">
                <label className="label">Due Date *</label>
                <input type="date" className="input" required value={form.dueDate} onChange={set('dueDate')} />
              </div>
              <div className="form-group">
                <label className="label">Payment Terms</label>
                <select className="select" value={form.paymentTerms} onChange={set('paymentTerms')}>
                  <option value="">— none —</option>
                  {paymentTerms.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            </div>
```

- [ ] **Step 7: Show the stored term in the detail modal**

Change:

```jsx
            <div>
              <span className="text-gray-500 block text-xs uppercase tracking-wide mb-0.5">Due Date</span>
              <span className={`font-medium ${isOverdue ? 'text-red-600' : ''}`}>
                {formatDate(invoice.dueDate)}
                {isOverdue && <span className="text-xs block text-red-500">
                  {Math.floor((new Date() - new Date(invoice.dueDate)) / 86400000)} days overdue
                </span>}
              </span>
            </div>
```

to:

```jsx
            <div>
              <span className="text-gray-500 block text-xs uppercase tracking-wide mb-0.5">Due Date</span>
              <span className={`font-medium ${isOverdue ? 'text-red-600' : ''}`}>
                {formatDate(invoice.dueDate)}
                {isOverdue && <span className="text-xs block text-red-500">
                  {Math.floor((new Date() - new Date(invoice.dueDate)) / 86400000)} days overdue
                </span>}
              </span>
            </div>
            {invoice.paymentTerms && (
              <div>
                <span className="text-gray-500 block text-xs uppercase tracking-wide mb-0.5">Payment Terms</span>
                <span className="font-medium">{invoice.paymentTerms}</span>
              </div>
            )}
```

- [ ] **Step 8: Show the stored term in the print/email body**

Change:

```js
        <div class="info-box"><div class="info-lbl">Invoice Date</div><div class="info-val">${dateFmt(invoice.invoiceDate)}</div></div>
        <div class="info-box"><div class="info-lbl">Due Date</div><div class="info-val">${dateFmt(invoice.dueDate)}</div></div>
        <div class="info-box"><div class="info-lbl">Customer TIN</div><div class="info-val mono small">${invoice.customer?.tin || '—'}</div></div>
      </div>
```

to:

```js
        <div class="info-box"><div class="info-lbl">Invoice Date</div><div class="info-val">${dateFmt(invoice.invoiceDate)}</div></div>
        <div class="info-box"><div class="info-lbl">Due Date</div><div class="info-val">${dateFmt(invoice.dueDate)}</div></div>
        ${invoice.paymentTerms ? `<div class="info-box"><div class="info-lbl">Payment Terms</div><div class="info-val">${invoice.paymentTerms}</div></div>` : ''}
        <div class="info-box"><div class="info-lbl">Customer TIN</div><div class="info-val mono small">${invoice.customer?.tin || '—'}</div></div>
      </div>
```

- [ ] **Step 9: Manually verify in the browser**

With the dev server running: Receivable → New Sales Invoice. Confirm:
- "Net 30" (the seeded default) is pre-selected and the due date is exactly 30 days after today's invoice date.
- Switching to "COD" snaps the due date to the invoice date (0 days); switching to "Net 60" moves it 60 days out.
- Manually editing the due date afterward does not get silently overwritten, and does not clear the selected term.
- Saving, then reopening the invoice's detail view, shows the chosen "Payment Terms" value next to Due Date.
- Printing the invoice shows the same value in the printed layout.
- Creating an invoice with "— none —" selected still saves and displays fine (no blank/crash).

- [ ] **Step 10: Commit**

```bash
git add "app/(dashboard)/receivable/page.jsx"
git commit -m "$(cat <<'EOF'
feat(receivable): add payment terms selector to the invoice form

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Bill form — dropdown, auto-date, display

**Files:**
- Modify: `app/(dashboard)/payable/page.jsx`

**Interfaces:**
- Consumes: `settings.listPaymentTerms()` (Task 3), `paymentTerms` field now accepted/returned by `createBill`/`updateBill` (Task 6).
- Produces: the same dropdown/auto-date/display behavior as Task 9, mirrored for Bills.

- [ ] **Step 1: Import the settings API and load terms**

Change:

```js
import { payable as pApi, accounts as acctApi } from '@/lib/api';
```

to:

```js
import { payable as pApi, accounts as acctApi, settings as settingsApi } from '@/lib/api';
```

Change:

```js
  const [vendors, setVendors]     = useState([]);
  const [accounts, setAccounts]   = useState([]);
```

to:

```js
  const [vendors, setVendors]     = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
```

Change:

```js
  useEffect(() => {
    pApi.vendors.list({ active: true }).then((r) => setVendors(r.data));
    acctApi.list({ active: true }).then((r) => setAccounts(r.data));
  }, []);
```

to:

```js
  useEffect(() => {
    pApi.vendors.list({ active: true }).then((r) => setVendors(r.data));
    acctApi.list({ active: true }).then((r) => setAccounts(r.data));
    settingsApi.listPaymentTerms().then((r) => setPaymentTerms(r.data.filter((t) => t.isActive)));
  }, []);
```

- [ ] **Step 2: Pass `paymentTerms` into both `CreateBillModal` instances**

Change both occurrences of:

```jsx
        <CreateBillModal
          vendors={vendors}
          accounts={accounts}
```

to:

```jsx
        <CreateBillModal
          vendors={vendors}
          accounts={accounts}
          paymentTerms={paymentTerms}
```

- [ ] **Step 3: Accept the prop and seed the form's `paymentTerms` field**

Change:

```js
function CreateBillModal({ vendors, accounts, bill, onClose, onSaved, onVendorAdded }) {
  const [form, setForm] = useState(() => {
    if (bill) return {
      vendorId:    String(bill.vendorId),
      billDate:    bill.billDate.slice(0, 10),
      dueDate:     bill.dueDate.slice(0, 10),
      description: bill.description || '',
      notes:       bill.notes || '',
      lines: bill.lines.map((l) => ({
        accountId: String(l.accountId), description: l.description,
        quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatCode: l.vatCode,
      })),
    };
    const billDate = new Date().toISOString().split('T')[0];
    const due = new Date(billDate);
    due.setDate(due.getDate() + 30);
    return {
      vendorId: '',
      billDate,
      dueDate: due.toISOString().split('T')[0],
      description: '',
      notes: '',
      lines: [
        { accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' },
      ],
    };
  });
```

to:

```js
function CreateBillModal({ vendors, accounts, paymentTerms, bill, onClose, onSaved, onVendorAdded }) {
  const [form, setForm] = useState(() => {
    if (bill) return {
      vendorId:    String(bill.vendorId),
      billDate:    bill.billDate.slice(0, 10),
      dueDate:     bill.dueDate.slice(0, 10),
      paymentTerms: bill.paymentTerms || '',
      description: bill.description || '',
      notes:       bill.notes || '',
      lines: bill.lines.map((l) => ({
        accountId: String(l.accountId), description: l.description,
        quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatCode: l.vatCode,
      })),
    };
    const defaultTerm = paymentTerms.find((t) => t.isDefault);
    const billDate = new Date().toISOString().split('T')[0];
    const due = new Date(billDate);
    due.setDate(due.getDate() + (defaultTerm ? defaultTerm.days : 30));
    return {
      vendorId: '',
      billDate,
      dueDate: due.toISOString().split('T')[0],
      paymentTerms: defaultTerm ? defaultTerm.name : '',
      description: '',
      notes: '',
      lines: [
        { accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'EXEMPT' },
      ],
    };
  });
```

- [ ] **Step 4: Replace the auto-due-date effect to use the selected term's days**

Change:

```js
  // Auto due date: vendor bill date + 30 days
  useEffect(() => {
    if (form.billDate && !form.dueDate) {
      const d = new Date(form.billDate);
      d.setDate(d.getDate() + 30);
      setForm((f) => ({ ...f, dueDate: d.toISOString().split('T')[0] }));
    }
  }, [form.billDate]);
```

to:

```js
  // Due date = bill date + the selected term's days (falls back to 30 if no term is set)
  useEffect(() => {
    if (!form.billDate) return;
    const term = paymentTerms.find((t) => t.name === form.paymentTerms);
    const days = term ? term.days : 30;
    const d = new Date(form.billDate);
    d.setDate(d.getDate() + days);
    setForm((f) => ({ ...f, dueDate: d.toISOString().split('T')[0] }));
  }, [form.billDate, form.paymentTerms]);
```

- [ ] **Step 5: Add the dropdown to the form UI**

Change:

```jsx
              <div className="form-group">
                <label className="label">Due Date *</label>
                <input type="date" className="input" required value={form.dueDate} onChange={set('dueDate')} />
              </div>
            </div>
```

to:

```jsx
              <div className="form-group">
                <label className="label">Due Date *</label>
                <input type="date" className="input" required value={form.dueDate} onChange={set('dueDate')} />
              </div>
              <div className="form-group">
                <label className="label">Payment Terms</label>
                <select className="select" value={form.paymentTerms} onChange={set('paymentTerms')}>
                  <option value="">— none —</option>
                  {paymentTerms.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            </div>
```

- [ ] **Step 6: Show the stored term in the detail view**

Change:

```jsx
            <div><span className="text-gray-500 block">Due Date</span>
              <span className={`font-medium ${new Date(bill.dueDate) < new Date() && bill.status !== 'PAID' ? 'text-red-600' : ''}`}>
                {formatDate(bill.dueDate)}
              </span>
            </div>
```

to:

```jsx
            <div><span className="text-gray-500 block">Due Date</span>
              <span className={`font-medium ${new Date(bill.dueDate) < new Date() && bill.status !== 'PAID' ? 'text-red-600' : ''}`}>
                {formatDate(bill.dueDate)}
              </span>
            </div>
            {bill.paymentTerms && (
              <div><span className="text-gray-500 block">Payment Terms</span><span className="font-medium">{bill.paymentTerms}</span></div>
            )}
```

- [ ] **Step 7: Show the stored term in the print body**

Change:

```js
        <div class="info-box"><div class="info-lbl">Bill Date</div><div class="info-val">${dateFmt(bill.billDate)}</div></div>
        <div class="info-box"><div class="info-lbl">Due Date</div><div class="info-val">${dateFmt(bill.dueDate)}</div></div>
        <div class="info-box"><div class="info-lbl">Vendor TIN</div><div class="info-val mono small">${bill.vendor?.tin || '—'}</div></div>
```

to:

```js
        <div class="info-box"><div class="info-lbl">Bill Date</div><div class="info-val">${dateFmt(bill.billDate)}</div></div>
        <div class="info-box"><div class="info-lbl">Due Date</div><div class="info-val">${dateFmt(bill.dueDate)}</div></div>
        ${bill.paymentTerms ? `<div class="info-box"><div class="info-lbl">Payment Terms</div><div class="info-val">${bill.paymentTerms}</div></div>` : ''}
        <div class="info-box"><div class="info-lbl">Vendor TIN</div><div class="info-val mono small">${bill.vendor?.tin || '—'}</div></div>
```

- [ ] **Step 8: Manually verify in the browser**

Payable → New Bill / Purchase Invoice. Repeat the same checks as Task 9 Step 9, adapted to Bills (default term pre-selected, switching terms recomputes due date, manual override preserved, detail view + print show the stored term).

- [ ] **Step 9: Commit**

```bash
git add "app/(dashboard)/payable/page.jsx"
git commit -m "$(cat <<'EOF'
feat(payable): add payment terms selector to the bill form

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Quotation form + convert dialog — dropdown, auto-date, carry-forward, display

**Files:**
- Modify: `app/(dashboard)/receivable/quotations/page.jsx`

**Interfaces:**
- Consumes: `settings.listPaymentTerms()` (Task 3); `paymentTerms`/`quotationDate` now returned by `convertPreview` (Task 7).
- Produces: a "Payment Terms" dropdown on the Quotation form driving `validUntil`; the convert-to-invoice dialog now defaults its due date and `paymentTerms` from the source quotation instead of a hardcoded 30 days.

- [ ] **Step 1: Import the settings API and load terms**

Change:

```js
import { receivable as rApi, accounts as acctApi, inventory as invApi } from '@/lib/api';
```

to:

```js
import { receivable as rApi, accounts as acctApi, inventory as invApi, settings as settingsApi } from '@/lib/api';
```

Change:

```js
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [items, setItems]         = useState([]);
```

to:

```js
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [items, setItems]         = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
```

Change:

```js
  useEffect(() => {
    rApi.customers.list({ active: true }).then((r) => setCustomers(r.data));
    acctApi.list({ active: true }).then((r) => setAccounts(r.data));
    invApi.items.list({ limit: 500 })
      .then((r) => setItems(r.data.data || r.data || []))
      .catch(() => setItems([]));
  }, []);
```

to:

```js
  useEffect(() => {
    rApi.customers.list({ active: true }).then((r) => setCustomers(r.data));
    acctApi.list({ active: true }).then((r) => setAccounts(r.data));
    invApi.items.list({ limit: 500 })
      .then((r) => setItems(r.data.data || r.data || []))
      .catch(() => setItems([]));
    settingsApi.listPaymentTerms().then((r) => setPaymentTerms(r.data.filter((t) => t.isActive)));
  }, []);
```

- [ ] **Step 2: Pass `paymentTerms` into `QuotationModal` and `ConvertModal`**

Change:

```jsx
      {modal?.type === 'new' && (
        <QuotationModal customers={customers} items={items}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }}
          onCustomerAdded={(c) => setCustomers((prev) => [c, ...prev])} />
      )}
      {modal?.type === 'edit' && (
        <QuotationModal quotation={modal.quotation} customers={customers} items={items}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }}
          onCustomerAdded={(c) => setCustomers((prev) => [c, ...prev])} />
      )}
      {modal?.type === 'convert' && (
        <ConvertModal quotationId={modal.quotationId} preview={modal.preview} accounts={accounts}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }} />
      )}
```

to:

```jsx
      {modal?.type === 'new' && (
        <QuotationModal customers={customers} items={items} paymentTerms={paymentTerms}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }}
          onCustomerAdded={(c) => setCustomers((prev) => [c, ...prev])} />
      )}
      {modal?.type === 'edit' && (
        <QuotationModal quotation={modal.quotation} customers={customers} items={items} paymentTerms={paymentTerms}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }}
          onCustomerAdded={(c) => setCustomers((prev) => [c, ...prev])} />
      )}
      {modal?.type === 'convert' && (
        <ConvertModal quotationId={modal.quotationId} preview={modal.preview} accounts={accounts} paymentTerms={paymentTerms}
          onClose={() => setModal(null)}
          onDone={() => { setModal(null); load(); }} />
      )}
```

- [ ] **Step 3: `QuotationModal` — seed `paymentTerms`, recompute `validUntil` on term/date change**

Change:

```js
function QuotationModal({ quotation, customers, items, onClose, onSaved, onCustomerAdded }) {
  const isEdit = !!quotation?.id;
  const [form, setForm] = useState(
    quotation
      ? {
          customerId:    String(quotation.customerId),
          quotationDate: quotation.quotationDate?.split('T')[0] || todayStr(),
          validUntil:    quotation.validUntil?.split('T')[0] || plusDays(30),
          description:   quotation.description || '',
          notes:         quotation.notes || '',
          lines: quotation.lines?.length
            ? quotation.lines.map((l) => ({
                itemName: l.itemName || '', itemId: l.itemId ? String(l.itemId) : '',
                description: l.description,
                quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatCode: l.vatCode,
              }))
            : [emptyQtnLine()],
        }
      : {
          customerId: '', quotationDate: todayStr(), validUntil: plusDays(30), description: '', notes: '',
          lines: [emptyQtnLine()],
        }
  );
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
```

to:

```js
function QuotationModal({ quotation, customers, items, paymentTerms, onClose, onSaved, onCustomerAdded }) {
  const isEdit = !!quotation?.id;
  const defaultTerm = paymentTerms.find((t) => t.isDefault);
  const [form, setForm] = useState(
    quotation
      ? {
          customerId:    String(quotation.customerId),
          quotationDate: quotation.quotationDate?.split('T')[0] || todayStr(),
          validUntil:    quotation.validUntil?.split('T')[0] || plusDays(30),
          paymentTerms:  quotation.paymentTerms || '',
          description:   quotation.description || '',
          notes:         quotation.notes || '',
          lines: quotation.lines?.length
            ? quotation.lines.map((l) => ({
                itemName: l.itemName || '', itemId: l.itemId ? String(l.itemId) : '',
                description: l.description,
                quantity: String(l.quantity), unitPrice: String(l.unitPrice), vatCode: l.vatCode,
              }))
            : [emptyQtnLine()],
        }
      : {
          customerId: '', quotationDate: todayStr(), validUntil: plusDays(defaultTerm ? defaultTerm.days : 30),
          paymentTerms: defaultTerm ? defaultTerm.name : '', description: '', notes: '',
          lines: [emptyQtnLine()],
        }
  );
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Valid Until = quotation date + the selected term's days (falls back to 30 if no term is set)
  useEffect(() => {
    if (!form.quotationDate) return;
    const term = paymentTerms.find((t) => t.name === form.paymentTerms);
    const days = term ? term.days : 30;
    const d = new Date(form.quotationDate);
    d.setDate(d.getDate() + days);
    setForm((f) => ({ ...f, validUntil: d.toISOString().split('T')[0] }));
  }, [form.quotationDate, form.paymentTerms]);
```

This file already imports `useState, useEffect, useCallback` from React (confirmed at the top of the file), so no new import is needed.

- [ ] **Step 4: Include `paymentTerms` in the submit payload**

Change:

```js
      const payload = {
        customerId: Number(form.customerId),
        quotationDate: form.quotationDate,
        validUntil: form.validUntil,
        description: form.description,
```

to:

```js
      const payload = {
        customerId: Number(form.customerId),
        quotationDate: form.quotationDate,
        validUntil: form.validUntil,
        paymentTerms: form.paymentTerms,
        description: form.description,
```

- [ ] **Step 5: Add the dropdown to the form UI**

Change:

```jsx
              <div className="form-group">
                <label className="label">Valid Until *</label>
                <input type="date" className="input" required value={form.validUntil} onChange={set('validUntil')} />
              </div>
            </div>
```

to:

```jsx
              <div className="form-group">
                <label className="label">Valid Until *</label>
                <input type="date" className="input" required value={form.validUntil} onChange={set('validUntil')} />
              </div>
              <div className="form-group">
                <label className="label">Payment Terms</label>
                <select className="select" value={form.paymentTerms} onChange={set('paymentTerms')}>
                  <option value="">— none —</option>
                  {paymentTerms.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            </div>
```

- [ ] **Step 6: Show the stored term in the detail modal**

Change:

```jsx
            <div><span className="text-gray-400">Quotation Date</span><div>{formatDate(q.quotationDate)}</div></div>
            <div><span className="text-gray-400">Valid Until</span><div>{formatDate(q.validUntil)}</div></div>
            {q.description && <div className="col-span-2"><span className="text-gray-400">Subject</span><div>{q.description}</div></div>}
```

to:

```jsx
            <div><span className="text-gray-400">Quotation Date</span><div>{formatDate(q.quotationDate)}</div></div>
            <div><span className="text-gray-400">Valid Until</span><div>{formatDate(q.validUntil)}</div></div>
            {q.paymentTerms && <div><span className="text-gray-400">Payment Terms</span><div>{q.paymentTerms}</div></div>}
            {q.description && <div className="col-span-2"><span className="text-gray-400">Subject</span><div>{q.description}</div></div>}
```

- [ ] **Step 7: Show the stored term in the print body**

Change:

```js
      <table style="width:100%;margin-bottom:12px"><tr>
        <td><strong>Customer:</strong> ${full.customer?.name || ''}</td>
        <td class="right"><strong>Date:</strong> ${dateFmt(full.quotationDate)}</td>
      </tr></table>
      ${full.description ? `<p><strong>Subject:</strong> ${full.description}</p>` : ''}
```

to:

```js
      <table style="width:100%;margin-bottom:12px"><tr>
        <td><strong>Customer:</strong> ${full.customer?.name || ''}</td>
        <td class="right"><strong>Date:</strong> ${dateFmt(full.quotationDate)}</td>
      </tr></table>
      ${full.paymentTerms ? `<p><strong>Payment Terms:</strong> ${full.paymentTerms}</p>` : ''}
      ${full.description ? `<p><strong>Subject:</strong> ${full.description}</p>` : ''}
```

- [ ] **Step 8: `ConvertModal` — default the due date and carry the term forward**

Change:

```js
function ConvertModal({ quotationId, preview, accounts, onClose, onDone }) {
  const [assign, setAssign] = useState(() =>
    Object.fromEntries(preview.lines.map((l) => [l.id, l.suggestedAccountId ? String(l.suggestedAccountId) : '']))
  );
  const [dueDate, setDueDate] = useState(plusDays(30));
  const [saving, setSaving]   = useState(false);

  const unassigned = preview.lines.filter((l) => !assign[l.id]).length;

  const submit = async () => {
    if (unassigned) { toast.error('Every line needs a revenue account'); return; }
    setSaving(true);
    try {
      const { data } = await rApi.quotations.convert(quotationId, {
        dueDate,
        accounts: preview.lines.map((l) => ({ lineId: l.id, accountId: Number(assign[l.id]) })),
      });
```

to:

```js
function ConvertModal({ quotationId, preview, accounts, paymentTerms, onClose, onDone }) {
  const [assign, setAssign] = useState(() =>
    Object.fromEntries(preview.lines.map((l) => [l.id, l.suggestedAccountId ? String(l.suggestedAccountId) : '']))
  );
  // Default the due date from the source quotation's own term + date, falling
  // back to +30 days only when the quotation has no term set (or it was since deleted).
  const sourceTerm = paymentTerms.find((t) => t.name === preview.paymentTerms);
  const [dueDate, setDueDate] = useState(() => {
    if (sourceTerm && preview.quotationDate) {
      const d = new Date(preview.quotationDate);
      d.setDate(d.getDate() + sourceTerm.days);
      return d.toISOString().split('T')[0];
    }
    return plusDays(30);
  });
  const [saving, setSaving]   = useState(false);

  const unassigned = preview.lines.filter((l) => !assign[l.id]).length;

  const submit = async () => {
    if (unassigned) { toast.error('Every line needs a revenue account'); return; }
    setSaving(true);
    try {
      const { data } = await rApi.quotations.convert(quotationId, {
        dueDate,
        paymentTerms: preview.paymentTerms,
        accounts: preview.lines.map((l) => ({ lineId: l.id, accountId: Number(assign[l.id]) })),
      });
```

- [ ] **Step 9: Manually verify in the browser**

Receivable → Quotations → New Quotation. Confirm "Net 30" pre-selects and "Valid Until" computes correctly; switching terms recomputes it; detail view and print show the term. Then: create a quotation with "Net 45" set, send it, and convert it to an invoice — confirm the convert dialog's Due Date pre-fills 45 days after the quotation date (not a flat +30), and that the resulting invoice shows "Net 45" as its Payment Terms.

- [ ] **Step 10: Commit**

```bash
git add "app/(dashboard)/receivable/quotations/page.jsx"
git commit -m "$(cat <<'EOF'
feat(quotations): add payment terms selector and carry it into conversion

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 12: Purchase Order form + convert dialog — dropdown, auto-date, carry-forward, display

**Files:**
- Modify: `app/(dashboard)/purchase-orders/page.jsx`

**Interfaces:**
- Consumes: `settings.listPaymentTerms()` (Task 3); `paymentTerms` now accepted/returned by `purchaseOrderController.create/update/convertToBill` (Task 8).
- Produces: a "Payment Terms" dropdown on the PO form driving `expectedDate`; the convert-to-bill dialog defaults its due date and `paymentTerms` from the source PO.

- [ ] **Step 1: Import the settings API and load terms**

Change:

```js
import { purchaseOrders as poApi, payable, accounts as acctApi, poScanner, poForm as poFormApi, inventory as invApi } from '@/lib/api';
```

to:

```js
import { purchaseOrders as poApi, payable, accounts as acctApi, poScanner, poForm as poFormApi, inventory as invApi, settings as settingsApi } from '@/lib/api';
```

Change:

```js
  const [vendors,  setVendors]  = useState([]);
  const [accounts, setAccounts] = useState([]);
```

to:

```js
  const [vendors,  setVendors]  = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [paymentTerms, setPaymentTerms] = useState([]);
```

Change:

```js
  useEffect(() => {
    payable.vendors.list().then((r) => setVendors(r.data.data || r.data)).catch(() => {});
    acctApi.list({ active: true }).then((r) => setAccounts(r.data)).catch(() => {});
    invApi.items.list({ limit: 500 }).then((r) => setItems(r.data.data || r.data || [])).catch(() => setItems([]));
  }, []);
```

to:

```js
  useEffect(() => {
    payable.vendors.list().then((r) => setVendors(r.data.data || r.data)).catch(() => {});
    acctApi.list({ active: true }).then((r) => setAccounts(r.data)).catch(() => {});
    invApi.items.list({ limit: 500 }).then((r) => setItems(r.data.data || r.data || [])).catch(() => setItems([]));
    settingsApi.listPaymentTerms().then((r) => setPaymentTerms(r.data.filter((t) => t.isActive))).catch(() => {});
  }, []);
```

- [ ] **Step 2: Pass `paymentTerms` into `POModal` and `ConvertModal`**

Change:

```jsx
      {newPO && (
        <POModal
          vendors={vendors}
          accounts={accounts}
          items={items}
          initialData={newPOInit}
```

to:

```jsx
      {newPO && (
        <POModal
          vendors={vendors}
          accounts={accounts}
          items={items}
          paymentTerms={paymentTerms}
          initialData={newPOInit}
```

Change:

```jsx
      {editPO && (
        <POModal po={editPO} vendors={vendors} accounts={accounts} items={items}
          onClose={() => setEditPO(null)}
          onSaved={() => { setEditPO(null); load(); }}
          onVendorAdded={(v) => setVendors((p) => [v, ...p])} />
      )}
```

to:

```jsx
      {editPO && (
        <POModal po={editPO} vendors={vendors} accounts={accounts} items={items} paymentTerms={paymentTerms}
          onClose={() => setEditPO(null)}
          onSaved={() => { setEditPO(null); load(); }}
          onVendorAdded={(v) => setVendors((p) => [v, ...p])} />
      )}
```

Then change:

```jsx
      {convertPO && (
        <ConvertModal po={convertPO}
          onClose={() => setConvertPO(null)}
          onSaved={() => { setConvertPO(null); load(); }} />
      )}
```

to:

```jsx
      {convertPO && (
        <ConvertModal po={convertPO} paymentTerms={paymentTerms}
          onClose={() => setConvertPO(null)}
          onSaved={() => { setConvertPO(null); load(); }} />
      )}
```

- [ ] **Step 3: `POModal` — seed `paymentTerms`, recompute `expectedDate` on term change**

Change:

```js
function POModal({ po, vendors, accounts, items, initialData, onClose, onSaved, onVendorAdded }) {
  const [form, setForm] = useState(po ? {
    vendorId:     po.vendorId,
    orderDate:    po.orderDate?.split('T')[0] || new Date().toISOString().split('T')[0],
    expectedDate: po.expectedDate?.split('T')[0] || '',
    notes:        po.notes || '',
    taxAmount:    po.taxAmount || 0,
    lines:        po.lines?.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, accountId: l.accountId || '' })) || [emptyLine()],
  } : initialData ? {
    // Pre-filled from scanned form
    vendorId:     initialData.vendorId || '',
    orderDate:    initialData.orderDate || new Date().toISOString().split('T')[0],
    expectedDate: initialData.expectedDate || '',
    notes:        initialData.notes || '',
    taxAmount:    initialData.taxAmount || 0,
    lines:        initialData.lines?.length > 0
                    ? initialData.lines
                    : [emptyLine(), emptyLine()],
  } : {
    vendorId: '', orderDate: new Date().toISOString().split('T')[0],
    expectedDate: '', notes: '', taxAmount: 0, lines: [emptyLine(), emptyLine()],
  });
  const [saving, setSaving] = useState(false);
```

to:

```js
function POModal({ po, vendors, accounts, items, paymentTerms, initialData, onClose, onSaved, onVendorAdded }) {
  const defaultTerm = paymentTerms.find((t) => t.isDefault);
  const [form, setForm] = useState(po ? {
    vendorId:     po.vendorId,
    orderDate:    po.orderDate?.split('T')[0] || new Date().toISOString().split('T')[0],
    expectedDate: po.expectedDate?.split('T')[0] || '',
    paymentTerms: po.paymentTerms || '',
    notes:        po.notes || '',
    taxAmount:    po.taxAmount || 0,
    lines:        po.lines?.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, accountId: l.accountId || '' })) || [emptyLine()],
  } : initialData ? {
    // Pre-filled from scanned form
    vendorId:     initialData.vendorId || '',
    orderDate:    initialData.orderDate || new Date().toISOString().split('T')[0],
    expectedDate: initialData.expectedDate || '',
    paymentTerms: defaultTerm ? defaultTerm.name : '',
    notes:        initialData.notes || '',
    taxAmount:    initialData.taxAmount || 0,
    lines:        initialData.lines?.length > 0
                    ? initialData.lines
                    : [emptyLine(), emptyLine()],
  } : {
    vendorId: '', orderDate: new Date().toISOString().split('T')[0],
    expectedDate: '', paymentTerms: defaultTerm ? defaultTerm.name : '',
    notes: '', taxAmount: 0, lines: [emptyLine(), emptyLine()],
  });
  const [saving, setSaving] = useState(false);

  // Expected delivery date = order date + the selected term's days.
  // Unlike the other 3 forms, a PO's Expected Date is optional, so this
  // only auto-fills it — it never forces the field to stay populated.
  useEffect(() => {
    if (!form.orderDate || !form.paymentTerms) return;
    const term = paymentTerms.find((t) => t.name === form.paymentTerms);
    if (!term) return;
    const d = new Date(form.orderDate);
    d.setDate(d.getDate() + term.days);
    setForm((f) => ({ ...f, expectedDate: d.toISOString().split('T')[0] }));
  }, [form.orderDate, form.paymentTerms]);
```

This file already imports `useState, useEffect, useCallback, useRef` from React (confirmed at the top of the file), so no new import is needed.

- [ ] **Step 4: Add the dropdown to the form UI**

Change:

```jsx
              <div className="form-group">
                <label className="label">Expected Delivery Date</label>
                <input type="date" className="input" value={form.expectedDate || ''} onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))} />
              </div>
            </div>
```

to:

```jsx
              <div className="form-group">
                <label className="label">Expected Delivery Date</label>
                <input type="date" className="input" value={form.expectedDate || ''} onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="label">Payment Terms</label>
                <select className="select" value={form.paymentTerms || ''} onChange={(e) => setForm((f) => ({ ...f, paymentTerms: e.target.value }))}>
                  <option value="">— none —</option>
                  {paymentTerms.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
                </select>
              </div>
            </div>
```

Note this form's `grid-cols-3` layout (`sm:grid-cols-3`) already holds 3 fields (Vendor, Order Date, Expected Date) — adding a 4th wraps to a second row on `sm` breakpoints, which is consistent with how this grid already behaves at narrower widths; no layout class change needed.

- [ ] **Step 5: Include `paymentTerms` in the submit payload**

This is already covered — `submit`'s `payload = { ...form, lines, vendorId: Number(form.vendorId) }` spreads `form.paymentTerms` through automatically. No change needed; verify by reading the `submit` function after Step 3 to confirm `...form` remains the first spread key.

- [ ] **Step 6: Show the stored term in the view modal**

Change:

```jsx
            {[
              { label: 'Vendor', value: po.vendor?.name },
              { label: 'Order Date', value: formatDate(po.orderDate) },
              { label: 'Expected Date', value: po.expectedDate ? formatDate(po.expectedDate) : '—' },
              { label: 'Created', value: formatDate(po.createdAt) },
            ].map(({ label, value }) => (
```

to:

```jsx
            {[
              { label: 'Vendor', value: po.vendor?.name },
              { label: 'Order Date', value: formatDate(po.orderDate) },
              { label: 'Expected Date', value: po.expectedDate ? formatDate(po.expectedDate) : '—' },
              { label: 'Payment Terms', value: po.paymentTerms || '—' },
              { label: 'Created', value: formatDate(po.createdAt) },
            ].map(({ label, value }) => (
```

- [ ] **Step 7: Show the stored term in the print body**

Change:

```js
        <p style="margin:4px 0 0;"><strong>Order Date:</strong> ${dateFmt(po.orderDate)}</p>
        ${po.expectedDate ? `<p style="margin:2px 0 0;"><strong>Expected:</strong> ${dateFmt(po.expectedDate)}</p>` : ''}
      </div>
    </div>
```

to:

```js
        <p style="margin:4px 0 0;"><strong>Order Date:</strong> ${dateFmt(po.orderDate)}</p>
        ${po.expectedDate ? `<p style="margin:2px 0 0;"><strong>Expected:</strong> ${dateFmt(po.expectedDate)}</p>` : ''}
        ${po.paymentTerms ? `<p style="margin:2px 0 0;"><strong>Payment Terms:</strong> ${po.paymentTerms}</p>` : ''}
      </div>
    </div>
```

- [ ] **Step 8: `ConvertModal` — default the due date and carry the term forward**

Change:

```js
function ConvertModal({ po, onClose, onSaved }) {
  const today = new Date().toISOString().split('T')[0];
  const due30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const [billDate, setBillDate] = useState(today);
  const [dueDate,  setDueDate]  = useState(due30);
  const [saving,   setSaving]   = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await poApi.toBill(po.id, { billDate, dueDate });
```

to:

```js
function ConvertModal({ po, paymentTerms, onClose, onSaved }) {
  const today = new Date().toISOString().split('T')[0];
  // Default the due date from the source PO's own term + order date, falling
  // back to +30 days only when the PO has no term set (or it was since deleted).
  const sourceTerm = paymentTerms.find((t) => t.name === po.paymentTerms);
  const defaultDueDate = (() => {
    if (sourceTerm && po.orderDate) {
      const d = new Date(po.orderDate);
      d.setDate(d.getDate() + sourceTerm.days);
      return d.toISOString().split('T')[0];
    }
    return new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  })();
  const [billDate, setBillDate] = useState(today);
  const [dueDate,  setDueDate]  = useState(defaultDueDate);
  const [saving,   setSaving]   = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await poApi.toBill(po.id, { billDate, dueDate, paymentTerms: po.paymentTerms });
```

- [ ] **Step 9: Manually verify in the browser**

Purchase Orders → New Purchase Order. Confirm "Net 30" pre-selects and "Expected Delivery Date" computes; switching terms recomputes it; clearing the term back to "— none —" leaves Expected Date as whatever it already was (it's optional, so this form's effect should not force-clear it). View and print a saved PO and confirm the Payment Terms line shows. Then: create a PO with "Net 60" set, mark it received, and convert it to a bill — confirm the convert dialog's Due Date pre-fills 60 days after the order date, and the resulting bill shows "Net 60" as its Payment Terms.

- [ ] **Step 10: Commit**

```bash
git add "app/(dashboard)/purchase-orders/page.jsx"
git commit -m "$(cat <<'EOF'
feat(purchase-orders): add payment terms selector and carry it into conversion

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Post-implementation check

After all 12 tasks are done, run the full backend test suite once to confirm nothing regressed:

```bash
npx jest
```

Expected: all suites pass, including the 5 new `*PaymentTerms.test.js` files alongside the pre-existing suites.
