/**
 * Inventory item bulk upload/download rules. Pure functions — no database,
 * no Prisma — so the controller and the tests share one definition of the
 * file layout, the cell parsing and the import plan.
 */
const { kgPerCase } = require('../../lib/packaging');

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

module.exports = {
  FIELDS, COLUMNS, MAX_ROWS, TEMPLATE_ROW,
  labelOf, isBlank, parseWeight, parseCount, packagingFromBody,
  normHeader, findHeaderRow, guessMapping, validateMapping, readRows,
  planImport, toPlanItem, exportRow, nextSkuNumber, formatSku,
};
