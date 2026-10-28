# Inventory Items: Bulk Upload and Download — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users download all inventory items as a real .xlsx, download an empty template, and upload an .xlsx/.csv product list (including the client's own sheet as-is) that creates new items and updates existing ones after a Check step; add packaging fields (weight per pack, packs per case, pieces per pack) to items.

**Architecture:** The server owns every rule in one pure module, `server/utils/inventoryImport.js` (column definitions, header matching, cell parsing, the import plan). Two endpoints use it: `POST /api/inventory/import` (Check with `dryRun`, then Import, all-or-nothing in one transaction) and `GET /api/inventory/export`. The browser only converts files to/from a grid of cell text with `exceljs` (loaded on demand), through CommonJS helpers in `lib/` that Jest tests directly.

**Tech Stack:** Express + Prisma 5 (MySQL 8), Next.js 14 App Router, exceljs 4.4.0, Jest 30.

**Spec:** `docs/superpowers/specs/2026-10-28-inventory-bulk-import-design.md`

## Global Constraints

- Run Jest **only** with worktree copies excluded: `npx jest <files> --testPathIgnorePatterns "/node_modules/" "\.claude"`. Baseline before this plan: 117 suites / 1034 tests, all passing.
- **Never** start `npm run dev` (the user runs it). **Never** run `npm run build` where the user's dev server is running. `prisma generate`/`migrate` fail with EPERM while the dev server runs — the user must stop it first (Task 1).
- `prisma migrate dev` is interactive and unusable here: write migration SQL by hand with the Write tool (no BOM) and apply with `migrate deploy` (or `db execute` + `migrate resolve`).
- The local DB has pre-existing drift unrelated to this plan: two committed migrations not yet applied (`20261027120000_add_tuition_month_range`, `20261027130000_add_student_suspension`) and an applied migration missing locally (`20260909163534_add_external_payroll_run`, table `external_payroll_runs`). Do not "fix" it; ask the user before applying anything other than this plan's migration.
- New dependency: `exceljs` **4.4.0** only. Browser code loads it with dynamic `import('exceljs')`; never import it statically in a page.
- Limits (exact): at most **2,000** item rows per upload; text lengths Product Code 50, Item Name 150, Category 100, Unit 20, Location 100; weights rounded to 3 decimals; prices to 2; reorder level to 3; `$transaction` timeout 60 s.
- Copy (exact):
  - No header row: `Couldn't find the header row. The file needs column names such as Product Code and Item Name.`
  - .xls file: `Save the file as Excel Workbook (.xlsx) and try again.`
  - Blank code + existing name: `Already on file as <SKU>. Put that code in Product Code to update it.`
  - New code + existing name (warning): `An item named "<name>" already exists as <SKU>; this adds a second one.`
  - Inactive (warning): `This item is inactive; it stays inactive.`
  - Kg / Case mismatch (warning): `Kg / Case <given> doesn't match <w> kg × <p> packs = <expected> kg.`
  - Kg / Case alone (warning): `Kg / Case is calculated from Weight / Pack × Packs / Case and isn't saved on its own.`
  - SKU race: `Items changed while importing. Check the file again.` (HTTP 409)
  - Audit summary: `Imported inventory items: <n> created, <n> updated, <n> categor(y|ies) added`
- Every commit message ends with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only the files the task names (the working tree has unrelated changes — never `git add -A`).

---

### Task 1: Packaging columns (schema + migration) — controller does this with the user

**Files:**
- Modify: `prisma/schema.prisma` (model `InventoryItem`, after `warehouseLocation`)
- Create: `prisma/migrations/20261028120000_add_inventory_packaging/migration.sql`

**Interfaces:**
- Produces: `InventoryItem.weightPerPackKg Decimal(10,3)?`, `InventoryItem.packsPerCase Int?`, `InventoryItem.pcsPerPack Int?` in the DB and the generated Prisma client.

This task needs the user (their dev server, their database). Do it in the controller session, not in a subagent.

- [ ] **Step 1: Ask the user to stop `npm run dev`**, then confirm both ports are free (PowerShell):

```powershell
Get-NetTCPConnection -LocalPort 3000,5000 -State Listen -ErrorAction SilentlyContinue
```
Expected: no output.

- [ ] **Step 2: Add the fields to the schema**

In `prisma/schema.prisma`, model `InventoryItem`, directly after the line `  warehouseLocation   String?                @db.VarChar(100)` add:

```prisma
  weightPerPackKg     Decimal?               @db.Decimal(10, 3)
  packsPerCase        Int?
  pcsPerPack          Int?
```

- [ ] **Step 3: Write the migration with the Write tool (no BOM)**

`prisma/migrations/20261028120000_add_inventory_packaging/migration.sql`:

```sql
-- AlterTable
ALTER TABLE `inventory_items` ADD COLUMN `packsPerCase` INTEGER NULL,
    ADD COLUMN `pcsPerPack` INTEGER NULL,
    ADD COLUMN `weightPerPackKg` DECIMAL(10, 3) NULL;
```

Check the first byte is `-` (45), not a BOM (239):

```bash
node -e "console.log(require('fs').readFileSync('prisma/migrations/20261028120000_add_inventory_packaging/migration.sql')[0])"
```
Expected: `45`

- [ ] **Step 4: Apply it**

Run `npx prisma migrate status`. It will list `20261027120000_add_tuition_month_range` and `20261027130000_add_student_suspension` as not yet applied, besides the new one. Ask the user whether to apply those two as well (they are committed school migrations):

- If **yes**: `npx prisma migrate deploy` — Expected: `All migrations have been successfully applied.`
- If **no**, apply only this one:

```bash
npx prisma db execute --file prisma/migrations/20261028120000_add_inventory_packaging/migration.sql --schema prisma/schema.prisma
npx prisma migrate resolve --applied 20261028120000_add_inventory_packaging
```
Expected: `Script executed successfully.` then `Migration 20261028120000_add_inventory_packaging marked as applied.`

- [ ] **Step 5: Regenerate the client and verify**

```bash
npx prisma generate
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```
Expected: `Generated Prisma Client`. The diff output must not mention `inventory_items` (the `external_payroll_runs` drop — and the school columns if they were not applied — are the pre-existing drift).

- [ ] **Step 6: Tell the user they can restart `npm run dev`, then commit**

```bash
git add prisma/schema.prisma prisma/migrations/20261028120000_add_inventory_packaging/migration.sql
git commit -m "feat(inventory): packaging columns on items (weight per pack, packs per case, pcs per pack)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Packaging on the item API

**Files:**
- Create: `lib/packaging.js`
- Create: `server/utils/inventoryImport.js`
- Modify: `server/controllers/inventoryController.js` (top requires; `createItem` lines 151–186; `updateItem` lines 188–232)
- Test: `tests/packaging.test.js`, `tests/inventoryImport.test.js`, `tests/inventoryItemPackaging.test.js`

**Interfaces:**
- Consumes: the Task 1 columns.
- Produces:
  - `lib/packaging.js` (CommonJS): `kgPerCase(weightPerPackKg, packsPerCase) → number | null`, `packagingLabel({ weightPerPackKg, packsPerCase, pcsPerPack }) → string`.
  - `server/utils/inventoryImport.js`: `FIELDS` (array of `{ key, label, aliases }`), `labelOf(key) → string`, `isBlank(raw) → boolean`, `parseWeight(raw)` / `parseCount(raw)` → `{ value: number|null } | { error: string }`, `packagingFromBody(body, { partial }) → { weightPerPackKg?, packsPerCase?, pcsPerPack? }` (throws `Error(message)`).
  - `POST /api/inventory` and `PUT /api/inventory/:id` accept `weightPerPackKg`, `packsPerCase`, `pcsPerPack`.

- [ ] **Step 1: Write the failing tests**

`tests/packaging.test.js`:

```js
const { kgPerCase, packagingLabel } = require('../lib/packaging');

describe('kgPerCase', () => {
  test('weight per pack times packs per case', () => {
    expect(kgPerCase(1, 10)).toBe(10);
    expect(kgPerCase('0.25', '12')).toBe(3);
    expect(kgPerCase('1.000', 10)).toBe(10); // a Prisma Decimal arrives as a string
  });

  test('null when either part is missing', () => {
    expect(kgPerCase(null, 10)).toBeNull();
    expect(kgPerCase(1, '')).toBeNull();
    expect(kgPerCase(undefined, undefined)).toBeNull();
  });

  test('rounds to grams', () => {
    expect(kgPerCase(0.333, 3)).toBe(0.999);
    expect(kgPerCase(0.1, 3)).toBe(0.3);
  });
});

describe('packagingLabel', () => {
  test('lists only the parts that are set', () => {
    expect(packagingLabel({ weightPerPackKg: '1.000', packsPerCase: 10, pcsPerPack: 11 }))
      .toBe('1 kg/pack · 10 packs/case · 11 pcs/pack');
    expect(packagingLabel({ weightPerPackKg: 1, packsPerCase: 10, pcsPerPack: null }))
      .toBe('1 kg/pack · 10 packs/case');
    expect(packagingLabel({})).toBe('');
  });
});
```

`tests/inventoryImport.test.js` (Task 3 adds more `describe` blocks to this file):

```js
const { parseWeight, parseCount, packagingFromBody } = require('../server/utils/inventoryImport');

describe('parseWeight', () => {
  test.each([
    ['1kg', 1], ['1 kg', 1], ['1.5', 1.5], ['500g', 0.5], ['250 grams', 0.25],
    ['2 KGS', 2], ['1,000 g', 1], ['.5kg', 0.5], ['1 kilo', 1],
  ])('%s is %s kg', (raw, kg) => expect(parseWeight(raw)).toEqual({ value: kg }));

  test.each(['', 'N/A', 'na', '-', 'none', null, undefined])('%p is blank', (raw) =>
    expect(parseWeight(raw)).toEqual({ value: null }));

  test.each(['heavy', '1 lb', '-1kg', '1/2 kg'])('%s is an error', (raw) =>
    expect(parseWeight(raw).error).toBe('is not a weight (use e.g. 1kg or 500g)'));
});

describe('parseCount', () => {
  test.each([
    ['10 packs', 10], ['10', 10], ['11 pcs', 11], ['1 pack', 1], ['12 pieces', 12], ['10.0', 10], ['1,000', 1000],
  ])('%s is %s', (raw, n) => expect(parseCount(raw)).toEqual({ value: n }));

  test.each(['', 'N/A', '-'])('%p is blank', (raw) => expect(parseCount(raw)).toEqual({ value: null }));

  test.each(['2.5', 'ten', '10 boxes', '-3'])('%s is an error', (raw) =>
    expect(parseCount(raw).error).toBe('is not a whole number'));
});

