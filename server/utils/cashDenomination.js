/**
 * Cash denomination count helpers.
 *
 * A count is a list of { denom, qty } lines (e.g. 3 x ₱1000). When the business
 * has `cashDenominationEnabled`, physical cash movements must carry a count
 * whose total equals the transaction amount. Pure helpers plus one settings
 * loader — the GL is never touched here.
 */
const prisma = require('../config/database');

const DEFAULT_DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25];

// Physical-cash funds. 1012 (GCash) is digital, 1020 is the bank.
const PHYSICAL_CASH_ACCOUNTS = ['1010', '1011'];

const toCents = (n) => Math.round(Number(n) * 100);

const isPhysicalCash = (accountCode) => PHYSICAL_CASH_ACCOUNTS.includes(String(accountCode));

// → { enabled, denoms }
async function getConfig(businessId, db = prisma) {
  const rows = await db.systemSetting.findMany({
    where: { businessId, key: { in: ['cashDenominationEnabled', 'cashDenominations'] } },
  });
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let denoms = DEFAULT_DENOMS;
  // Stored as "1000,500,0.25" (Settings UI) or a JSON array (default)
  const parsed = String(map.cashDenominations || '')
    .replace(/[\[\]\s]/g, '').split(',').filter(Boolean).map(Number);
  if (parsed.length && parsed.every((d) => d > 0)) {
    denoms = [...new Set(parsed)].sort((a, b) => b - a);
  }
  return { enabled: map.cashDenominationEnabled === 'true', denoms };
}

// Normalises + validates raw lines. Throws Error(message) on bad input.
// Zero-qty lines are dropped. Returns { lines, total }.
function validateCount(rawLines, denoms) {
  if (!Array.isArray(rawLines)) throw new Error('Denomination count is required');
  const allowed = new Set(denoms.map(toCents));
  const merged = new Map();
  for (const l of rawLines) {
    const denom = Number(l?.denom);
    const qty = Number(l?.qty);
    if (!allowed.has(toCents(denom))) throw new Error(`₱${l?.denom} is not an accepted denomination`);
    if (!Number.isInteger(qty) || qty < 0) throw new Error('Denomination quantities must be whole numbers');
    if (qty === 0) continue;
    merged.set(toCents(denom), (merged.get(toCents(denom)) || 0) + qty);
  }
  const lines = [...merged.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([cents, qty]) => ({ denom: cents / 100, qty }));
  const total = lines.reduce((s, l) => s + toCents(l.denom) * l.qty, 0) / 100;
  return { lines, total };
}

function assertMatches(total, amount) {
  if (toCents(total) !== toCents(amount)) {
    throw new Error(
      `Denomination total ₱${Number(total).toFixed(2)} does not match the amount ₱${Number(amount).toFixed(2)}`,
    );
  }
}

/**
 * Resolve the count for a cash movement, honouring the business toggle.
 * Returns null when no count applies (toggle off, or non-physical fund).
 * Throws an Error with `.status = 400` when a required count is missing/bad.
 */
async function resolveCount({ businessId, accountCode, amount, denominations, strict = true }) {
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  const cfg = await getConfig(businessId);
  if (!cfg.enabled || !isPhysicalCash(accountCode)) return null;
  if (!Array.isArray(denominations) || denominations.length === 0) {
    throw bad('Count the cash by denomination before continuing');
  }
  let res;
  try { res = validateCount(denominations, cfg.denoms); } catch (e) { throw bad(e.message); }
  if (strict) {
    try { assertMatches(res.total, amount); } catch (e) { throw bad(e.message); }
  }
  return res;
}

// Persist a resolved count (from resolveCount). `db` may be a transaction client.
function saveCount(db, { businessId, sourceType, sourceId, direction, accountCode, count, expectedAmount, countedBy }) {
  const expected = expectedAmount == null ? null : Number(expectedAmount);
  return db.cashDenominationCount.create({
    data: {
      businessId, sourceType, sourceId, direction,
      accountCode: accountCode ? String(accountCode) : null,
      lines: count.lines,
      total: count.total,
      expectedAmount: expected,
      variance: expected == null ? null : Number((count.total - expected).toFixed(2)),
      countedBy: countedBy || null,
    },
  });
}

module.exports = {
  saveCount,
  DEFAULT_DENOMS, PHYSICAL_CASH_ACCOUNTS,
  getConfig, validateCount, assertMatches, resolveCount, isPhysicalCash,
};
