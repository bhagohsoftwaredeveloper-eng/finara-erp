const { createError } = require('../middleware/errorHandler');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const peso = (n) => n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Expense voucher lines carry a debit (`amount`) and, optionally, a credit
// (`creditAmount`). A voucher with no credit lines is the original single-sided
// form: every line is a debit and the credit is the payment account chosen at
// Pay. Once any line carries a credit, the voucher is a full journal and must
// balance.
function normalizeVoucherItems(items, { type } = {}) {
  const rows = (Array.isArray(items) ? items : []).map((it) => ({
    description:  it.description,
    accountId:    it.accountId || null,
    amount:       round2(it.amount),
    creditAmount: round2(it.creditAmount),
    receiptNo:    it.receiptNo || null,
  }));

  if (!rows.some((r) => r.creditAmount > 0)) return rows;

  if (type === 'LIQUIDATION') {
    throw createError('Liquidation vouchers settle against their cash request; credit lines are not supported', 400);
  }
  for (const r of rows) {
    if (r.amount > 0 && r.creditAmount > 0) {
      throw createError(`Line "${r.description}" has both a debit and a credit; use one line for each`, 400);
    }
    if (r.creditAmount > 0 && !r.accountId) {
      throw createError(`Credit line "${r.description}" needs an account`, 400);
    }
  }
  const dr = round2(rows.reduce((s, r) => s + r.amount, 0));
  const cr = round2(rows.reduce((s, r) => s + r.creditAmount, 0));
  if (dr !== cr) {
    throw createError(`Debits (₱${peso(dr)}) and credits (₱${peso(cr)}) must balance`, 400);
  }
  return rows;
}

const totalDebit = (rows) => round2(rows.reduce((s, r) => s + r.amount, 0));

module.exports = { normalizeVoucherItems, totalDebit };
