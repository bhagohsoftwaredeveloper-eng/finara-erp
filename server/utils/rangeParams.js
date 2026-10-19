const { createError } = require('../middleware/errorHandler');
const { rangeLabel } = require('../../lib/salesRanges');

// Query-string helpers shared by the report controllers (Sales Summary, Profit & Loss).

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const MAX_RANGES = 3;

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

// from/to pair for single-period reports.
function parsePeriod(query) {
  const { from, to } = query;
  if (!isDate(from) || !isDate(to) || from > to) {
    throw createError('from and to must be valid YYYY-MM-DD dates, with from not after to', 400);
  }
  return { from, to };
}

module.exports = { isDate, parseRanges, parsePeriod, MAX_RANGES };
