const { createError } = require('../middleware/errorHandler');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const DISCOUNT_TYPES = ['NONE', 'PERCENT', 'AMOUNT'];

// Per-line discount on a sale/invoice line. `gross` is quantity x unit price.
// PERCENT takes value as a percentage (0-100); AMOUNT takes a peso amount that
// may not exceed the line's gross. Returns the normalized type/value and the
// peso discount, so the stored line amount is gross - discount (net sales).
function resolveLineDiscount(gross, type, value, label = 'line') {
  const t = type ? String(type).toUpperCase() : 'NONE';
  if (!DISCOUNT_TYPES.includes(t)) throw createError(`Invalid discount type on ${label}`, 400);
  if (t === 'NONE') return { discountType: null, discountValue: 0, discount: 0 };

  const v = Number(value);
  if (!Number.isFinite(v) || v < 0) throw createError(`Discount on ${label} must be 0 or more`, 400);
  if (v === 0) return { discountType: null, discountValue: 0, discount: 0 };

  const g = round2(gross);
  if (t === 'PERCENT') {
    if (v > 100) throw createError(`Discount on ${label} cannot exceed 100%`, 400);
    return { discountType: 'PERCENT', discountValue: round2(v), discount: round2(g * v / 100) };
  }
  if (round2(v) > g) throw createError(`Discount on ${label} cannot exceed the line amount`, 400);
  return { discountType: 'AMOUNT', discountValue: round2(v), discount: round2(v) };
}

module.exports = { resolveLineDiscount, DISCOUNT_TYPES };
