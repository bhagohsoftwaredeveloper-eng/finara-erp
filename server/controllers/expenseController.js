const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const glPost = require('../utils/glPost');

// Category → GL account code mapping
const CATEGORY_ACCOUNT = {
  TRANSPORTATION:  '6520',
  MEALS:           '6510',
  OFFICE_SUPPLIES: '6320',
  UTILITIES:       '6220',
  REPAIRS:         '6240',
  PROFESSIONAL:    '6400',
  BANK_CHARGES:    '6360',
  ADVERTISING:     '6530',
  EVENTS:          '6160',
  COURIER:         '6330',
  RENT:            '6210',
  TAXES:           '6370',
  MISCELLANEOUS:   '6390',
};

// ─── Expense categories (predefined for quick selection) ─────────
exports.getCategories = (_req, res) => {
  res.json([
    { value: 'TRANSPORTATION',  label: 'Transportation',         sub: 'Gas, toll, parking, taxi/Grab' },
    { value: 'MEALS',           label: 'Meals & Entertainment',  sub: 'Food, drinks, client meals' },
    { value: 'OFFICE_SUPPLIES', label: 'Office Supplies',        sub: 'Stationery, printer ink, etc.' },
    { value: 'UTILITIES',       label: 'Utilities',              sub: 'Electricity, water, internet, phone' },
    { value: 'REPAIRS',         label: 'Repairs & Maintenance',  sub: 'Equipment, vehicle, facility' },
    { value: 'PROFESSIONAL',    label: 'Professional Fees',      sub: 'Consultants, lawyers, accountants' },
    { value: 'BANK_CHARGES',    label: 'Bank Charges',           sub: 'Service fees, charges' },
    { value: 'ADVERTISING',     label: 'Advertising & Promo',    sub: 'Marketing materials, digital ads' },
    { value: 'EVENTS',          label: 'Events & Production',    sub: 'Venue, equipment, crew' },
    { value: 'COURIER',         label: 'Courier & Delivery',     sub: 'Shipping, messenger' },
    { value: 'RENT',            label: 'Rent / Lease',           sub: 'Office, warehouse, equipment rent' },
    { value: 'TAXES',           label: 'Taxes & Licenses',       sub: 'BIR payments, permits, licenses' },
    { value: 'MISCELLANEOUS',   label: 'Miscellaneous',          sub: 'Other company expenses' },
  ]);
};

// ─── Sequential voucher number ────────────────────────────────────
async function nextVoucherNo() {
  const last = await prisma.expenseVoucher.findFirst({
    orderBy: { id: 'desc' },
    select: { voucherNo: true },
  });
  if (!last) return 'EV-000001';
  const n = parseInt(last.voucherNo.replace('EV-', ''), 10);
  return `EV-${String(n + 1).padStart(6, '0')}`;
}

// ─── Summary ──────────────────────────────────────────────────────
exports.getSummary = async (req, res, next) => {
  try {
    const today = new Date();
    const yr    = today.getFullYear();
    const mo    = today.getMonth();

    const [all, paidYTD, thisMonth] = await Promise.all([
      prisma.expenseVoucher.groupBy({
        by: ['status'],
        where: { businessId: req.businessId },
        _count: { id: true },
        _sum:   { totalAmount: true },
      }),
      prisma.expenseVoucher.aggregate({
        where: { businessId: req.businessId, status: 'PAID', paidDate: { gte: new Date(yr, 0, 1) } },
        _sum: { totalAmount: true },
      }),
      prisma.expenseVoucher.aggregate({
        where: {
          businessId: req.businessId,
          status: { in: ['APPROVED', 'PAID'] },
          date:   { gte: new Date(yr, mo, 1), lt: new Date(yr, mo + 1, 1) },
        },
        _sum: { totalAmount: true },
      }),
    ]);

    const byStatus = Object.fromEntries(all.map(r => [r.status, { count: r._count.id, amount: Number(r._sum.totalAmount || 0) }]));
    res.json({
      draft:      byStatus.DRAFT      || { count: 0, amount: 0 },
      submitted:  byStatus.SUBMITTED  || { count: 0, amount: 0 },
      approved:   byStatus.APPROVED   || { count: 0, amount: 0 },
      paid:       byStatus.PAID       || { count: 0, amount: 0 },
      rejected:   byStatus.REJECTED   || { count: 0, amount: 0 },
      paidYTD:    Number(paidYTD._sum.totalAmount || 0),
      thisMonth:  Number(thisMonth._sum.totalAmount || 0),
    });
  } catch (err) { next(err); }
};

// ─── List ─────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { type, status, from, to, search, page = 1, limit = 50 } = req.query;
    const where = { businessId: req.businessId };
    if (type)   where.type   = type;
    if (status) where.status = status;
    if (search) where.OR = [
      { voucherNo:  { contains: search } },
      { payee:      { contains: search } },
      { purpose:    { contains: search } },
      { requestedBy:{ contains: search } },
    ];
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from + 'T00:00:00.000Z');
      if (to)   where.date.lte = new Date(to   + 'T23:59:59.999Z');
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const [rows, total] = await Promise.all([
      prisma.expenseVoucher.findMany({
        where,
        include: { items: { include: { account: { select: { accountCode: true, accountName: true } } } } },
        orderBy: [{ date: 'desc' }, { voucherNo: 'desc' }],
        skip, take: Number(limit),
      }),
      prisma.expenseVoucher.count({ where }),
    ]);

    res.json({ data: rows, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

// ─── Get One ──────────────────────────────────────────────────────
exports.get = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.expenseVoucher.findUnique({
      where: { id },
      include: { items: { include: { account: { select: { id: true, accountCode: true, accountName: true } } } } },
    });
    if (!row) throw createError('Expense voucher not found', 404);
    res.json(row);
  } catch (err) { next(err); }
};

