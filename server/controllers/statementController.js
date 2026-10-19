const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { buildAging, todayPH } = require('../../lib/arAging');
const { buildLedger } = require('../utils/arStatement');

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
const CUSTOMER_FIELDS = { id: true, customerCode: true, name: true, tin: true, address: true, email: true, phone: true };

exports.getStatements = async (req, res, next) => {
  try {
    const businessId = req.businessId;
    const mode = req.query.mode === 'ledger' ? 'ledger' : 'open';

    const all = req.query.customerId === 'all';
    const customerId = Number(req.query.customerId);
    if (!all && !Number.isInteger(customerId)) {
      throw createError('customerId is required (a customer id, or "all")', 400);
    }

    let asOf, from, to, cutoff;
    if (mode === 'open') {
      asOf = req.query.asOf || todayPH();
      if (!isDate(asOf)) throw createError('asOf must be a valid date in YYYY-MM-DD format', 400);
      cutoff = asOf;
    } else {
      ({ from, to } = req.query);
      if (!isDate(from) || !isDate(to) || from > to) {
        throw createError('from and to must be valid YYYY-MM-DD dates, with from not after to', 400);
      }
      cutoff = to;
    }

    let single = null;
    if (!all) {
      single = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: CUSTOMER_FIELDS });
      if (!single) throw createError('Customer not found', 404);
    }

    const invoices = await prisma.invoice.findMany({
      where: {
        businessId,
        status: { not: 'VOID' },
        invoiceDate: { lte: new Date(`${cutoff}T00:00:00Z`) },
        ...(all ? {} : { customerId }),
      },
      include: {
        payments: { select: { paymentNo: true, paymentDate: true, amount: true, paymentMethod: true, reference: true, status: true } },
      },
      orderBy: { invoiceDate: 'asc' },
    });

    const byCustomer = new Map();
    for (const inv of invoices) {
      if (!byCustomer.has(inv.customerId)) byCustomer.set(inv.customerId, []);
      byCustomer.get(inv.customerId).push(inv);
    }

    const customers = all
      ? await prisma.customer.findMany({
          where: { businessId, id: { in: [...byCustomer.keys()] } },
          select: CUSTOMER_FIELDS,
          orderBy: { name: 'asc' },
        })
      : [single];

    const statements = [];
    for (const customer of customers) {
      const invs = byCustomer.get(customer.id) || [];
      const result = mode === 'open'
        ? buildAging(invs, { asOf, basis: 'due', customerNames: { [customer.id]: customer.name } })
        : buildLedger(invs, { from, to });
      const hasContent = mode === 'open'
        ? result.items.length > 0
        : result.rows.length > 0 || Math.abs(result.openingBalance) > 0.005;
      if (all && !hasContent) continue;
      statements.push({ customer, ...result });
    }

    res.json({ mode, ...(mode === 'open' ? { asOf } : { from, to }), statements });
  } catch (err) { next(err); }
};
