const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { computeVAT } = require('../utils/phCompliance');
const glPost = require('../utils/glPost');

const genInvNo = async () => {
  const count = await prisma.invoice.count();
  return `INV-${String(count + 1).padStart(6, '0')}`;
};
const genPayNo = async () => {
  const count = await prisma.paymentAR.count();
  return `PAR-${String(count + 1).padStart(6, '0')}`;
};

exports.listCustomers = async (req, res, next) => {
  try {
    const { search, active } = req.query;
    const where = { businessId: req.businessId };
    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.OR = [{ name: { contains: search } }, { customerCode: { contains: search } }];
    res.json(await prisma.customer.findMany({ where, orderBy: { name: 'asc' } }));
  } catch (err) { next(err); }
};

exports.createCustomer = async (req, res, next) => {
  try {
    const { customerCode, name, tin, address, contactName, email, phone } = req.body;
    res.status(201).json(await prisma.customer.create({ data: { businessId: req.businessId, customerCode, name, tin, address, contactName, email, phone } }));
  } catch (err) { next(err); }
};

exports.updateCustomer = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, tin, address, contactName, email, phone, isActive } = req.body;
    res.json(await prisma.customer.update({ where: { id }, data: { name, tin, address, contactName, email, phone, isActive } }));
  } catch (err) { next(err); }
};

exports.listInvoices = async (req, res, next) => {
  try {
    const { status, customerId, from, to, page = 1, limit = 20 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (customerId) where.customerId = Number(customerId);
    if (from || to) where.invoiceDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: { customer: { select: { name: true, customerCode: true } }, lines: true },
        orderBy: { invoiceDate: 'desc' },
        skip: (Number(page)-1)*Number(limit), take: Number(limit),
      }),
      prisma.invoice.count({ where }),
    ]);
    res.json({ data: invoices, total, page: Number(page), pages: Math.ceil(total/Number(limit)) });
  } catch (err) { next(err); }
};

exports.getInvoice = async (req, res, next) => {
  try {
    const inv = await prisma.invoice.findUnique({
      where: { id: Number(req.params.id) },
      include: { customer: true, lines: { include: { account: true } }, payments: true },
    });
    if (!inv) throw createError('Invoice not found', 404);
    res.json(inv);
  } catch (err) { next(err); }
};

exports.createInvoice = async (req, res, next) => {
  try {
    const { customerId, invoiceDate, dueDate, description, lines } = req.body;
    let subtotal = 0, vatAmount = 0;
    const processedLines = lines.map((l) => {
      const amt = Number(l.quantity) * Number(l.unitPrice);
      const v = l.vatCode === 'VAT' ? computeVAT(amt) : { base: amt, vat: 0, total: amt };
      subtotal += v.base; vatAmount += v.vat;
      return { ...l, amount: v.base };
    });

    const invoiceNo = await genInvNo();
    const inv = await prisma.invoice.create({
      data: {
        businessId: req.businessId,
        invoiceNo, customerId: Number(customerId),
        invoiceDate: new Date(invoiceDate), dueDate: new Date(dueDate),
        description, subtotal, vatAmount, totalAmount: subtotal + vatAmount,
        lines: { create: processedLines.map((l) => ({
          accountId: Number(l.accountId), description: l.description,
          quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
        })) },
      },
      include: { customer: true, lines: true },
    });

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    const glLines = [
      // DR Accounts Receivable — Trade
      {
        accountCode: '1100',
        debit:       Number(inv.totalAmount),
        description: `AR — ${inv.customer.name} (${inv.invoiceNo})`,
      },
      // CR each revenue line
      ...inv.lines.map((l) => ({
        accountId:   l.accountId,
        credit:      Number(l.amount),
        description: l.description,
      })),
      // CR Output VAT (if any)
      ...(Number(inv.vatAmount) > 0 ? [{
        accountCode: '2030',
        credit:      Number(inv.vatAmount),
        description: 'Output VAT',
      }] : []),
    ];
    await glPost.safePost({
      entryDate:   inv.invoiceDate,
      description: `AR Invoice — ${inv.customer.name} (${inv.invoiceNo})`,
      reference:   inv.invoiceNo,
      lines:       glLines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    res.status(201).json(inv);
  } catch (err) { next(err); }
};

exports.recordPayment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { paymentDate, amount, paymentMethod, reference, notes } = req.body;
    const inv = await prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw createError('Invoice not found', 404);
    if (inv.status === 'VOID') throw createError('Cannot collect on a voided invoice', 400);

    const paymentNo = await genPayNo();
    const newPaid = Number(inv.paidAmount) + Number(amount);
    const remaining = Number(inv.totalAmount) - newPaid;
    const status = remaining <= 0.01 ? 'PAID' : 'PARTIAL';

    await prisma.$transaction([
      prisma.paymentAR.create({ data: { paymentNo, invoiceId: id, paymentDate: new Date(paymentDate), amount: Number(amount), paymentMethod, reference, notes } }),
      prisma.invoice.update({ where: { id }, data: { paidAmount: newPaid, status } }),
    ]);

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    const customer = await prisma.customer.findUnique({ where: { id: inv.customerId }, select: { name: true } });
    await glPost.safePost({
      entryDate:   paymentDate,
      description: `AR Collection — ${customer?.name} (${inv.invoiceNo})`,
      reference:   paymentNo,
      lines: [
        { accountCode: '1020', debit:  Number(amount), description: `Cash in — ${paymentNo}` },
        { accountCode: '1100', credit: Number(amount), description: `Clear AR — ${customer?.name}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });

    res.json({ message: 'Payment collected', remainingBalance: Math.max(0, remaining) });
  } catch (err) { next(err); }
};

exports.voidInvoice = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const inv = await prisma.invoice.findUnique({ where: { id } });
    if (!inv) throw createError('Invoice not found', 404);
    if (inv.paidAmount > 0) throw createError('Cannot void an invoice with collections. Reverse first.', 400);
    res.json(await prisma.invoice.update({ where: { id }, data: { status: 'VOID' } }));
  } catch (err) { next(err); }
};

exports.agingReport = async (req, res, next) => {
  try {
    const today = new Date();
    const invoices = await prisma.invoice.findMany({
      where: { status: { in: ['OPEN','PARTIAL','OVERDUE'] } },
      include: { customer: { select: { name: true } } },
    });
    const report = invoices.map((inv) => {
      const due = new Date(inv.dueDate);
      const daysOverdue = Math.max(0, Math.floor((today - due) / 86400000));
      const outstanding = Number(inv.totalAmount) - Number(inv.paidAmount);
      return {
        invoiceNo: inv.invoiceNo, customer: inv.customer.name,
        dueDate: inv.dueDate, outstanding, daysOverdue,
        bucket: daysOverdue === 0 ? 'Current'
          : daysOverdue <= 30 ? '1-30 days'
          : daysOverdue <= 60 ? '31-60 days'
          : daysOverdue <= 90 ? '61-90 days'
          : 'Over 90 days',
      };
    });
    const buckets = ['Current','1-30 days','31-60 days','61-90 days','Over 90 days'];
    const summary = Object.fromEntries(buckets.map((b) => [b, report.filter((r) => r.bucket === b).reduce((s, r) => s + r.outstanding, 0)]));
    res.json({ items: report, summary, total: report.reduce((s, r) => s + r.outstanding, 0) });
  } catch (err) { next(err); }
};
