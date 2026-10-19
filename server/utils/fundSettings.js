const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');

// Funds configuration, kept per business as JSON in SystemSetting under `fundSettings`.
//   revolving: the GL accounts that make up the revolving (petty cash) fund
//   marketing: the Marketing Fund: percent of monthly net income set aside, the fund's
//              account, the cash account the allocation comes out of, and the expense
//              categories that are paid from the fund.

const KEY = 'fundSettings';

const DEFAULTS = {
  revolving: { accountCodes: ['1011', '1012'] },
  marketing: {
    enabled: false, percent: 10, accountCode: '1013', sourceAccountCode: '1020', categories: ['ADVERTISING'],
  },
};

const CODE = /^\d{3,10}$/;

function mergeSettings(stored) {
  const s = stored && typeof stored === 'object' ? stored : {};
  return {
    revolving: { ...DEFAULTS.revolving, ...(s.revolving || {}) },
    marketing: { ...DEFAULTS.marketing, ...(s.marketing || {}) },
  };
}

const code = (v, label) => {
  const s = String(v ?? '').trim();
  if (!CODE.test(s)) throw createError(`The ${label} must be an account code (3 to 10 digits)`, 400);
  return s;
};

// Validates only the parts that were sent; the result holds just those parts, cleaned.
function sanitize(input) {
  const out = {};
  const r = input && input.revolving;
  if (r && r.accountCodes !== undefined) {
    const codes = (Array.isArray(r.accountCodes) ? r.accountCodes : []).map((c) => String(c ?? '').trim()).filter(Boolean);
    if (codes.length < 1 || codes.length > 6) throw createError('The revolving fund needs 1 to 6 account codes', 400);
    out.revolving = { accountCodes: codes.map((c) => code(c, 'revolving fund account')) };
  }

  const m = input && input.marketing;
  if (m) {
    const o = {};
    if (m.enabled !== undefined) o.enabled = !!m.enabled;
    if (m.percent !== undefined) {
      const p = Number(m.percent);
      if (m.percent === '' || m.percent === null || !Number.isFinite(p) || p < 0 || p > 100) {
        throw createError('The percent must be a number from 0 to 100', 400);
      }
      o.percent = Math.round(p * 100) / 100;
    }
    if (m.accountCode !== undefined) o.accountCode = code(m.accountCode, 'marketing fund account');
    if (m.sourceAccountCode !== undefined) o.sourceAccountCode = code(m.sourceAccountCode, 'source cash account');
    if (m.categories !== undefined) {
      if (!Array.isArray(m.categories)) throw createError('The categories must be a list', 400);
      o.categories = m.categories.map((c) => String(c ?? '').trim()).filter(Boolean).map((c) => {
        if (c.length > 60) throw createError('A category name is too long', 400);
        return c;
      });
    }
    out.marketing = o;
  }
  return out;
}

async function getFundSettings(businessId) {
  const row = await prisma.systemSetting.findUnique({ where: { businessId_key: { businessId, key: KEY } } });
  let stored = null;
  try { stored = row ? JSON.parse(row.value) : null; } catch { stored = null; }
  return mergeSettings(stored);
}

async function saveFundSettings(businessId, input) {
  const clean = sanitize(input);
  const current = await getFundSettings(businessId);
  const next = mergeSettings({
    revolving: { ...current.revolving, ...(clean.revolving || {}) },
    marketing: { ...current.marketing, ...(clean.marketing || {}) },
  });
  if (next.marketing.accountCode === next.marketing.sourceAccountCode) {
    throw createError('The marketing fund account and the source cash account must be different', 400);
  }
  const value = JSON.stringify(next);
  await prisma.systemSetting.upsert({
    where: { businessId_key: { businessId, key: KEY } },
    update: { value },
    create: { businessId, key: KEY, value },
  });
  return next;
}

module.exports = { DEFAULTS, mergeSettings, sanitize, getFundSettings, saveFundSettings };
