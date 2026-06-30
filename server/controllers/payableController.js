const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { computeVAT } = require('../utils/phCompliance');
const glPost = require('../utils/glPost');

const genBillNo = async () => {
  const count = await prisma.bill.count();
  return `BILL-${String(count + 1).padStart(6, '0')}`;
};
const genPayNo = async () => {
  const count = await prisma.paymentAP.count();
  return `PAP-${String(count + 1).padStart(6, '0')}`;
};

exports.listVendors = async (req, res, next) => {
  try {
    const { search, active } = req.query;
    const where = { businessId: req.businessId };
    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.OR = [{ name: { contains: search } }, { vendorCode: { contains: search } }];
    res.json(await prisma.vendor.findMany({ where, orderBy: { name: 'asc' } }));
  } catch (err) { next(err); }
};

exports.createVendor = async (req, res, next) => {
  try {
    const { vendorCode, name, tin, address, contactName, email, phone } = req.body;
    const vendor = await prisma.vendor.create({ data: { businessId: req.businessId, vendorCode, name, tin, address, contactName, email, phone } });
    res.status(201).json(vendor);
  } catch (err) { next(err); }
};

exports.updateVendor = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, tin, address, contactName, email, phone, isActive } = req.body;
    res.json(await prisma.vendor.update({ where: { id }, data: { name, tin, address, contactName, email, phone, isActive } }));
  } catch (err) { next(err); }
};

exports.listBills = async (req, res, next) => {
  try {
    const { status, vendorId, from, to, page = 1, limit = 20 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (vendorId) where.vendorId = Number(vendorId);
    if (from || to) where.billDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };

    const [bills, total] = await Promise.all([
      prisma.bill.findMany({
        where,
        include: { vendor: { select: { name: true, vendorCode: true } }, lines: true },
        orderBy: { billDate: 'desc' },
        skip: (Number(page)-1)*Number(limit), take: Number(limit),
      }),
      prisma.bill.count({ where }),
    ]);
    res.json({ data: bills, total, page: Number(page), pages: Math.ceil(total/Number(limit)) });
  } catch (err) { next(err); }
};

exports.getBill = async (req, res, next) => {
  try {
    const bill = await prisma.bill.findUnique({
      where: { id: Number(req.params.id) },
      include: {
        vendor: true,
        lines: { include: { account: { select: { accountCode: true, accountName: true } } } },
        payments: true,
      },
    });
    if (!bill) throw createError('Bill not found', 404);
    res.json(bill);
  } catch (err) { next(err); }
};

exports.createBill = async (req, res, next) => {
  try {
    const { vendorId, billDate, dueDate, description, lines } = req.body;

    let subtotal = 0, vatAmount = 0;
    const processedLines = lines.map((l) => {
      const amt = Number(l.quantity) * Number(l.unitPrice);
      const v = l.vatCode === 'VAT' ? computeVAT(amt) : { base: amt, vat: 0, total: amt };
      subtotal  += v.base;
      vatAmount += v.vat;
      return { ...l, amount: v.base };
    });

    const billNo = await genBillNo();
    const bill = await prisma.bill.create({
      data: {
        businessId: req.businessId,
        billNo, vendorId: Number(vendorId),
        billDate: new Date(billDate), dueDate: new Date(dueDate),
        description, subtotal, vatAmount, totalAmount: subtotal + vatAmount,
        lines: { create: processedLines.map((l) => ({
          accountId: Number(l.accountId), description: l.description,
          quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
        })) },
      },
      include: { vendor: true, lines: true },
    });

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    const glLines = [
      // DR each expense / cost line
      ...bill.lines.map((l) => ({
        accountId:   l.accountId,
        debit:       Number(l.amount),
        description: l.description,
      })),
      // DR Input VAT (if any)
      ...(Number(bill.vatAmount) > 0 ? [{
        accountCode: '1330',
        debit:       Number(bill.vatAmount),
        description: 'Input VAT',
      }] : []),
      // CR Accounts Payable — Trade
      {
        accountCode: '2010',
        credit:      Number(bill.totalAmount),
        description: `AP — ${bill.vendor.name} (${bill.billNo})`,
      },
    ];
    await glPost.safePost({
      entryDate:   bill.billDate,
      description: `AP Bill — ${bill.vendor.name} (${bill.billNo})`,
      reference:   bill.billNo,
      lines:       glLines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    res.status(201).json(bill);
  } catch (err) { next(err); }
};

exports.recordPayment = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { paymentDate, amount, paymentMethod, reference, notes } = req.body;
    const bill = await prisma.bill.findUnique({ where: { id } });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.status === 'VOID') throw createError('Cannot pay a voided bill', 400);

    const paymentNo = await genPayNo();
    const newPaid = Number(bill.paidAmount) + Number(amount);
    const remaining = Number(bill.totalAmount) - newPaid;
    const status = remaining <= 0.01 ? 'PAID' : 'PARTIAL';

    await prisma.$transaction([
      prisma.paymentAP.create({ data: { paymentNo, billId: id, paymentDate: new Date(paymentDate), amount: Number(amount), paymentMethod, reference, notes } }),
      prisma.bill.update({ where: { id }, data: { paidAmount: newPaid, status } }),
    ]);

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    const vendor = await prisma.vendor.findUnique({ where: { id: bill.vendorId }, select: { name: true } });
    await glPost.safePost({
      entryDate:   paymentDate,
      description: `AP Payment — ${vendor?.name} (${bill.billNo})`,
      reference:   paymentNo,
      lines: [
        { accountCode: '2010', debit:  Number(amount), description: `Clear AP — ${vendor?.name}` },
        { accountCode: '1020', credit: Number(amount), description: `Cash out — ${paymentNo}` },
      ],
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });

    res.json({ message: 'Payment recorded', remainingBalance: Math.max(0, remaining) });
  } catch (err) { next(err); }
};

exports.voidBill = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bill = await prisma.bill.findUnique({ where: { id } });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.paidAmount > 0) throw createError('Cannot void a bill with payments. Reverse payments first.', 400);
    res.json(await prisma.bill.update({ where: { id }, data: { status: 'VOID' } }));
  } catch (err) { next(err); }
};

exports.agingReport = async (req, res, next) => {
  try {
    const today = new Date();
    const bills = await prisma.bill.findMany({
      where: { status: { in: ['OPEN','PARTIAL','OVERDUE'] } },
      include: { vendor: { select: { name: true } } },
    });

    const report = bills.map((b) => {
      const due = new Date(b.dueDate);
      const daysOverdue = Math.max(0, Math.floor((today - due) / 86400000));
      const outstanding = Number(b.totalAmount) - Number(b.paidAmount);
      return {
        billNo: b.billNo, vendor: b.vendor.name,
        dueDate: b.dueDate, outstanding, daysOverdue,
        bucket: daysOverdue === 0 ? 'Current'
          : daysOverdue <= 30  ? '1-30 days'
          : daysOverdue <= 60  ? '31-60 days'
          : daysOverdue <= 90  ? '61-90 days'
          : 'Over 90 days',
      };
    });

    const buckets = ['Current','1-30 days','31-60 days','61-90 days','Over 90 days'];
    const summary = Object.fromEntries(buckets.map((b) => [b, report.filter((r) => r.bucket === b).reduce((s, r) => s + r.outstanding, 0)]));
    res.json({ items: report, summary, total: report.reduce((s, r) => s + r.outstanding, 0) });
  } catch (err) { next(err); }
};
