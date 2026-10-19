const { createError } = require('../middleware/errorHandler');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const VAT_CODES = ['VAT', 'EXEMPT', 'ZERO'];

// Normalizes a package create/update body. Items are { itemId, quantity }; the
// same inventory item may appear only once. Throws a 400 on anything invalid.
function parsePackageInput(body = {}) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) throw createError('Package name is required', 400);
  if (name.length > 150) throw createError('Package name is too long (150 characters max)', 400);

  const price = Number(body.price);
  if (!Number.isFinite(price) || price < 0) throw createError('Package price must be 0 or more', 400);

  const vatCode = body.vatCode || 'VAT';
  if (!VAT_CODES.includes(vatCode)) throw createError('Invalid VAT code', 400);

  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw createError('A package needs at least one item', 400);
  }
  const seen = new Set();
  const items = body.items.map((it) => {
    const itemId = Number(it.itemId);
    const quantity = Number(it.quantity);
    if (!Number.isInteger(itemId) || itemId <= 0) throw createError('Every package line needs an item', 400);
    if (!Number.isFinite(quantity) || quantity <= 0) throw createError('Every package line needs a quantity greater than 0', 400);
    if (seen.has(itemId)) throw createError('The same item cannot appear twice in a package', 400);
    seen.add(itemId);
    return { itemId, quantity: Math.round(quantity * 1000) / 1000 };
  });

  return {
    name,
    description: typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null,
    price: round2(price),
    accountId: body.accountId ? Number(body.accountId) : null,
    vatCode,
    items,
  };
}

// Snapshot of a package's contents for an invoice line: names and quantities
// only (scaled by how many packages were sold), never item prices.
function packageComponents(pkg, lineQuantity = 1) {
  const q = Number(lineQuantity) || 1;
  return pkg.items.map((pi) => ({
    description: pi.item.name,
    sku: pi.item.sku,
    unit: pi.item.unit,
    quantity: Math.round(Number(pi.quantity) * q * 1000) / 1000,
  }));
}

module.exports = { parsePackageInput, packageComponents };
