const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { rangeLabel } = require('../../lib/salesRanges');
const { normalizeDocs, summarizeByPeriod, summarizeComparison } = require('../utils/salesSummary');

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const GROUPS = ['day', 'week', 'month', 'quarter', 'year'];
const DIMENSIONS = ['account', 'customer', 'item'];
const MAX_PERIOD_ROWS = 800;   // e.g. a little over two years of daily rows
const MAX_RANGES = 3;

async function loadDocs(businessId, from, to) {
  const span = { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) };
  const [invoices, cashSales] = await Promise.all([
    prisma.invoice.findMany({
      where: { businessId, status: { not: 'VOID' }, invoiceDate: span },
      include: {
        customer: { select: { name: true } },
        lines: { select: { description: true, amount: true, account: { select: { accountCode: true, accountName: true } } } },
      },
    }),
    prisma.cashSale.findMany({
      where: { businessId, status: { not: 'VOID' }, saleDate: span },
      include: {
        account: { select: { accountCode: true, accountName: true } },
        items: { select: { description: true, amount: true } },
      },
    }),
  ]);
  return normalizeDocs(invoices, cashSales);
}

// "from:to,from:to" (1 to 3 ranges), optionally with "labels=a,b,c" to name them.
function parseRanges(raw, rawLabels) {
  const parts = String(raw || '').split(',').filter(Boolean);
  if (parts.length < 1 || parts.length > MAX_RANGES) {
    throw createError(`ranges must list 1 to ${MAX_RANGES} date ranges as from:to,from:to`, 400);
  }
  const labels = String(rawLabels || '').split(',');
  return parts.map((p, i) => {
    const [from, to] = p.split(':');
    if (!isDate(from) || !isDate(to) || from > to) {
      throw createError('ranges must be valid YYYY-MM-DD dates written as from:to, with from not after to', 400);
    }
    return { from, to, label: (labels[i] && labels[i].trim()) || rangeLabel(from, to) };
  });
}

exports.getSummary = async (req, res, next) => {
  try {
    const { mode } = req.query;

    if (mode === 'period') {
      const { from, to, groupBy } = req.query;
      if (!isDate(from) || !isDate(to) || from > to) {
        throw createError('from and to must be valid YYYY-MM-DD dates, with from not after to', 400);
      }
      if (!GROUPS.includes(groupBy)) throw createError(`groupBy must be one of ${GROUPS.join(', ')}`, 400);
      const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1;
      const rowEstimate = { day: days, week: days / 7, month: days / 28, quarter: days / 90, year: days / 365 }[groupBy];
      if (rowEstimate > MAX_PERIOD_ROWS) throw createError('That range would produce too many rows. Choose a shorter range or a longer period.', 400);

      const docs = await loadDocs(req.businessId, from, to);
      return res.json({ mode, from, to, groupBy, ...summarizeByPeriod(docs, { from, to, groupBy }) });
    }

    if (mode === 'compare') {
      const { dimension } = req.query;
      if (!DIMENSIONS.includes(dimension)) throw createError(`dimension must be one of ${DIMENSIONS.join(', ')}`, 400);
      const ranges = parseRanges(req.query.ranges, req.query.labels);

      const from = ranges.map((r) => r.from).sort()[0];
      const to = ranges.map((r) => r.to).sort().reverse()[0];
      const docs = await loadDocs(req.businessId, from, to);
      return res.json({ mode, dimension, ...summarizeComparison(docs, { dimension, ranges }) });
    }

    throw createError('mode must be "period" or "compare"', 400);
  } catch (err) { next(err); }
};
