const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { parseRanges, parsePeriod } = require('../utils/rangeParams');
const { buildStatement, assignByTag, assignByRange, withChange } = require('../utils/profitLoss');
const { summarizeExpenses, GROUPS } = require('../utils/expensesSummary');

const TAG_DIMENSIONS = ['driver', 'vehicle'];

// POSTED general-ledger lines of the given account types between two dates, with
// their cost tags. `filters` may narrow to one account, driver or vehicle.
async function loadLines(businessId, from, to, accountTypes, filters = {}) {
  const lines = await prisma.journalLine.findMany({
    where: {
      entry: {
        businessId, status: 'POSTED',
        entryDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
      },
      account: { accountType: Array.isArray(accountTypes) ? { in: accountTypes } : accountTypes },
      ...(filters.accountId && { accountId: filters.accountId }),
      ...(filters.driverId && { driverId: filters.driverId }),
      ...(filters.vehicleId && { vehicleId: filters.vehicleId }),
    },
    include: {
      account: { select: { id: true, accountCode: true, accountName: true, accountType: true } },
      entry: { select: { entryDate: true } },
    },
  });
  return lines.map((l) => ({ ...l, entryDate: l.entry.entryDate }));
}

// id -> "CODE · Name" for every driver and vehicle of the business.
async function loadTagLabels(businessId) {
  const [drivers, vehicles] = await Promise.all([
    prisma.driver.findMany({ where: { businessId }, select: { id: true, code: true, name: true } }),
    prisma.vehicle.findMany({ where: { businessId }, select: { id: true, code: true, description: true } }),
  ]);
  return {
    driver: new Map(drivers.map((d) => [d.id, `${d.code} · ${d.name}`])),
    vehicle: new Map(vehicles.map((v) => [v.id, v.description ? `${v.code} · ${v.description}` : v.code])),
  };
}

const intOrNull = (v) => (v === undefined || v === '' ? null : (Number.isInteger(Number(v)) ? Number(v) : null));
const readFilters = (q) => ({ accountId: intOrNull(q.accountId), driverId: intOrNull(q.driverId), vehicleId: intOrNull(q.vehicleId) });

exports.getProfitLoss = async (req, res, next) => {
  try {
    const { mode } = req.query;
    const filters = readFilters(req.query);

    if (mode === 'tag') {
      const dimension = req.query.dimension || 'driver';
      if (!TAG_DIMENSIONS.includes(dimension)) throw createError(`dimension must be one of ${TAG_DIMENSIONS.join(', ')}`, 400);
      const { from, to } = parsePeriod(req.query);

      const [lines, labels] = await Promise.all([
        loadLines(req.businessId, from, to, ['REVENUE', 'EXPENSE'], filters),
        loadTagLabels(req.businessId),
      ]);
      const { columns, lines: assigned } = assignByTag(lines, dimension, labels[dimension]);
      return res.json({ mode, dimension, from, to, ...buildStatement(assigned, columns) });
    }

    if (mode === 'compare') {
      const ranges = parseRanges(req.query.ranges, req.query.labels);
      const from = ranges.map((r) => r.from).sort()[0];
      const to = ranges.map((r) => r.to).sort().reverse()[0];

      const lines = await loadLines(req.businessId, from, to, ['REVENUE', 'EXPENSE'], filters);
      const { columns, lines: assigned } = assignByRange(lines, ranges);
      return res.json({ mode, ranges, ...withChange(buildStatement(assigned, columns)) });
    }

    throw createError('mode must be "tag" or "compare"', 400);
  } catch (err) { next(err); }
};

exports.getExpensesSummary = async (req, res, next) => {
  try {
    const { groupBy } = req.query;
    if (!GROUPS.includes(groupBy)) throw createError(`groupBy must be one of ${GROUPS.join(', ')}`, 400);
    const { from, to } = parsePeriod(req.query);
    const filters = readFilters(req.query);

    const [lines, labels] = await Promise.all([
      loadLines(req.businessId, from, to, 'EXPENSE', filters),
      loadTagLabels(req.businessId),
    ]);
    res.json({ from, to, groupBy, filters, ...summarizeExpenses(lines, { groupBy, labels: labels[groupBy] }) });
  } catch (err) { next(err); }
};
