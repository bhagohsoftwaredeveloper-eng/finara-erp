const prisma = require('../config/database');

// POSTED general-ledger lines of the given account types between two dates (YYYY-MM-DD,
// inclusive), with their cost tags and entry date. `filters` may narrow to one account,
// driver or vehicle. Shared by the Profit & Loss, Expenses Summary and Funds reports.
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

module.exports = { loadLines };