describe('packagingFromBody', () => {
  test('parses form values; an empty field clears it', () => {
    expect(packagingFromBody({ weightPerPackKg: '1.5', packsPerCase: '10', pcsPerPack: '' }))
      .toEqual({ weightPerPackKg: 1.5, packsPerCase: 10, pcsPerPack: null });
  });

  test('create: missing fields become null; partial update: missing fields are left out', () => {
    expect(packagingFromBody({})).toEqual({ weightPerPackKg: null, packsPerCase: null, pcsPerPack: null });
    expect(packagingFromBody({ packsPerCase: 12 }, { partial: true })).toEqual({ packsPerCase: 12 });
  });

  test('rejects negatives and fractional counts', () => {
    expect(() => packagingFromBody({ weightPerPackKg: '-1' })).toThrow('Weight / Pack (kg) cannot be negative');
    expect(() => packagingFromBody({ packsPerCase: '2.5' })).toThrow('Packs / Case is not a whole number');
  });
});
```

`tests/inventoryItemPackaging.test.js`:

```js
jest.mock('../server/config/database', () => ({
  inventoryItem: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/inventoryController');

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

describe('createItem packaging', () => {
  test('stores the parsed packaging fields', async () => {
    prisma.inventoryItem.create.mockResolvedValue({ id: 1 });
    const { res } = await call(ctrl.createItem, {
      businessId: 9,
      body: { sku: 'F-1', name: 'Fries', weightPerPackKg: '1.5', packsPerCase: '10', pcsPerPack: '' },
    });
    expect(res.statusCode).toBe(201);
    expect(prisma.inventoryItem.create.mock.calls[0][0].data)
      .toMatchObject({ businessId: 9, weightPerPackKg: 1.5, packsPerCase: 10, pcsPerPack: null });
  });

  test('rejects a fractional Packs / Case without writing', async () => {
    const { res } = await call(ctrl.createItem, { businessId: 9, body: { name: 'Fries', packsPerCase: '2.5' } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Packs / Case is not a whole number');
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });

  test('rejects a negative weight without writing', async () => {
    const { res } = await call(ctrl.createItem, { businessId: 9, body: { name: 'Fries', weightPerPackKg: '-1' } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Weight / Pack (kg) cannot be negative');
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });
});

describe('updateItem packaging', () => {
  test('touches only the packaging fields that were sent; empty clears', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: 3 });
    prisma.inventoryItem.update.mockResolvedValue({ id: 3 });
    await call(ctrl.updateItem, { businessId: 9, params: { id: '3' }, body: { packsPerCase: '12', pcsPerPack: '' } });
    const data = prisma.inventoryItem.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ packsPerCase: 12, pcsPerPack: null });
    expect(data).not.toHaveProperty('weightPerPackKg');
  });

  test('rejects bad packaging before looking the item up', async () => {
    const { res } = await call(ctrl.updateItem, { businessId: 9, params: { id: '3' }, body: { pcsPerPack: 'lots' } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Pcs / Pack is not a whole number');
    expect(prisma.inventoryItem.findFirst).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/packaging.test.js tests/inventoryImport.test.js tests/inventoryItemPackaging.test.js --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: FAIL — the two utility suites fail with `Cannot find module`; the controller suite runs but its packaging assertions fail (the fields are neither stored nor validated yet).

- [ ] **Step 3: Create `lib/packaging.js`**

```js
// Item packaging maths shared by the Express API and the Next.js UI (CommonJS,
// like lib/arAging.js). Prisma Decimals reach the browser as strings ("1.000"),
// so every input goes through Number().

const num = (v) => {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// Kilograms in one case, or null when either part is missing. Never stored.
function kgPerCase(weightPerPackKg, packsPerCase) {
  const w = num(weightPerPackKg);
  const p = num(packsPerCase);
  if (w == null || p == null) return null;
  return Math.round(w * p * 1000) / 1000;
}

// "1 kg/pack · 10 packs/case · 11 pcs/pack", listing only the parts that are set.
function packagingLabel({ weightPerPackKg, packsPerCase, pcsPerPack } = {}) {
  const parts = [];
  if (num(weightPerPackKg) != null) parts.push(`${num(weightPerPackKg)} kg/pack`);
  if (num(packsPerCase) != null) parts.push(`${num(packsPerCase)} packs/case`);
  if (num(pcsPerPack) != null) parts.push(`${num(pcsPerPack)} pcs/pack`);
  return parts.join(' · ');
}

module.exports = { kgPerCase, packagingLabel };
```

- [ ] **Step 4: Create `server/utils/inventoryImport.js`**

```js
/**
 * Inventory item bulk upload/download rules. Pure functions — no database,
 * no Prisma — so the controller and the tests share one definition of the
 * file layout, the cell parsing and the import plan.
 */

// The file layout for Download, Template and Upload, in column order. Upload
// also accepts the aliases; matching ignores case and anything but letters and
// digits. 'Products' is listed twice on purpose: the first such column is the
// item name, and a second one falls through to Category.
const FIELDS = [
  { key: 'sku',               label: 'Product Code',       aliases: ['SKU', 'SKU / Item Code', 'Item Code', 'Code'] },
  { key: 'name',              label: 'Item Name',          aliases: ['Products', 'Product', 'Product Name', 'Name', 'Item'] },
  { key: 'category',          label: 'Category',           aliases: ['Products', 'Product Category', 'Group'] },
  { key: 'unit',              label: 'Unit',               aliases: ['UOM', 'Unit of Measure'] },
  { key: 'description',       label: 'Description',        aliases: ['Desc'] },
  { key: 'costPrice',         label: 'Cost Price',         aliases: ['Cost', 'Unit Cost'] },
  { key: 'sellingPrice',      label: 'Selling Price',      aliases: ['Price', 'SRP', 'Unit Price'] },
  { key: 'reorderLevel',      label: 'Reorder Level',      aliases: ['Reorder', 'Reorder Point'] },
  { key: 'warehouseLocation', label: 'Location',           aliases: ['Warehouse', 'Warehouse Location'] },
  { key: 'weightPerPackKg',   label: 'Weight / Pack (kg)', aliases: ['Weight / Pack', 'Weight per Pack'] },
  { key: 'packsPerCase',      label: 'Packs / Case',       aliases: ['Packs per Case'] },
  { key: 'kgPerCase',         label: 'Kg / Case',          aliases: ['Kg per Case'] },
  { key: 'pcsPerPack',        label: 'Pcs / Pack',         aliases: ['Pieces per Pack', 'Pcs per Pack'] },
];

const labelOf = (key) => FIELDS.find((f) => f.key === key)?.label || key;

// Cell values that mean "nothing here".
const BLANK_WORDS = new Set(['', 'n/a', 'na', '-', 'none']);
const isBlank = (raw) => BLANK_WORDS.has(String(raw ?? '').trim().toLowerCase());

// Parsers return { value } (null when blank) or { error }. An error reads after
// the column name and the cell: 'Packs / Case "ten" is not a whole number.'
const WEIGHT_RE = /^(\d+\.?\d*|\.\d+)\s*(kg|kgs|kilos?|kilograms?|g|gms?|grams?)?\.?$/i;

function parseWeight(raw) {
  if (isBlank(raw)) return { value: null };
  const m = WEIGHT_RE.exec(String(raw).trim().replace(/,/g, ''));
  if (!m) return { error: 'is not a weight (use e.g. 1kg or 500g)' };
  const n = Number(m[1]);
  const kg = !m[2] || m[2].toLowerCase().startsWith('k') ? n : n / 1000;
  if (kg > 9999999) return { error: 'is too large' };
  return { value: Math.round(kg * 1000) / 1000 };
}

const COUNT_RE = /^(\d+)(?:\.0+)?\s*(packs?|pks?|pcks?|pcs?|pieces?)?\.?$/i;

function parseCount(raw) {
  if (isBlank(raw)) return { value: null };
  const m = COUNT_RE.exec(String(raw).trim().replace(/,/g, ''));
  if (!m) return { error: 'is not a whole number' };
  const n = Number(m[1]);
  if (n > 2147483647) return { error: 'is too large' };
  return { value: n };
}

const PACKAGING_PARSERS = { weightPerPackKg: parseWeight, packsPerCase: parseCount, pcsPerPack: parseCount };

// Packaging from the Add/Edit Item form. Unlike a spreadsheet cell, an empty
// value here clears the field. With partial (an update), fields missing from
// the body are left out. Throws Error(message) on bad input.
function packagingFromBody(body = {}, { partial = false } = {}) {
  const out = {};
  for (const [key, parse] of Object.entries(PACKAGING_PARSERS)) {
    if (body[key] === undefined) {
      if (!partial) out[key] = null;
      continue;
    }
    const raw = body[key] === null ? '' : String(body[key]).trim();
    if (raw.startsWith('-')) throw new Error(`${labelOf(key)} cannot be negative`);
    const r = parse(raw);
    if (r.error) throw new Error(`${labelOf(key)} ${r.error}`);
    out[key] = r.value;
  }
  return out;
}

module.exports = { FIELDS, labelOf, isBlank, parseWeight, parseCount, packagingFromBody };
```

- [ ] **Step 5: Accept packaging in `createItem` and `updateItem`**

In `server/controllers/inventoryController.js`, after `const glPost = require('../utils/glPost');` add:

```js
const { packagingFromBody } = require('../utils/inventoryImport');
```

In `exports.createItem`, replace

```js
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const finalSku = (sku && sku.trim()) ? sku.trim() : await nextSku(req.businessId);
```

with

```js
  if (!name) return res.status(400).json({ error: 'Name is required' });
  let packaging;
  try { packaging = packagingFromBody(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const finalSku = (sku && sku.trim()) ? sku.trim() : await nextSku(req.businessId);
```

and in its `data`, replace

```js
        revenueAccountId:   revenueAccountId   ? Number(revenueAccountId)   : null,
      },
      include: {
        category:         true,
```

(the first occurrence, inside `createItem`) with

```js
        revenueAccountId:   revenueAccountId   ? Number(revenueAccountId)   : null,
        ...packaging,
      },
      include: {
        category:         true,
```

In `exports.updateItem`, replace

```js
  } = req.body;
  try {
    // Tenant guard: the item must belong to the caller's business.
    const owned = await prisma.inventoryItem.findFirst({
      where: { id: Number(id), businessId: req.businessId },
      select: { id: true },
    });
    if (!owned) return res.status(404).json({ error: 'Item not found' });

    const item = await prisma.inventoryItem.update({
```

with

```js
  } = req.body;
  let packaging;
  try { packaging = packagingFromBody(req.body, { partial: true }); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    // Tenant guard: the item must belong to the caller's business.
    const owned = await prisma.inventoryItem.findFirst({
      where: { id: Number(id), businessId: req.businessId },
      select: { id: true },
    });
    if (!owned) return res.status(404).json({ error: 'Item not found' });

    const item = await prisma.inventoryItem.update({
```

and in its `data`, replace

```js
        revenueAccountId:   revenueAccountId   !== undefined ? (revenueAccountId   ? Number(revenueAccountId)   : null) : undefined,
      },
```

with

```js
        revenueAccountId:   revenueAccountId   !== undefined ? (revenueAccountId   ? Number(revenueAccountId)   : null) : undefined,
        ...packaging,
      },
```

(`deleteItem` has the same tenant-guard lines; the `} = req.body;` prefix makes the `updateItem` match unique.)

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx jest tests/packaging.test.js tests/inventoryImport.test.js tests/inventoryItemPackaging.test.js --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: PASS, 3 suites.

- [ ] **Step 7: Commit**

```bash
git add lib/packaging.js server/utils/inventoryImport.js server/controllers/inventoryController.js tests/packaging.test.js tests/inventoryImport.test.js tests/inventoryItemPackaging.test.js
git commit -m "feat(inventory): items accept weight per pack, packs per case and pcs per pack

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Import planning (pure)

**Files:**
- Modify: `server/utils/inventoryImport.js`
- Test: `tests/inventoryImport.test.js` (append)

**Interfaces:**
- Consumes: `FIELDS`, `labelOf`, `isBlank`, `parseWeight`, `parseCount` (Task 2); `kgPerCase` from `lib/packaging.js`.
- Produces (all exported from `server/utils/inventoryImport.js`):
  - `MAX_ROWS = 2000`, `COLUMNS: [{ key, label }]`, `TEMPLATE_ROW` (object with every `COLUMNS` key)
  - `normHeader(s) → string`, `findHeaderRow(grid) → index | -1`, `guessMapping(header) → (key|null)[]`, `validateMapping(mapping, header) → string | null`
  - `readRows(grid, headerIndex, mapping) → [{ row, values, errors }]`
  - `toPlanItem(prismaItem) → planItem`, `exportRow(prismaItem) → { [key]: value }`
  - `nextSkuNumber(skus) → number`, `formatSku(n) → 'SKU-0001'`
  - `planImport(rows, existingPlanItems, categories, firstSkuNumber) → { summary: { create, update, unchanged, errors, warnings }, newCategories: string[], rows: [{ row, action: 'create'|'update'|'unchanged'|'error', sku, name, changes: [{ field, from, to }], errors, warnings }], creates: [itemData with category name], updates: [{ id, data }] }`

- [ ] **Step 1: Write the failing tests**

Append to `tests/inventoryImport.test.js`:

```js
const {
  COLUMNS, TEMPLATE_ROW, normHeader, findHeaderRow, guessMapping, validateMapping, readRows,
  planImport, exportRow, nextSkuNumber,
} = require('../server/utils/inventoryImport');

const CLIENT_SHEET = [
  ['PRODUCT CODE', 'PRODUCTS', 'CATEGORY', 'WEIGHT / PACK', 'PACKS / CASE', 'KG / CASE', 'PCS / PACK'],
  ['1000012713', 'MAESTRO SHOESTRING FRIES', 'FRIES', '1kg', '10 packs', '10 kg', 'N/A'],
  ['J000073-2', 'MAESTRO HUNGARIAN SAUSAGE', 'SAUSAGE, HUNGARIAN', '1kg', '10 packs', '10 kg', '11 pcs'],
];

// The same pipeline the controller runs.
const plan = (grid, existing = [], categories = [], firstSku = 1) => {
  const h = findHeaderRow(grid);
  return planImport(readRows(grid, h, guessMapping(grid[h])), existing, categories, firstSku);
};

const item = (over) => ({
  id: 1, sku: 'SKU-0001', name: 'Item', isActive: true, category: null, unit: 'pcs', description: null,
  costPrice: 0, sellingPrice: 0, reorderLevel: 0, warehouseLocation: null,
  weightPerPackKg: null, packsPerCase: null, pcsPerPack: null, ...over,
});

describe('header matching', () => {
  test('normHeader ignores case, spaces and punctuation', () => {
    expect(normHeader(' WEIGHT / PACK ')).toBe('weightpack');
    expect(normHeader('Weight/Pack (kg)')).toBe('weightpackkg');
  });

  test("the client's sheet maps column by column", () => {
    expect(guessMapping(CLIENT_SHEET[0]))
      .toEqual(['sku', 'name', 'category', 'weightPerPackKg', 'packsPerCase', 'kgPerCase', 'pcsPerPack']);
  });

  test('a second PRODUCTS column falls through to Category', () => {
    expect(guessMapping(['PRODUCT CODE', 'PRODUCTS', 'PRODUCTS'])).toEqual(['sku', 'name', 'category']);
  });

  test('our own download headers map to themselves; unknown headers are ignored', () => {
    expect(guessMapping(COLUMNS.map((c) => c.label))).toEqual(COLUMNS.map((c) => c.key));
    expect(guessMapping(['Item Name', 'Remarks', ''])).toEqual(['name', null, null]);
  });

  test('the header row may sit under a title row', () => {
    expect(findHeaderRow([['PRODUCT LIST 2026'], [], ...CLIENT_SHEET])).toBe(2);
    expect(findHeaderRow([['just', 'some'], ['data', 'here']])).toBe(-1);
  });
});

describe('validateMapping', () => {
  const header = ['A', 'B'];

  test('accepts a mapping with a code or a name', () => {
    expect(validateMapping(['sku', null], header)).toBeNull();
    expect(validateMapping([null, 'name'], header)).toBeNull();
  });

  test('rejects unknown keys, a field used twice, a wrong length, or neither code nor name', () => {
    expect(validateMapping(['bogus', 'name'], header)).toBe('Unknown column "bogus".');
    expect(validateMapping(['name', 'name'], header)).toBe('Item Name is chosen for more than one column.');
    expect(validateMapping(['name'], header)).toBe('The column mapping does not match the file.');
    expect(validateMapping(['unit', null], header)).toBe('Choose a column for Product Code or Item Name.');
  });
});

describe('readRows', () => {
  test('parses values and keeps spreadsheet row numbers', () => {
    expect(readRows(CLIENT_SHEET, 0, guessMapping(CLIENT_SHEET[0]))).toEqual([
      { row: 2, errors: [], values: {
        sku: '1000012713', name: 'MAESTRO SHOESTRING FRIES', category: 'FRIES',
        weightPerPackKg: 1, packsPerCase: 10, kgPerCase: 10, pcsPerPack: null,
      } },
      { row: 3, errors: [], values: {
        sku: 'J000073-2', name: 'MAESTRO HUNGARIAN SAUSAGE', category: 'SAUSAGE, HUNGARIAN',
        weightPerPackKg: 1, packsPerCase: 10, kgPerCase: 10, pcsPerPack: 11,
      } },
    ]);
  });

  test('skips blank rows and reports unreadable cells by column', () => {
    const grid = [
      ['Product Code', 'Item Name', 'Selling Price', 'Packs / Case'],
      ['', '', '', ''],
      ['A1', 'Fries', '₱1,250.00', 'ten'],
      ['A2', 'Nuggets', '-5', ''],
    ];
    const rows = readRows(grid, 0, guessMapping(grid[0]));
    expect(rows.map((r) => r.row)).toEqual([3, 4]);
    expect(rows[0].values.sellingPrice).toBe(1250);
    expect(rows[0].errors).toEqual(['Packs / Case "ten" is not a whole number.']);
    expect(rows[1].errors).toEqual(['Selling Price "-5" cannot be negative.']);
  });

  test('text longer than its column is an error', () => {
    const grid = [['Product Code', 'Unit'], ['A1', 'x'.repeat(21)]];
    expect(readRows(grid, 0, guessMapping(grid[0]))[0].errors[0])
      .toBe(`Unit "${'x'.repeat(21)}" is longer than 20 characters.`);
  });
});

describe('planImport', () => {
  test("the client's two rows become two new items and two new categories", () => {
    const p = plan(CLIENT_SHEET);
    expect(p.summary).toEqual({ create: 2, update: 0, unchanged: 0, errors: 0, warnings: 0 });
    expect(p.newCategories).toEqual(['FRIES', 'SAUSAGE, HUNGARIAN']);
    expect(p.creates[0]).toEqual({
      sku: '1000012713', name: 'MAESTRO SHOESTRING FRIES', category: 'FRIES', unit: 'pcs', description: null,
      costPrice: 0, sellingPrice: 0, reorderLevel: 0, warehouseLocation: null,
      weightPerPackKg: 1, packsPerCase: 10, pcsPerPack: null,
    });
    expect(p.creates[1]).toMatchObject({ sku: 'J000073-2', pcsPerPack: 11 });
  });

  test('an existing code updates only the filled-in cells that differ', () => {
    const existing = [item({
      id: 7, sku: '1000012713', name: 'MAESTRO SHOESTRING FRIES', category: 'FRIES',
      sellingPrice: 280, packsPerCase: 8, weightPerPackKg: 1,
    })];
    const grid = [
      ['Product Code', 'Item Name', 'Selling Price', 'Packs / Case', 'Cost Price'],
      ['1000012713', 'MAESTRO SHOESTRING FRIES', '285', '10', ''],
    ];
    const p = plan(grid, existing, [{ id: 1, name: 'FRIES' }]);
    expect(p.summary).toMatchObject({ create: 0, update: 1 });
    expect(p.updates).toEqual([{ id: 7, data: { sellingPrice: 285, packsPerCase: 10 } }]);
    expect(p.rows[0].changes).toEqual([
      { field: 'Selling Price', from: 280, to: 285 },
      { field: 'Packs / Case', from: 8, to: 10 },
    ]);
  });

  test('re-uploading a download changes nothing', () => {
    const existing = [item({
      id: 7, sku: 'SKU-0001', name: 'Fries', category: 'FRIES', unit: 'pack', costPrice: 200,
      sellingPrice: 285, reorderLevel: 5, weightPerPackKg: 1, packsPerCase: 10, pcsPerPack: 11,
    })];
    const row = exportRow({ ...existing[0], category: { name: 'FRIES' } });
    const grid = [
      COLUMNS.map((c) => c.label),
      COLUMNS.map((c) => (row[c.key] == null ? '' : String(row[c.key]))),
    ];
    expect(plan(grid, existing, [{ id: 1, name: 'FRIES' }]).summary)
      .toEqual({ create: 0, update: 0, unchanged: 1, errors: 0, warnings: 0 });
  });

  test('matching ignores case in codes and category names', () => {
    const existing = [item({ id: 7, sku: 'ab-1', name: 'Fries', category: 'Fries' })];
    const grid = [['Product Code', 'Category'], ['AB-1', 'FRIES']];
    expect(plan(grid, existing, [{ id: 1, name: 'Fries' }]).summary.unchanged).toBe(1);
  });

  test('a Product Code on two rows is an error on both', () => {
    const p = plan([['Product Code', 'Item Name'], ['A1', 'Fries'], ['a1', 'Nuggets']]);
    expect(p.summary.errors).toBe(2);
    expect(p.rows[0].errors).toEqual(['Product Code A1 appears on rows 2, 3.']);
  });

  test('a blank code gets the next SKU, in file order, after the highest existing one', () => {
    const existing = [item({ id: 1, sku: 'SKU-0007', name: 'Old' })];
    const p = plan([['Product Code', 'Item Name'], ['', 'Fries'], ['', 'Nuggets']], existing, [],
      nextSkuNumber(existing.map((i) => i.sku)));
    expect(p.creates.map((c) => c.sku)).toEqual(['SKU-0008', 'SKU-0009']);
    expect(p.rows.map((r) => r.sku)).toEqual(['SKU-0008', 'SKU-0009']);
  });

  test('blank code with a name on file is an error; a new code with that name is a warning', () => {
    const existing = [item({ id: 3, sku: 'SKU-0003', name: 'Fries' })];
    const p = plan([['Product Code', 'Item Name'], ['', ' fries '], ['NEW-1', 'Fries']], existing);
    expect(p.rows[0].errors).toEqual(['Already on file as SKU-0003. Put that code in Product Code to update it.']);
    expect(p.rows[1].action).toBe('create');
    expect(p.rows[1].warnings).toEqual(['An item named "Fries" already exists as SKU-0003; this adds a second one.']);
  });

  test("a blank code repeating an earlier row's name is an error", () => {
    const p = plan([['Product Code', 'Item Name'], ['', 'Fries'], ['', 'FRIES']]);
    expect(p.rows[1].errors).toEqual(['Same Item Name as row 2. Give this row a Product Code or remove it.']);
  });

  test('a new code without a name is an error', () => {
    const p = plan([['Product Code', 'Item Name', 'Selling Price'], ['NEW-1', '', '100']]);
    expect(p.rows[0].errors).toEqual(['Item Name is required for a new item.']);
    expect(p.creates).toEqual([]);
  });

  test('an inactive item is updated but stays inactive, with a warning', () => {
    const existing = [item({ id: 4, sku: 'OLD-1', name: 'Old Fries', isActive: false, sellingPrice: 100 })];
    const p = plan([['Product Code', 'Selling Price'], ['OLD-1', '120']], existing);
    expect(p.updates).toEqual([{ id: 4, data: { sellingPrice: 120 } }]);
    expect(p.rows[0].warnings).toEqual(['This item is inactive; it stays inactive.']);
  });

  test('Kg / Case is checked against weight × packs and never saved', () => {
    const p = plan([
      ['Product Code', 'Item Name', 'Weight / Pack', 'Packs / Case', 'Kg / Case'],
      ['A1', 'Fries', '1kg', '10', '12 kg'],
      ['A2', 'Nuggets', '', '10', '10'],
    ]);
    expect(p.rows[0].warnings).toEqual(["Kg / Case 12 doesn't match 1 kg × 10 packs = 10 kg."]);
    expect(p.rows[1].warnings).toEqual(["Kg / Case is calculated from Weight / Pack × Packs / Case and isn't saved on its own."]);
    expect(p.creates[0]).not.toHaveProperty('kgPerCase');
    expect(p.summary.warnings).toBe(2);
  });

  test('new categories differing only in case are created once, spelled as first seen', () => {
    const p = plan([
      ['Product Code', 'Item Name', 'Category'],
      ['A1', 'Fries', 'Frozen'], ['A2', 'Nuggets', 'FROZEN'], ['A3', 'Ham', 'Deli'],
    ], [], [{ id: 1, name: 'deli' }]);
    expect(p.newCategories).toEqual(['Frozen']);
  });
});

describe('exportRow and TEMPLATE_ROW', () => {
  test('flattens Prisma values and calculates Kg / Case', () => {
    expect(exportRow({
      id: 1, sku: 'S1', name: 'Fries', isActive: true, category: { name: 'FRIES' }, unit: 'pack',
      description: null, costPrice: '200.00', sellingPrice: '285.00', reorderLevel: '5.000',
      warehouseLocation: null, weightPerPackKg: '1.000', packsPerCase: 10, pcsPerPack: null,
    })).toEqual({
      sku: 'S1', name: 'Fries', category: 'FRIES', unit: 'pack', description: null,
      costPrice: 200, sellingPrice: 285, reorderLevel: 5, warehouseLocation: null,
      weightPerPackKg: 1, packsPerCase: 10, kgPerCase: 10, pcsPerPack: null,
    });
  });

  test('the template row fills every column', () => {
    expect(Object.keys(TEMPLATE_ROW).sort()).toEqual(COLUMNS.map((c) => c.key).sort());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/inventoryImport.test.js --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: FAIL — `guessMapping is not a function` (and the other new names undefined); the Task 2 parser tests still pass.

- [ ] **Step 3: Implement**

In `server/utils/inventoryImport.js`, directly below the opening doc comment add:

```js
const { kgPerCase } = require('../../lib/packaging');
```

Insert the following above `module.exports`:

```js
const MAX_ROWS = 2000;

// { key, label } of every column, for the API and the downloaded file.
const COLUMNS = FIELDS.map(({ key, label }) => ({ key, label }));

// ── Columns ──────────────────────────────────────────────────────────────────
const normHeader = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const namesOf = (field) => [field.label, ...field.aliases].map(normHeader);
const KNOWN_HEADERS = new Set(FIELDS.flatMap(namesOf));
const FIELD_KEYS = new Set(FIELDS.map((f) => f.key));

// Index of the header row: the first row with at least two cells that name a
// column, so a title row above it is skipped. -1 when there is none.
function findHeaderRow(grid) {
  return (grid || []).findIndex((row) =>
    (row || []).filter((cell) => KNOWN_HEADERS.has(normHeader(cell))).length >= 2);
}

// One field key (or null) per header cell. Headers are taken left to right and
// each goes to the first field, in FIELDS order, that accepts it and is free.
function guessMapping(header) {
  const used = new Set();
  return header.map((cell) => {
    const h = normHeader(cell);
    if (!h) return null;
    const field = FIELDS.find((f) => !used.has(f.key) && namesOf(f).includes(h));
    if (!field) return null;
    used.add(field.key);
    return field.key;
  });
}

// What is wrong with a mapping the user chose, or null when it is usable.
function validateMapping(mapping, header) {
  if (!Array.isArray(mapping) || mapping.length !== header.length) return 'The column mapping does not match the file.';
  const seen = new Set();
  for (const key of mapping) {
    if (key == null) continue;
    if (!FIELD_KEYS.has(key)) return `Unknown column "${key}".`;
    if (seen.has(key)) return `${labelOf(key)} is chosen for more than one column.`;
    seen.add(key);
  }
  if (!seen.has('sku') && !seen.has('name')) return 'Choose a column for Product Code or Item Name.';
  return null;
}

// ── Cells ────────────────────────────────────────────────────────────────────
const text = (max) => (raw) => {
  if (isBlank(raw)) return { value: null };
  const s = String(raw).trim();
  return s.length > max ? { error: `is longer than ${max} characters` } : { value: s };
};

const amount = (decimals) => (raw) => {
  if (isBlank(raw)) return { value: null };
  const s = String(raw).replace(/₱|php/gi, '').replace(/[\s,]/g, '');
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return { error: 'is not a number' };
  const n = Number(s);
  if (n < 0) return { error: 'cannot be negative' };
  if (n > 999999999) return { error: 'is too large' };
  const f = 10 ** decimals;
  return { value: Math.round(n * f) / f };
};

const PARSERS = {
  sku: text(50),
  name: text(150),
  category: text(100),
  unit: text(20),
  description: text(10000),
  costPrice: amount(2),
  sellingPrice: amount(2),
  reorderLevel: amount(3),
  warehouseLocation: text(100),
  weightPerPackKg: parseWeight,
  packsPerCase: parseCount,
  kgPerCase: parseWeight,
  pcsPerPack: parseCount,
};

// Data rows below the header, skipping rows whose mapped cells are all blank.
// row is the spreadsheet row number (grid[0] is row 1).
function readRows(grid, headerIndex, mapping) {
  const out = [];
  for (let i = headerIndex + 1; i < grid.length; i++) {
    const cells = grid[i] || [];
    const mapped = [];
    mapping.forEach((key, col) => { if (key) mapped.push([key, cells[col]]); });
    if (mapped.every(([, raw]) => isBlank(raw))) continue;

    const values = {};
    const errors = [];
    for (const [key, raw] of mapped) {
      const r = PARSERS[key](raw);
      if (r.error) errors.push(`${labelOf(key)} "${String(raw).trim()}" ${r.error}.`);
      else values[key] = r.value;
    }
    out.push({ row: i + 1, values, errors });
  }
  return out;
}

// ── Plan ─────────────────────────────────────────────────────────────────────
const key = (s) => String(s ?? '').trim().toLowerCase();
const round3 = (n) => Math.round(Number(n) * 1000) / 1000;

// Fields an upload can set, in column order (never sku, never kgPerCase).
const WRITABLE = ['name', 'category', 'unit', 'description', 'costPrice', 'sellingPrice',
  'reorderLevel', 'warehouseLocation', 'weightPerPackKg', 'packsPerCase', 'pcsPerPack'];
const NUMERIC = new Set(['costPrice', 'sellingPrice', 'reorderLevel', 'weightPerPackKg', 'packsPerCase', 'pcsPerPack']);

function sameValue(field, current, next) {
  if (field === 'category') return key(current) === key(next);
  if (NUMERIC.has(field)) return current != null && round3(current) === round3(next);
  return String(current ?? '').trim() === next;
}

const skuNumber = (sku) => {
  const m = /^SKU-(\d+)$/i.exec(String(sku ?? '').trim());
  return m ? parseInt(m[1], 10) : 0;
};
// The number after the highest SKU-nnnn among skus (1 when there is none).
const nextSkuNumber = (skus) => skus.reduce((max, s) => Math.max(max, skuNumber(s)), 0) + 1;
const formatSku = (n) => `SKU-${String(n).padStart(4, '0')}`;

// A Prisma inventoryItem (selected with category: { name }) as plain values.
function toPlanItem(item) {
  const num = (v) => (v == null ? null : Number(v));
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    isActive: item.isActive !== false,
    category: item.category?.name ?? null,
    unit: item.unit ?? null,
    description: item.description ?? null,
    costPrice: num(item.costPrice),
    sellingPrice: num(item.sellingPrice),
    reorderLevel: num(item.reorderLevel),
    warehouseLocation: item.warehouseLocation ?? null,
    weightPerPackKg: num(item.weightPerPackKg),
    packsPerCase: num(item.packsPerCase),
    pcsPerPack: num(item.pcsPerPack),
  };
}

/**
 * What an upload would do, row by row. Writes nothing.
 *   rows:           readRows() output
 *   existing:       toPlanItem() of every item of the business, active or not
 *   categories:     the business's active categories [{ id, name }]
 *   firstSkuNumber: nextSkuNumber() of the existing SKUs
 * rows/summary/newCategories are for the screen; creates/updates for the write.
 */
function planImport(rows, existing, categories, firstSkuNumber) {
  const bySku = new Map(existing.map((it) => [key(it.sku), it]));
  const byName = new Map();
  for (const it of existing) if (!byName.has(key(it.name))) byName.set(key(it.name), it);

  const knownCategories = new Set(categories.map((c) => key(c.name)));
  const newCategories = [];
  const needCategory = (name) => {
    if (!name || knownCategories.has(key(name))) return;
    knownCategories.add(key(name));
    newCategories.push(name);
  };

  const rowsBySku = new Map();
  for (const r of rows) {
    if (r.values.sku) rowsBySku.set(key(r.values.sku), [...(rowsBySku.get(key(r.values.sku)) || []), r.row]);
  }

  let seq = Math.max(firstSkuNumber, nextSkuNumber(rows.map((r) => r.values.sku)));
  const namesInFile = new Map(); // name -> first row that has it
  const out = [];
  const creates = [];
  const updates = [];

  for (const r of rows) {
    const v = r.values;
    const errors = [...r.errors];
    const warnings = [];

    const sameCode = v.sku ? rowsBySku.get(key(v.sku)) : null;
    if (sameCode && sameCode.length > 1) errors.push(`Product Code ${v.sku} appears on rows ${sameCode.join(', ')}.`);

    if (v.kgPerCase != null) {
      if (v.weightPerPackKg != null && v.packsPerCase != null) {
        const expected = kgPerCase(v.weightPerPackKg, v.packsPerCase);
        if (Math.abs(expected - v.kgPerCase) > 0.01) {
          warnings.push(`Kg / Case ${v.kgPerCase} doesn't match ${v.weightPerPackKg} kg × ${v.packsPerCase} packs = ${expected} kg.`);
        }
      } else {
        warnings.push("Kg / Case is calculated from Weight / Pack × Packs / Case and isn't saved on its own.");
      }
    }

    const current = v.sku ? bySku.get(key(v.sku)) : null;
    const entry = {
      row: r.row, action: null,
      sku: current?.sku ?? v.sku ?? null,
      name: v.name ?? current?.name ?? null,
      changes: [], errors, warnings,
    };

    if (current) {
      if (!current.isActive) warnings.push('This item is inactive; it stays inactive.');
      const data = {};
      for (const field of WRITABLE) {
        if (v[field] == null || sameValue(field, current[field], v[field])) continue;
        data[field] = v[field];
        entry.changes.push({ field: labelOf(field), from: current[field] ?? null, to: v[field] });
      }
      if (errors.length) entry.action = 'error';
      else if (entry.changes.length) {
        entry.action = 'update';
        updates.push({ id: current.id, data });
        needCategory(data.category);
      } else entry.action = 'unchanged';
    } else {
      if (!v.name) errors.push('Item Name is required for a new item.');
      const twin = v.name ? byName.get(key(v.name)) : null;
      if (!v.sku && twin) {
        errors.push(`Already on file as ${twin.sku}. Put that code in Product Code to update it.`);
      } else if (!v.sku && v.name && namesInFile.has(key(v.name))) {
        errors.push(`Same Item Name as row ${namesInFile.get(key(v.name))}. Give this row a Product Code or remove it.`);
      }
      if (v.sku && twin) warnings.push(`An item named "${twin.name}" already exists as ${twin.sku}; this adds a second one.`);

      if (errors.length) entry.action = 'error';
      else {
        entry.action = 'create';
        entry.sku = v.sku || formatSku(seq++);
        creates.push({
          sku: entry.sku,
          name: v.name,
          category: v.category ?? null,
          unit: v.unit ?? 'pcs',
          description: v.description ?? null,
          costPrice: v.costPrice ?? 0,
          sellingPrice: v.sellingPrice ?? 0,
          reorderLevel: v.reorderLevel ?? 0,
          warehouseLocation: v.warehouseLocation ?? null,
          weightPerPackKg: v.weightPerPackKg ?? null,
          packsPerCase: v.packsPerCase ?? null,
          pcsPerPack: v.pcsPerPack ?? null,
        });
        needCategory(v.category);
      }
    }

    if (v.name && !namesInFile.has(key(v.name))) namesInFile.set(key(v.name), r.row);
    out.push(entry);
  }

  const count = (action) => out.filter((e) => e.action === action).length;
  return {
    summary: {
      create: count('create'),
      update: count('update'),
      unchanged: count('unchanged'),
      errors: count('error'),
      warnings: out.filter((e) => e.warnings.length > 0).length,
    },
    newCategories,
    rows: out,
    creates,
    updates,
  };
}

// One downloaded row: the item's columns, with Kg / Case calculated.
function exportRow(item) {
  const p = toPlanItem(item);
  return {
    sku: p.sku,
    name: p.name,
    category: p.category,
    unit: p.unit,
    description: p.description,
    costPrice: p.costPrice,
    sellingPrice: p.sellingPrice,
    reorderLevel: p.reorderLevel,
    warehouseLocation: p.warehouseLocation,
    weightPerPackKg: p.weightPerPackKg,
    packsPerCase: p.packsPerCase,
    kgPerCase: kgPerCase(p.weightPerPackKg, p.packsPerCase),
    pcsPerPack: p.pcsPerPack,
  };
}

// The Template's example row.
const TEMPLATE_ROW = {
  sku: 'ITEM-0001',
  name: 'Sample Item (replace or delete this row)',
  category: 'General',
  unit: 'pack',
  description: '',
  costPrice: 100,
  sellingPrice: 150,
  reorderLevel: 10,
  warehouseLocation: 'Main Stockroom',
  weightPerPackKg: 1,
  packsPerCase: 10,
  kgPerCase: 10,
  pcsPerPack: 12,
};
```

Replace the `module.exports` line with:

```js
module.exports = {
  FIELDS, COLUMNS, MAX_ROWS, TEMPLATE_ROW,
  labelOf, isBlank, parseWeight, parseCount, packagingFromBody,
  normHeader, findHeaderRow, guessMapping, validateMapping, readRows,
  planImport, toPlanItem, exportRow, nextSkuNumber, formatSku,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/inventoryImport.test.js tests/packaging.test.js tests/inventoryItemPackaging.test.js --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: PASS, 3 suites.

- [ ] **Step 5: Commit**

```bash
git add server/utils/inventoryImport.js tests/inventoryImport.test.js
git commit -m "feat(inventory): import planning — header matching, cell parsing, change plan

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Import and export endpoints

**Files:**
- Modify: `server/controllers/inventoryController.js` (requires; `nextSku` lines 7–19; add two handlers after `deleteItem`)
- Modify: `server/routes/inventory.js` (Items section)
- Modify: `lib/api.js` (`inventory.items`)
- Test: `tests/inventoryImportController.test.js`

**Interfaces:**
- Consumes: everything Task 3 exports.
- Produces:
  - `POST /api/inventory/import` body `{ grid: string[][], mapping?: (key|null)[], dryRun?: boolean }` →
    - check: `200 { header, mapping, fields: COLUMNS, ignoredHeaders, summary, newCategories, rows }`
    - import with errors: `422 { error, ...same }`; import: `200 { created, updated, unchanged, categoriesCreated }`; SKU race `409`.
  - `GET /api/inventory/export[?template=1]` → `{ columns: COLUMNS, rows }`.
  - Browser helpers `inventory.items.export(params)` and `inventory.items.import(data)`.

- [ ] **Step 1: Write the failing tests**

`tests/inventoryImportController.test.js`:

```js
jest.mock('../server/config/database', () => ({
  inventoryItem: { findMany: jest.fn(), createMany: jest.fn(), updateMany: jest.fn() },
  inventoryCategory: { findMany: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const { recordAudit } = require('../server/utils/audit');
const ctrl = require('../server/controllers/inventoryController');

const CLIENT_SHEET = [
  ['PRODUCT CODE', 'PRODUCTS', 'CATEGORY', 'WEIGHT / PACK', 'PACKS / CASE', 'KG / CASE', 'PCS / PACK'],
  ['1000012713', 'MAESTRO SHOESTRING FRIES', 'FRIES', '1kg', '10 packs', '10 kg', 'N/A'],
  ['J000073-2', 'MAESTRO HUNGARIAN SAUSAGE', 'SAUSAGE, HUNGARIAN', '1kg', '10 packs', '10 kg', '11 pcs'],
];

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
const importReq = (body, businessId = 9) => ({ businessId, body, query: {}, user: { id: 1 } });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.inventoryItem.findMany.mockResolvedValue([]);
  prisma.inventoryCategory.findMany.mockResolvedValue([]);
  prisma.inventoryCategory.create.mockImplementation(async ({ data }) => ({ id: data.name === 'FRIES' ? 101 : 102, ...data }));
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
});

describe('importItems', () => {
  test('check (dry run) returns the plan and writes nothing', async () => {
    const { res } = await call(ctrl.importItems, importReq({ grid: CLIENT_SHEET, dryRun: true }));
    expect(res.statusCode).toBe(200);
    expect(res.body.summary).toEqual({ create: 2, update: 0, unchanged: 0, errors: 0, warnings: 0 });
    expect(res.body.mapping).toEqual(['sku', 'name', 'category', 'weightPerPackKg', 'packsPerCase', 'kgPerCase', 'pcsPerPack']);
    expect(res.body.newCategories).toEqual(['FRIES', 'SAUSAGE, HUNGARIAN']);
    expect(res.body.fields[0]).toEqual({ key: 'sku', label: 'Product Code' });
    expect(res.body).not.toHaveProperty('creates');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('reads only this business', async () => {
    await call(ctrl.importItems, importReq({ grid: CLIENT_SHEET, dryRun: true }, 4));
    expect(prisma.inventoryItem.findMany.mock.calls[0][0].where).toEqual({ businessId: 4 });
    expect(prisma.inventoryCategory.findMany.mock.calls[0][0].where).toEqual({ businessId: 4, isActive: true });
  });

  test('import creates categories and items in one transaction, scoped to the business', async () => {
    const { res } = await call(ctrl.importItems, importReq({ grid: CLIENT_SHEET }));
    expect(res.body).toEqual({ created: 2, updated: 0, unchanged: 0, categoriesCreated: 2 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryCategory.create).toHaveBeenCalledWith({ data: { businessId: 9, name: 'FRIES', type: 'PRODUCT' } });
    const created = prisma.inventoryItem.createMany.mock.calls[0][0].data;
    expect(created[0]).toMatchObject({
      businessId: 9, sku: '1000012713', categoryId: 101, weightPerPackKg: 1, packsPerCase: 10, pcsPerPack: null,
    });
    expect(created[0]).not.toHaveProperty('category');
    expect(created[1]).toMatchObject({ sku: 'J000073-2', categoryId: 102 });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'IMPORT', entity: 'InventoryItem',
      summary: 'Imported inventory items: 2 created, 0 updated, 2 categories added',
    }));
  });

  test('updates go through updateMany with the business in the where clause', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([{
      id: 7, sku: '1000012713', name: 'MAESTRO SHOESTRING FRIES', isActive: true, unit: 'pcs', description: null,
      costPrice: '0', sellingPrice: '0', reorderLevel: '0', warehouseLocation: null,
      weightPerPackKg: null, packsPerCase: null, pcsPerPack: null, category: null,
    }]);
    prisma.inventoryCategory.findMany.mockResolvedValue([{ id: 101, name: 'FRIES' }]);

    await call(ctrl.importItems, importReq({ grid: CLIENT_SHEET.slice(0, 2) }));

    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: 7, businessId: 9 },
      data: { weightPerPackKg: 1, packsPerCase: 10, categoryId: 101 },
    });
    expect(prisma.inventoryItem.createMany).not.toHaveBeenCalled();
    expect(prisma.inventoryCategory.create).not.toHaveBeenCalled();
  });

  test('a file with errors returns 422 and writes nothing', async () => {
    const grid = [['Product Code', 'Item Name', 'Packs / Case'], ['A1', 'Fries', 'ten']];
    const { res } = await call(ctrl.importItems, importReq({ grid }));
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('1 row has errors. Nothing was imported.');
    expect(res.body.rows[0].errors).toEqual(['Packs / Case "ten" is not a whole number.']);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('a file without a header row is rejected', async () => {
    const { res } = await call(ctrl.importItems, importReq({ grid: [['hello', 'world']], dryRun: true }));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Couldn't find the header row. The file needs column names such as Product Code and Item Name.");
  });

  test('a chosen mapping overrides the guess and is validated', async () => {
    const grid = [['PRODUCT CODE', 'PRODUCTS', 'NOTES'], ['A1', 'Fries', 'Crinkle cut']];
    const ok = await call(ctrl.importItems, importReq({ grid, mapping: ['sku', 'name', 'description'], dryRun: true }));
    expect(ok.res.body.mapping).toEqual(['sku', 'name', 'description']);
    expect(ok.res.body.ignoredHeaders).toEqual([]);

    const bad = await call(ctrl.importItems, importReq({ grid, mapping: ['sku', 'name', 'name'], dryRun: true }));
    expect(bad.res.statusCode).toBe(400);
    expect(bad.res.body.error).toBe('Item Name is chosen for more than one column.');
  });

  test('a SKU clash during the write becomes a 409 and is not audited', async () => {
    prisma.inventoryItem.createMany.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    const { res } = await call(ctrl.importItems, importReq({ grid: CLIENT_SHEET }));
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('Items changed while importing. Check the file again.');
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('exportItems', () => {
  test('active items of this business, with Kg / Case calculated', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([{
      id: 1, sku: 'S1', name: 'Fries', isActive: true, unit: 'pack', description: null,
      costPrice: '200.00', sellingPrice: '285.00', reorderLevel: '5.000', warehouseLocation: null,
      weightPerPackKg: '1.000', packsPerCase: 10, pcsPerPack: 11, category: { name: 'FRIES' },
    }]);
    const { res } = await call(ctrl.exportItems, { businessId: 9, query: {} });
    expect(prisma.inventoryItem.findMany.mock.calls[0][0].where).toEqual({ businessId: 9, isActive: true });
    expect(res.body.columns[0]).toEqual({ key: 'sku', label: 'Product Code' });
    expect(res.body.rows[0]).toMatchObject({ sku: 'S1', category: 'FRIES', costPrice: 200, kgPerCase: 10, pcsPerPack: 11 });
  });

  test('template=1 returns one example row without reading items', async () => {
    const { res } = await call(ctrl.exportItems, { businessId: 9, query: { template: '1' } });
    expect(res.body.rows).toHaveLength(1);
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/inventoryImportController.test.js --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: FAIL — `ctrl.importItems is not a function` / `ctrl.exportItems is not a function`.

- [ ] **Step 3: Implement the controller**

In `server/controllers/inventoryController.js`, replace the line added in Task 2

```js
const { packagingFromBody } = require('../utils/inventoryImport');
```

with

```js
const { recordAudit } = require('../utils/audit');
const {
  packagingFromBody, COLUMNS, MAX_ROWS, TEMPLATE_ROW, findHeaderRow, guessMapping, validateMapping,
  readRows, planImport, toPlanItem, exportRow, nextSkuNumber, formatSku,
} = require('../utils/inventoryImport');
```

Replace the whole `nextSku` function (lines 7–19) with:

```js
// Next sequential SKU (SKU-0001, SKU-0002, …) per business
async function nextSku(businessId) {
  const rows = await prisma.inventoryItem.findMany({
    where: { businessId, sku: { startsWith: 'SKU-' } },
    select: { sku: true },
  });
  return formatSku(nextSkuNumber(rows.map((r) => r.sku)));
}
```

Add after the end of `exports.deleteItem` (before `// ── Transactions ──`):

```js
// ── Bulk upload / download ────────────────────────────────────────────────────
// Every rule lives in utils/inventoryImport.js; these handlers only load the
// business's items and categories and write the plan.
const ITEM_COLUMNS = {
  id: true, sku: true, name: true, isActive: true, unit: true, description: true,
  costPrice: true, sellingPrice: true, reorderLevel: true, warehouseLocation: true,
  weightPerPackKg: true, packsPerCase: true, pcsPerPack: true,
  category: { select: { name: true } },
};

exports.importItems = async (req, res, next) => {
  try {
    const { grid, mapping: chosen, dryRun = false } = req.body || {};
    if (!Array.isArray(grid) || grid.length === 0) return res.status(400).json({ error: 'The file is empty.' });

    const headerIndex = findHeaderRow(grid);
    if (headerIndex < 0) {
      return res.status(400).json({ error: "Couldn't find the header row. The file needs column names such as Product Code and Item Name." });
    }
    const header = (grid[headerIndex] || []).map((c) => String(c ?? '').trim());
    const mapping = chosen ?? guessMapping(header);
    const mappingError = validateMapping(mapping, header);
    if (mappingError) return res.status(400).json({ error: mappingError });

    const rows = readRows(grid, headerIndex, mapping);
    if (!rows.length) return res.status(400).json({ error: 'There are no items below the header row.' });
    if (rows.length > MAX_ROWS) return res.status(400).json({ error: `Upload at most ${MAX_ROWS} items at a time.` });

    const [items, categories] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { businessId: req.businessId }, select: ITEM_COLUMNS }),
      prisma.inventoryCategory.findMany({
        where: { businessId: req.businessId, isActive: true },
        select: { id: true, name: true },
      }),
    ]);
    const plan = planImport(rows, items.map(toPlanItem), categories, nextSkuNumber(items.map((i) => i.sku)));
    const result = {
      header,
      mapping,
      fields: COLUMNS,
      ignoredHeaders: header.filter((h, i) => h && !mapping[i]),
      summary: plan.summary,
      newCategories: plan.newCategories,
      rows: plan.rows,
    };

    if (dryRun) return res.json(result);
    if (plan.summary.errors) {
      const n = plan.summary.errors;
      return res.status(422).json({ error: `${n} row${n === 1 ? ' has' : 's have'} errors. Nothing was imported.`, ...result });
    }

    const catIds = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
    await prisma.$transaction(async (tx) => {
      for (const name of plan.newCategories) {
        const cat = await tx.inventoryCategory.create({ data: { businessId: req.businessId, name, type: 'PRODUCT' } });
        catIds.set(name.trim().toLowerCase(), cat.id);
      }
      const categoryId = (name) => (name ? catIds.get(name.trim().toLowerCase()) ?? null : null);
      if (plan.creates.length) {
        await tx.inventoryItem.createMany({
          data: plan.creates.map(({ category, ...fields }) => ({
            ...fields, businessId: req.businessId, categoryId: categoryId(category),
          })),
        });
      }
      for (const { id, data } of plan.updates) {
        const { category, ...fields } = data;
        await tx.inventoryItem.updateMany({
          where: { id, businessId: req.businessId },
          data: { ...fields, ...(category !== undefined && { categoryId: categoryId(category) }) },
        });
      }
    }, { timeout: 60000 });

    const done = {
      created: plan.creates.length,
      updated: plan.updates.length,
      unchanged: plan.summary.unchanged,
      categoriesCreated: plan.newCategories.length,
    };
    await recordAudit({
      req, action: 'IMPORT', entity: 'InventoryItem',
      summary: `Imported inventory items: ${done.created} created, ${done.updated} updated, `
        + `${done.categoriesCreated} categor${done.categoriesCreated === 1 ? 'y' : 'ies'} added`,
    });
    res.json(done);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Items changed while importing. Check the file again.' });
    next(e);
  }
};

exports.exportItems = async (req, res, next) => {
  try {
    if (req.query.template === '1') return res.json({ columns: COLUMNS, rows: [TEMPLATE_ROW] });
    const items = await prisma.inventoryItem.findMany({
      where: { businessId: req.businessId, isActive: true },
      select: ITEM_COLUMNS,
      orderBy: { name: 'asc' },
    });
    res.json({ columns: COLUMNS, rows: items.map(exportRow) });
  } catch (e) { next(e); }
};
```

- [ ] **Step 4: Routes and browser helpers**

In `server/routes/inventory.js`, in the Items section, add directly after the `router.post  ('/',  …  c.createItem);` line (before `router.get   ('/:id', …)`):

```js
router.get   ('/export', c.exportItems);
router.post  ('/import', authorize('ADMIN','MANAGER','ACCOUNTANT'), c.importItems);
```

In `lib/api.js`, inside `inventory.items`, add after the `remove:` line:

```js
    export: (params)   => api.get('/inventory/export', { params }),
    import: (data)     => api.post('/inventory/import', data),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx jest tests/inventoryImportController.test.js tests/inventoryImport.test.js tests/inventoryItemPackaging.test.js --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: PASS, 3 suites.

- [ ] **Step 6: Commit**

```bash
git add server/controllers/inventoryController.js server/routes/inventory.js lib/api.js tests/inventoryImportController.test.js
git commit -m "feat(inventory): import (check + all-or-nothing import) and export endpoints

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Spreadsheet files in the browser

**Files:**
- Modify: `package.json`, `package-lock.json` (add `exceljs`)
- Create: `lib/spreadsheet.js`, `lib/csv.js`, `lib/xlsx.js`
- Modify: `lib/export.js` (export `downloadBlob`)
- Modify: `app/(dashboard)/school/setup/page.jsx` (use `lib/csv.js`)
- Test: `tests/spreadsheet.test.js`, `tests/csv.test.js`

**Interfaces:**
- Produces:
  - `lib/spreadsheet.js` (CommonJS): `cellText(value) → string`, `trimGrid(grid) → string[][]`, `gridFromWorksheet(worksheet) → string[][]` (grid[i] is sheet row i+1), `buildWorkbook(ExcelJS, { sheetName, columns: [{key,label}], rows, textKeys, moneyKeys }) → ExcelJS.Workbook`.
  - `lib/csv.js` (CommonJS): `parseCsv(text) → string[][]` (drops blank lines and a leading BOM).
  - `lib/xlsx.js` (ES module, browser only): `readSheetFile(file: File) → Promise<string[][]>`, `downloadXlsx({ filename, sheetName, columns, rows, textKeys, moneyKeys }) → Promise<void>`.
  - `lib/export.js`: `downloadBlob(content, filename, mime)` becomes a named export.

- [ ] **Step 1: Install exceljs**

Run (from the checkout whose `node_modules` is real, i.e. the main checkout): `npm install exceljs@4.4.0`
Expected: `package.json` gains `"exceljs": "^4.4.0"` under `dependencies`; `npm ls exceljs` prints `exceljs@4.4.0`.

- [ ] **Step 2: Write the failing tests**

`tests/spreadsheet.test.js`:

```js
const ExcelJS = require('exceljs');
const { cellText, trimGrid, gridFromWorksheet, buildWorkbook } = require('../lib/spreadsheet');

const reload = async (workbook) => {
  const copy = new ExcelJS.Workbook();
  await copy.xlsx.load(await workbook.xlsx.writeBuffer());
  return copy;
};

describe('cellText', () => {
  test.each([
    [null, ''],
    [undefined, ''],
    ['FRIES', 'FRIES'],
    [1000012713, '1000012713'],
    [1.5, '1.5'],
    [10, '10'],
    [true, 'TRUE'],
    [new Date(Date.UTC(2026, 9, 28)), '2026-10-28'],
    [{ richText: [{ text: 'SAUSAGE, ' }, { text: 'HUNGARIAN' }] }, 'SAUSAGE, HUNGARIAN'],
    [{ text: 'FRIES', hyperlink: 'https://example.com' }, 'FRIES'],
    [{ text: { richText: [{ text: 'FR' }, { text: 'IES' }] }, hyperlink: 'x' }, 'FRIES'],
    [{ formula: 'D2*E2', result: 10 }, '10'],
    [{ error: '#N/A' }, ''],
  ])('%p → %p', (value, expected) => expect(cellText(value)).toBe(expected));
});

describe('trimGrid', () => {
  test('drops trailing blank cells and rows but keeps leading empty rows', () => {
    expect(trimGrid([[], ['A', 'B', '', ' '], ['1', '', '2'], [''], []]))
      .toEqual([[], ['A', 'B'], ['1', '', '2']]);
  });

  test('fills holes in sparse rows', () => {
    const sparse = [];
    sparse[2] = 'x';
    expect(trimGrid([sparse])).toEqual([['', '', 'x']]);
  });
});

describe('gridFromWorksheet', () => {
  test("reads a real workbook: title row, blank row, hyperlinks, rich text, formulas, numbers", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Items');
    ws.getCell('A1').value = 'PRODUCT LIST 2026';
    ws.getRow(3).values = ['PRODUCT CODE', 'PRODUCTS', 'CATEGORY', 'WEIGHT / PACK'];
    ws.getRow(4).values = [1000012713, 'MAESTRO SHOESTRING FRIES', { text: 'FRIES', hyperlink: 'https://example.com' }, '1kg'];
    ws.getRow(5).values = ['J000073-2', { richText: [{ text: 'MAESTRO ' }, { text: 'HUNGARIAN SAUSAGE' }] }, 'SAUSAGE', { formula: '0.5*2', result: 1 }];

    const loaded = await reload(wb);

    expect(gridFromWorksheet(loaded.worksheets[0])).toEqual([
      ['PRODUCT LIST 2026'],
      [],
      ['PRODUCT CODE', 'PRODUCTS', 'CATEGORY', 'WEIGHT / PACK'],
      ['1000012713', 'MAESTRO SHOESTRING FRIES', 'FRIES', '1kg'],
      ['J000073-2', 'MAESTRO HUNGARIAN SAUSAGE', 'SAUSAGE', '1'],
    ]);
  });
});

describe('buildWorkbook', () => {
  test('bold frozen header, codes as text, money formatted; round-trips through .xlsx', async () => {
    const columns = [
      { key: 'sku', label: 'Product Code' }, { key: 'name', label: 'Item Name' },
      { key: 'price', label: 'Selling Price' }, { key: 'note', label: 'Note' },
    ];
    const wb = buildWorkbook(ExcelJS, {
      sheetName: 'Items', columns, rows: [{ sku: '00123', name: 'Fries', price: 285, note: null }],
      textKeys: ['sku'], moneyKeys: ['price'],
    });

    const ws = (await reload(wb)).getWorksheet('Items');

    expect(gridFromWorksheet(ws)).toEqual([
      ['Product Code', 'Item Name', 'Selling Price', 'Note'],
      ['00123', 'Fries', '285'],
    ]);
    expect(ws.getCell('A2').value).toBe('00123');
    expect(ws.getCell('A2').numFmt).toBe('@');
    expect(ws.getCell('C2').numFmt).toBe('#,##0.00');
    expect(ws.getCell('A1').font.bold).toBe(true);
    expect(ws.getCell('B2').font).toBeUndefined();
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
  });
});
```

`tests/csv.test.js`:

```js
const { parseCsv } = require('../lib/csv');

describe('parseCsv', () => {
  test('quoted commas and escaped quotes stay in one cell', () => {
    expect(parseCsv('name,address\r\n"Dela Cruz, Juan","123 ""A"" St., Tagum"\r\n'))
      .toEqual([['name', 'address'], ['Dela Cruz, Juan', '123 "A" St., Tagum']]);
  });

  test("drops blank lines and Excel's leading byte-order mark", () => {
    expect(parseCsv('﻿a,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx jest tests/spreadsheet.test.js tests/csv.test.js --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: FAIL — `Cannot find module '../lib/spreadsheet'` and `Cannot find module '../lib/csv'`.

- [ ] **Step 4: Create `lib/spreadsheet.js`**

```js
// Spreadsheet logic that needs no browser, shared by the upload/download code in
// lib/xlsx.js and by Jest (CommonJS, like lib/arAging.js). Callers pass the
// ExcelJS module in, so this file never imports exceljs itself.

// One exceljs cell value as plain text. Values may be strings, numbers, Dates,
// rich text, hyperlinks, formulas or error objects.
function cellText(value) {
  if (value == null) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value === 'number') return Number.isInteger(value) ? value.toFixed(0) : String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text ?? '').join('');
    if ('result' in value) return cellText(value.result); // formula
    if ('text' in value) return cellText(value.text);     // hyperlink
    return '';                                            // error values such as #N/A
  }
  return String(value);
}

// Drops trailing blank cells and trailing empty rows. Leading empty rows stay,
// so grid[i] is still spreadsheet row i + 1.
function trimGrid(grid) {
  const rows = grid.map((row) => {
    const cells = Array.from(row || [], (c) => (c == null ? '' : String(c)));
    let end = cells.length;
    while (end > 0 && cells[end - 1].trim() === '') end--;
    return cells.slice(0, end);
  });
  let last = rows.length;
  while (last > 0 && rows[last - 1].length === 0) last--;
  return rows.slice(0, last);
}

// An exceljs worksheet as a grid of cell text; grid[i] is spreadsheet row i + 1.
function gridFromWorksheet(worksheet) {
  const grid = [];
  worksheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
    const cells = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => { cells[col - 1] = cellText(cell.value); });
    grid[rowNumber - 1] = cells;
  });
  return trimGrid(Array.from(grid, (r) => r || []));
}

// A one-sheet workbook with a bold, filled, frozen header row. textKeys are
// stored as text so codes keep leading zeros; moneyKeys get #,##0.00.
function buildWorkbook(ExcelJS, { sheetName = 'Sheet1', columns, rows, textKeys = [], moneyKeys = [] }) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.addRow(columns.map((c) => c.label));
  for (const r of rows) {
    sheet.addRow(columns.map((c) => {
      const v = r[c.key];
      if (v == null || v === '') return null;
      return textKeys.includes(c.key) ? String(v) : v;
    }));
  }
  columns.forEach((c, i) => {
    const column = sheet.getColumn(i + 1);
    if (textKeys.includes(c.key)) column.numFmt = '@';
    if (moneyKeys.includes(c.key)) column.numFmt = '#,##0.00';
    const longest = rows.reduce((m, r) => Math.max(m, String(r[c.key] ?? '').length), c.label.length);
    column.width = Math.min(50, Math.max(10, longest + 2));
  });
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
  });
  return workbook;
}

module.exports = { cellText, trimGrid, gridFromWorksheet, buildWorkbook };
```

- [ ] **Step 5: Move the CSV parser to `lib/csv.js`**

Create `lib/csv.js`:

```js
// Quote-aware CSV parsing shared by the student and inventory imports
// (CommonJS, like lib/arAging.js).

/**
 * Parse CSV text into rows of cells, dropping blank lines and the byte-order
 * mark Excel's "CSV UTF-8" format puts at the start.
 *
 * Handles quoted fields containing commas and escaped quotes, because a
 * Philippine address ("123 Rizal St., Tagum City") breaks a naive split and
 * would silently shift every column after it.
 */
function parseCsv(input) {
  const text = String(input).replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n') {
      row.push(field); rows.push(row); row = []; field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

module.exports = { parseCsv };
```

In `app/(dashboard)/school/setup/page.jsx`:
- add `import { parseCsv } from '@/lib/csv';` directly after `import { formatCurrency, formatDate } from '@/lib/auth';`
- delete the block from the line `/**` that follows `// ── Student roster import ───…` down to and including the closing `}` of `function parseCsv(text) { … }` (the doc comment and the whole function, currently lines 151–181). Keep the `// ── Student roster import ──` comment line.

Check: `grep -n "function parseCsv\|from '@/lib/csv'" "app/(dashboard)/school/setup/page.jsx"` prints only the import line.

- [ ] **Step 6: Export `downloadBlob` and create `lib/xlsx.js`**

In `lib/export.js`, change `function downloadBlob(content, filename, mime) {` to:

```js
export function downloadBlob(content, filename, mime) {
```

Create `lib/xlsx.js`:

```js
// .xlsx and .csv files in the browser. exceljs is large, so it is loaded on
// first use instead of with the page. The workbook logic itself lives in
// lib/spreadsheet.js, where Jest can test it.
import { gridFromWorksheet, buildWorkbook, trimGrid } from './spreadsheet';
import { parseCsv } from './csv';
import { downloadBlob } from './export';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

async function loadExcelJS() {
  const mod = await import('exceljs');
  return mod.default || mod;
}

// An uploaded .xlsx (first sheet) or .csv as a grid of cell text; grid[i] is
// spreadsheet row i + 1. Throws Error(message) for any other file.
export async function readSheetFile(file) {
  const name = String(file?.name || '').toLowerCase();
  if (name.endsWith('.csv')) return trimGrid(parseCsv(await file.text()));
  if (name.endsWith('.xls')) throw new Error('Save the file as Excel Workbook (.xlsx) and try again.');
  if (!name.endsWith('.xlsx')) throw new Error('Choose an Excel (.xlsx) or CSV file.');

  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(await file.arrayBuffer());
  } catch {
    throw new Error("This file couldn't be read as an Excel workbook.");
  }
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('The workbook has no sheets.');
  return gridFromWorksheet(sheet);
}

// Save rows as <filename>.xlsx. Other options as in buildWorkbook().
export async function downloadXlsx({ filename, ...options }) {
  const ExcelJS = await loadExcelJS();
  const buffer = await buildWorkbook(ExcelJS, options).xlsx.writeBuffer();
  downloadBlob(buffer, `${filename}.xlsx`, XLSX_MIME);
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx jest tests/spreadsheet.test.js tests/csv.test.js --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: PASS, 2 suites.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json lib/spreadsheet.js lib/csv.js lib/xlsx.js lib/export.js "app/(dashboard)/school/setup/page.jsx" tests/spreadsheet.test.js tests/csv.test.js
git commit -m "feat: read and write real .xlsx files in the browser (exceljs, loaded on demand)

Moves the quote-aware CSV parser to lib/csv.js so the student and inventory
imports share it; it now also drops the BOM Excel's CSV UTF-8 adds.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Items page — packaging, Download, Upload

**Files:**
- Create: `components/inventory/ImportItemsModal.jsx`
- Modify: `app/(dashboard)/inventory/items/page.jsx`

**Interfaces:**
- Consumes: `inventory.items.export/import` (Task 4), `readSheetFile`, `downloadXlsx` (Task 5), `kgPerCase`, `packagingLabel` (Task 2), `todayPH` from `lib/arAging.js`.
- Produces: `components/inventory/ImportItemsModal.jsx` — default export `ImportItemsModal({ onClose, onImported })`, named export `downloadItemsFile(template = false) → Promise<void>`.

UI only; verified by Task 7.

- [ ] **Step 1: Create `components/inventory/ImportItemsModal.jsx`**

```jsx
'use client';
import { useState } from 'react';
import { inventory as inventoryApi } from '@/lib/api';
import { readSheetFile, downloadXlsx } from '@/lib/xlsx';
import { todayPH } from '@/lib/arAging';
import toast from 'react-hot-toast';
import { X, Download, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

// Bulk upload of inventory items. The browser only reads the file and shows
// what the server says; every rule (columns, parsing, matching) lives in
// server/utils/inventoryImport.js.

const ACTION_BADGE = {
  create:    { label: 'New',       cls: 'badge-blue' },
  update:    { label: 'Update',    cls: 'badge-yellow' },
  unchanged: { label: 'No change', cls: 'badge-gray' },
  error:     { label: 'Error',     cls: 'badge-red' },
};
const MAX_LISTED = 300;

const show = (v) => (v == null || v === '' ? '—' : String(v));
// Errors first, then warnings, updates and new items, each in file order.
const rank = (r) => (r.action === 'error' ? 0 : r.warnings.length ? 1 : r.action === 'update' ? 2 : 3);
const problemText = (err) => (err?.response?.status === 413
  ? 'The file is too large to upload at once. Split it into smaller files.'
  : err?.response?.data?.error || err?.message || 'Something went wrong.');

// Every active item (or the empty template) as an .xlsx download.
export async function downloadItemsFile(template = false) {
  const { data } = await inventoryApi.items.export(template ? { template: 1 } : undefined);
  await downloadXlsx({
    filename: template ? 'inventory-items-template' : `inventory-items-${todayPH()}`,
    sheetName: 'Items',
    columns: data.columns,
    rows: data.rows,
    textKeys: ['sku'],
    moneyKeys: ['costPrice', 'sellingPrice'],
  });
}

export default function ImportItemsModal({ onClose, onImported }) {
  const [fileName, setFileName] = useState('');
  const [grid, setGrid]         = useState(null);
  const [mapping, setMapping]   = useState(null);
  const [check, setCheck]       = useState(null);  // the server's plan for check.mapping
  const [problem, setProblem]   = useState('');
  const [busy, setBusy]         = useState('');    // '' | 'reading' | 'checking' | 'importing' | 'template'

  const runCheck = async (g, m) => {
    setBusy('checking');
    setProblem('');
    if (m) setMapping(m);
    try {
      const { data } = await inventoryApi.items.import({ grid: g, mapping: m, dryRun: true });
      setCheck(data);
      setMapping(data.mapping);
    } catch (err) {
      setProblem(problemText(err));
    } finally { setBusy(''); }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // choosing the same file again re-reads it
    if (!file) return;
    setFileName(file.name);
    setGrid(null); setMapping(null); setCheck(null); setProblem('');
    setBusy('reading');
    let g;
    try {
      g = await readSheetFile(file);
    } catch (err) {
      setProblem(err.message);
      setBusy('');
      return;
    }
    setGrid(g);
    await runCheck(g, null);
  };

  // Choosing a field already used by another column moves it here.
  const remap = (col, key) => {
    const next = mapping.map((k, i) => (i === col ? key || null : key && k === key ? null : k));
    runCheck(grid, next);
  };

  const commit = async () => {
    setBusy('importing');
    setProblem('');
    try {
      const { data } = await inventoryApi.items.import({ grid, mapping, dryRun: false });
      toast.success(`Imported: ${data.created} new, ${data.updated} updated`
        + (data.categoriesCreated ? `, ${data.categoriesCreated} categories added` : ''));
      onImported();
    } catch (err) {
      if (err.response?.status === 422 && err.response.data?.rows) setCheck(err.response.data);
      setProblem(problemText(err));
    } finally { setBusy(''); }
  };

  const template = async () => {
    setBusy('template');
    try { await downloadItemsFile(true); }
    catch (err) { toast.error(problemText(err)); }
    finally { setBusy(''); }
  };

  const s = check?.summary;
  const fresh = !!check && JSON.stringify(check.mapping) === JSON.stringify(mapping);
  const toImport = s ? s.create + s.update : 0;
  const canImport = fresh && !busy && s.errors === 0 && toImport > 0;
  const listed = (check?.rows || [])
    .filter((r) => r.action !== 'unchanged' || r.warnings.length)
    .sort((a, b) => rank(a) - rank(b) || a.row - b.row);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-center items-start overflow-y-auto">
      <div className="bg-white w-full max-w-4xl shadow-2xl flex flex-col" style={{ borderRadius: '0 0 1rem 1rem', maxHeight: '88vh', animation: 'topDrawerIn .28s cubic-bezier(.4,0,.2,1)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <h2 className="font-bold text-gray-900">Upload Items</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm text-gray-600 max-w-xl">
              Choose an Excel (.xlsx) or CSV file with a header row. Rows are matched by Product Code:
              existing items are updated and new codes are added. Blank cells never erase anything,
              and stock quantities are not changed.
            </p>
            <button type="button" onClick={template} disabled={!!busy} className="btn-secondary flex items-center gap-2 whitespace-nowrap">
              <Download className="w-4 h-4" /> Template
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className={`btn-secondary flex items-center gap-2 ${busy ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}>
              <FileSpreadsheet className="w-4 h-4" />
              {fileName || 'Choose file'}
              <input type="file" accept=".xlsx,.csv" className="hidden" onChange={onFile} disabled={!!busy} />
            </label>
            {busy && busy !== 'template' && (
              <span className="text-sm text-gray-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {busy === 'reading' ? 'Reading the file…' : busy === 'checking' ? 'Checking…' : 'Importing…'}
              </span>
            )}
          </div>

          {problem && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {problem}
            </div>
          )}

          {check && (
            <>
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Columns</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {check.header.map((h, i) => (h ? (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="w-40 truncate font-mono text-xs text-gray-600" title={h}>{h}</span>
                      <span className="text-gray-300">→</span>
                      <select className="input py-1 text-sm flex-1" value={mapping?.[i] || ''} disabled={!!busy}
                        onChange={(e) => remap(i, e.target.value)}>
                        <option value="">Ignore</option>
                        {check.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                    </div>
                  ) : null))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-sm">
                <span className="badge badge-blue">{s.create} new</span>
                <span className="badge badge-yellow">{s.update} to update</span>
                <span className="badge badge-gray">{s.unchanged} unchanged</span>
                {s.errors > 0 && <span className="badge badge-red">{s.errors} with errors</span>}
                {s.warnings > 0 && <span className="badge badge-yellow">{s.warnings} with warnings</span>}
              </div>
              {check.newCategories.length > 0 && (
                <p className="text-sm text-gray-600">New categories: {check.newCategories.join(', ')}</p>
              )}

              {listed.length > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase">
                        <th className="px-3 py-2 text-left w-14">Row</th>
                        <th className="px-3 py-2 text-left">Item</th>
                        <th className="px-3 py-2 text-left w-24">Result</th>
                        <th className="px-3 py-2 text-left">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {listed.slice(0, MAX_LISTED).map((r) => (
                        <tr key={r.row} className="align-top">
                          <td className="px-3 py-2 text-gray-500">{r.row}</td>
                          <td className="px-3 py-2">
                            <div className="font-mono text-xs text-gray-500">{show(r.sku)}</div>
                            <div className="font-medium text-gray-900">{show(r.name)}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`badge ${ACTION_BADGE[r.action].cls}`}>{ACTION_BADGE[r.action].label}</span>
                          </td>
                          <td className="px-3 py-2 space-y-0.5">
                            {r.errors.map((m, i) => <div key={`e${i}`} className="text-red-600">{m}</div>)}
                            {r.warnings.map((m, i) => <div key={`w${i}`} className="text-amber-600">{m}</div>)}
                            {r.changes.map((c, i) => (
                              <div key={`c${i}`} className="text-gray-600">{c.field}: {show(c.from)} → {show(c.to)}</div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {listed.length > MAX_LISTED && (
                    <p className="px-3 py-2 text-xs text-gray-500 border-t">
                      Showing the first {MAX_LISTED} of {listed.length} rows.
                    </p>
                  )}
                </div>
              )}
              {check.ignoredHeaders.length > 0 && (
                <p className="text-xs text-gray-400">Ignored columns: {check.ignoredHeaders.join(', ')}</p>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end items-center gap-2 px-6 py-4 border-t flex-shrink-0">
          {check && s.errors > 0 && (
            <span className="text-sm text-red-600 mr-auto">Fix the errors in the file, then choose it again.</span>
          )}
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={commit} disabled={!canImport} className="btn-primary flex items-center gap-2">
            {busy === 'importing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Import {toImport || ''} item{toImport === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Imports and blank form in the Items page**

In `app/(dashboard)/inventory/items/page.jsx`, replace

```js
import { printDocument, phpFmt } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  Package, Plus, Search, RefreshCw, Printer, Edit2,
  Trash2, Tag, ChevronDown, X, Check, AlertTriangle,
  Layers, Warehouse,
} from 'lucide-react';
```

with

```js
import { printDocument, phpFmt } from '@/lib/print';
import { kgPerCase, packagingLabel } from '@/lib/packaging';
import ImportItemsModal, { downloadItemsFile } from '@/components/inventory/ImportItemsModal';
import toast from 'react-hot-toast';
import {
  Package, Plus, Search, RefreshCw, Printer, Edit2,
  Trash2, Tag, ChevronDown, X, Check, AlertTriangle,
  Layers, Warehouse, Box, Download, Upload,
} from 'lucide-react';
```

Replace

```js
  warehouseLocation: '', inventoryAccountId: '', cogsAccountId: '', revenueAccountId: '',
};
```

with

```js
  warehouseLocation: '', inventoryAccountId: '', cogsAccountId: '', revenueAccountId: '',
  weightPerPackKg: '', packsPerCase: '', pcsPerPack: '',
};
```

- [ ] **Step 3: Packaging in the item form**

In `ItemModal`, replace

```js
    revenueAccountId:   item.revenueAccountId || '',
  } : BLANK_ITEM);
```

with

```js
    revenueAccountId:   item.revenueAccountId || '',
    weightPerPackKg:    item.weightPerPackKg != null ? String(Number(item.weightPerPackKg)) : '',
    packsPerCase:       item.packsPerCase ?? '',
    pcsPerPack:         item.pcsPerPack ?? '',
  } : BLANK_ITEM);
```

Replace

```jsx
            {/* COA Linking */}
```

with

```jsx
            {/* Packaging */}
            <div className="col-span-2 text-xs font-bold uppercase tracking-wide text-blue-600 mt-2 mb-1 flex items-center gap-1">
              <Box className="w-3.5 h-3.5" /> Packaging
            </div>
            <div>
              <label className="label">Weight per Pack (kg)</label>
              <input className="input w-full" type="number" min="0" step="0.001" value={form.weightPerPackKg} onChange={set('weightPerPackKg')} placeholder="e.g. 1" />
            </div>
            <div>
              <label className="label">Packs per Case</label>
              <input className="input w-full" type="number" min="0" step="1" value={form.packsPerCase} onChange={set('packsPerCase')} placeholder="e.g. 10" />
            </div>
            <div>
              <label className="label">Pcs per Pack</label>
              <input className="input w-full" type="number" min="0" step="1" value={form.pcsPerPack} onChange={set('pcsPerPack')} placeholder="e.g. 11" />
            </div>
            <div>
              <label className="label">Kg per Case</label>
              <div className="input w-full bg-gray-50 text-gray-600">{kgPerCase(form.weightPerPackKg, form.packsPerCase) ?? '—'}</div>
            </div>

            {/* COA Linking */}
```

- [ ] **Step 4: Packaging line in the list**

Replace

```jsx
                    <div className="font-medium text-gray-900">{item.name}</div>
```

with

```jsx
                    <div className="font-medium text-gray-900">{item.name}</div>
                    {packagingLabel(item) && <div className="text-xs text-gray-400 mt-0.5">{packagingLabel(item)}</div>}
```

- [ ] **Step 5: Download and Upload buttons**

After `const [catPanel,   setCatPanel]   = useState(false);` add:

```js
  const [downloading, setDownloading] = useState(false);
```

After the closing `};` of `handleDelete` add:

```js
  const handleDownload = async () => {
    setDownloading(true);
    try { await downloadItemsFile(); }
    catch (err) { toast.error(err.response?.data?.error || err.message || 'Download failed'); }
    finally { setDownloading(false); }
  };
```

Replace

```jsx
        <div className="flex gap-2">
          <button onClick={() => setCatPanel(true)} className="btn-secondary flex items-center gap-2">
            <Tag className="w-4 h-4" /> Categories
          </button>
          <button onClick={handlePrint} className="btn-secondary flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
```

with

```jsx
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setCatPanel(true)} className="btn-secondary flex items-center gap-2">
            <Tag className="w-4 h-4" /> Categories
          </button>
          <button onClick={handlePrint} className="btn-secondary flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={handleDownload} disabled={downloading} className="btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" /> {downloading ? 'Preparing…' : 'Download'}
          </button>
          <button onClick={() => setModal({ type: 'import' })} className="btn-secondary flex items-center gap-2">
            <Upload className="w-4 h-4" /> Upload
          </button>
```

Replace

```jsx
      {modal?.type === 'cat' && (
        <CategoryModal
          cat={modal.data}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
```

with

```jsx
      {modal?.type === 'cat' && (
        <CategoryModal
          cat={modal.data}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
      {modal?.type === 'import' && (
        <ImportItemsModal
          onClose={() => setModal(null)}
          onImported={() => { setModal(null); load(); }}
        />
      )}
```

- [ ] **Step 6: Self-check and commit**

Run: `grep -n "ImportItemsModal\|downloadItemsFile\|packagingLabel\|kgPerCase" "app/(dashboard)/inventory/items/page.jsx"`
Expected: the import lines plus one use each of `<ImportItemsModal`, `downloadItemsFile()`, `packagingLabel(item)`, `kgPerCase(form.weightPerPackKg, form.packsPerCase)`.

```bash
git add components/inventory/ImportItemsModal.jsx "app/(dashboard)/inventory/items/page.jsx"
git commit -m "feat(inventory): Items page packaging fields, Download and Upload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Verification

**Files:** none changed.

- [ ] **Step 1: Full test suite**

Run: `npx jest --testPathIgnorePatterns "/node_modules/" "\.claude"`
Expected: all suites pass (baseline 117 / 1034 plus this plan's new suites).

- [ ] **Step 2: Compile check**

Only in an isolated worktree where nobody runs `npm run dev` (copy the main checkout's `.env` in first): `npm run build`. Expected: `✓ Compiled successfully`, with `/inventory/items` and `/school/setup` in the route list. If the user's dev server is running from this directory, skip and rely on Step 3.

- [ ] **Step 3: Live check with the user (their dev server, their data)**

Uploads write real items, so ask the user which business to test in (e.g. the Demo business) before importing anything. Then:
1. Items page → **Download**: an `inventory-items-YYYY-MM-DD.xlsx` opens in Excel without a format warning; header bold and frozen; Product Codes left-aligned as text.
2. **Upload** → **Template** downloads `inventory-items-template.xlsx`.
3. Upload a copy of the client's sheet (the two rows from the spec): Columns show PRODUCT CODE → Product Code, PRODUCTS → Item Name, CATEGORY → Category, the four packaging columns mapped; summary "2 new", new categories FRIES and SAUSAGE, HUNGARIAN; **Import 2 items**.
4. Upload the same file again: "2 unchanged", Import disabled.
5. Edit one item: the Packaging section shows the values and Kg per Case = 10; the list shows "1 kg/pack · 10 packs/case".
6. Tell the user production needs the migration applied on deploy (`npm run db:deploy`).
