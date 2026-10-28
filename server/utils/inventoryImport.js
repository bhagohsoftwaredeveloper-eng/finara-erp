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
