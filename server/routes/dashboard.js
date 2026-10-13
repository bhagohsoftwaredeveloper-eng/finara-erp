const router = require('express').Router();
const prisma = require('../config/database');
const { authenticate, resolveBusiness } = require('../middleware/auth');

router.use(authenticate, resolveBusiness);

router.get('/', async (req, res, next) => {
  try {
    const today = new Date();
    let startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    let endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // Optional P&L range (YYYY-MM-DD); defaults to the current month
    const { from, to } = req.query;
    if (from || to) {
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      if (!iso.test(from || '') || !iso.test(to || '') || isNaN(new Date(from)) || isNaN(new Date(to))) {
        return res.status(400).json({ message: 'from and to must be valid YYYY-MM-DD dates' });
      }
      if (from > to) return res.status(400).json({ message: '"From" date must not be after "To" date' });
      startOfMonth = new Date(`${from}T00:00:00.000Z`);
      endOfMonth = new Date(`${to}T23:59:59.999Z`);
    }

    const [
      totalCustomers, totalVendors, totalEmployees,
      openInvoices, openBills, draftEntries,
      monthRevenue, monthExpense,
      overdueReceivables, overduePayables,
    ] = await Promise.all([
      prisma.customer.count({ where: { businessId: req.businessId, isActive: true } }),
      prisma.vendor.count({ where: { businessId: req.businessId, isActive: true } }),
      prisma.employee.count({ where: { businessId: req.businessId, isActive: true } }),
      prisma.invoice.aggregate({ where: { businessId: req.businessId, status: { in: ['OPEN','PARTIAL'] } }, _sum: { totalAmount: true }, _count: true }),
      prisma.bill.aggregate({ where: { businessId: req.businessId, status: { in: ['OPEN','PARTIAL'] } }, _sum: { totalAmount: true }, _count: true }),
      prisma.journalEntry.count({ where: { businessId: req.businessId, status: 'DRAFT' } }),
      prisma.journalLine.aggregate({
        where: { entry: { businessId: req.businessId, status: 'POSTED', entryDate: { gte: startOfMonth, lte: endOfMonth } }, account: { accountType: 'REVENUE' } },
        _sum: { credit: true },
      }),
      prisma.journalLine.aggregate({
        where: { entry: { businessId: req.businessId, status: 'POSTED', entryDate: { gte: startOfMonth, lte: endOfMonth } }, account: { accountType: 'EXPENSE' } },
        _sum: { debit: true },
      }),
      prisma.invoice.aggregate({ where: { businessId: req.businessId, status: { in: ['OPEN','PARTIAL'] }, dueDate: { lt: today } }, _sum: { totalAmount: true } }),
      prisma.bill.aggregate({ where: { businessId: req.businessId, status: { in: ['OPEN','PARTIAL'] }, dueDate: { lt: today } }, _sum: { totalAmount: true } }),
    ]);

    res.json({
      counts: { customers: totalCustomers, vendors: totalVendors, employees: totalEmployees },
      receivables: {
        openCount:  openInvoices._count,
        openAmount: Number(openInvoices._sum.totalAmount || 0),
        overdue:    Number(overdueReceivables._sum.totalAmount || 0),
      },
      payables: {
        openCount:  openBills._count,
        openAmount: Number(openBills._sum.totalAmount || 0),
        overdue:    Number(overduePayables._sum.totalAmount || 0),
      },
      gl: {
        draftEntries,
        monthRevenue: Number(monthRevenue._sum.credit || 0),
        monthExpense: Number(monthExpense._sum.debit  || 0),
        netIncome: Number(monthRevenue._sum.credit || 0) - Number(monthExpense._sum.debit || 0),
      },
    });
  } catch (err) { next(err); }
});

module.exports = router;