// ─── Create ───────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { type, date, payee, category, purpose, receiptNo, requestedBy, notes, items = [] } = req.body;

    const totalAmount = items.reduce((s, it) => s + Number(it.amount || 0), 0);
    const voucherNo   = await nextVoucherNo();

    const record = await prisma.expenseVoucher.create({
      data: {
        businessId: req.businessId,
        voucherNo, type, date: new Date(date + 'T00:00:00.000Z'),
        payee, category, purpose,
        totalAmount, receiptNo, requestedBy, notes,
        items: {
          create: items.map(it => ({
            description: it.description,
            accountId:   it.accountId || null,
            amount:      Number(it.amount || 0),
            receiptNo:   it.receiptNo  || null,
          })),
        },
      },
      include: { items: true },
    });

    res.status(201).json(record);
  } catch (err) { next(err); }
};

// ─── Update ───────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.expenseVoucher.findUnique({ where: { id } });
    if (!existing) throw createError('Not found', 404);
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) throw createError('Only DRAFT or REJECTED vouchers can be edited', 400);

    const { type, date, payee, category, purpose, receiptNo, requestedBy, notes, items } = req.body;
    const totalAmount = Array.isArray(items) ? items.reduce((s, it) => s + Number(it.amount || 0), 0) : Number(existing.totalAmount);

    await prisma.expenseVoucher.update({
      where: { id },
      data: {
        type, payee, category, purpose, receiptNo, requestedBy, notes, totalAmount,
        date:   date ? new Date(date + 'T00:00:00.000Z') : undefined,
        status: existing.status === 'REJECTED' ? 'DRAFT' : undefined,
      },
    });

    if (Array.isArray(items)) {
      await prisma.expenseVoucherItem.deleteMany({ where: { voucherId: id } });
      if (items.length) {
        await prisma.expenseVoucherItem.createMany({
          data: items.map(it => ({
            voucherId:   id,
            description: it.description,
            accountId:   it.accountId || null,
            amount:      Number(it.amount || 0),
            receiptNo:   it.receiptNo  || null,
          })),
        });
      }
    }

    const updated = await prisma.expenseVoucher.findUnique({
      where: { id },
      include: { items: { include: { account: { select: { id: true, accountCode: true, accountName: true } } } } },
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Submit ───────────────────────────────────────────────────────
exports.submit = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { requestedBy } = req.body;
    const updated = await prisma.expenseVoucher.update({
      where: { id },
      data: { status: 'SUBMITTED', requestedBy: requestedBy || undefined },
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Approve ──────────────────────────────────────────────────────
exports.approve = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { approvedBy } = req.body;
    const updated = await prisma.expenseVoucher.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: approvedBy || undefined },
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Mark Paid ────────────────────────────────────────────────────
exports.pay = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { paidBy, paidDate, paymentAccountCode } = req.body;

    // Fetch voucher with items before updating
    const voucher = await prisma.expenseVoucher.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!voucher) throw createError('Expense voucher not found', 404);
    if (voucher.status !== 'APPROVED') throw createError('Voucher must be APPROVED before marking paid', 400);

    const updated = await prisma.expenseVoucher.update({
      where: { id },
      data: {
        status:   'PAID',
        paidBy:   paidBy  || undefined,
        paidDate: paidDate ? new Date(paidDate + 'T00:00:00.000Z') : new Date(),
      },
    });

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    // Use explicitly chosen payment account; fall back to type-based default
    const cashCode = paymentAccountCode || (voucher.type === 'PETTY_CASH' ? '1011' : '1020');
    const totalAmt = Number(voucher.totalAmount);

    // Build DR lines: use item accountId if set, else fall back to category mapping
    const drLines = [];
    if (voucher.items.length > 0) {
      for (const item of voucher.items) {
        if (item.accountId) {
          drLines.push({ accountId: item.accountId, debit: Number(item.amount), description: item.description });
        } else {
          const code = CATEGORY_ACCOUNT[voucher.category] || '6390';
          drLines.push({ accountCode: code, debit: Number(item.amount), description: item.description });
        }
      }
    } else {
      // No items — post total to category account
      const code = CATEGORY_ACCOUNT[voucher.category] || '6390';
      drLines.push({ accountCode: code, debit: totalAmt, description: `${voucher.payee} — ${voucher.purpose.slice(0, 80)}` });
    }

    await glPost.safePost({
      entryDate:   paidDate || new Date().toISOString().slice(0, 10),
      description: `Expense Voucher — ${voucher.voucherNo} (${voucher.payee})`,
      reference:   voucher.voucherNo,
      lines: [
        ...drLines,
        { accountCode: cashCode, credit: totalAmt, description: `Cash paid — ${voucher.voucherNo}` },
      ],
      userId:     req.user?.id || 1,
      businessId: req.businessId,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Reject ───────────────────────────────────────────────────────
exports.reject = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { rejectedReason } = req.body;
    const updated = await prisma.expenseVoucher.update({
      where: { id },
      data: { status: 'REJECTED', rejectedReason },
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Delete (draft/rejected only) ────────────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.expenseVoucher.findUnique({ where: { id } });
    if (!existing) throw createError('Not found', 404);
    if (!['DRAFT', 'REJECTED'].includes(existing.status)) throw createError('Only DRAFT or REJECTED vouchers can be deleted', 400);
    await prisma.expenseVoucher.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
};
