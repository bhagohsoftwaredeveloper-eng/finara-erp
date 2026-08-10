const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { computeVAT } = require('../utils/phCompliance');
const { nextDocNumber } = require('../utils/docNumber');
const { buildCashSaleEntry } = require('../utils/cashSale');
const glPost = require('../utils/glPost');

const genSaleNo = async () => {
  const last = await prisma.cashSale.findFirst({
    orderBy: { id: 'desc' },
    select: { saleNo: true },
  });
  return nextDocNumber('CS-', last?.saleNo);
};

// ─── List ────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { status, search, from, to, page = 1, limit = 50 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (search) where.OR = [
      { saleNo:      { contains: search } },
      { buyerName:   { contains: search } },
      { description: { contains: search } },
    ];
    if (from || to) where.saleDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };

    const [rows, total] = await Promise.all([
      prisma.cashSale.findMany({
        where,
        include: { account: { select: { accountCode: true, accountName: true } } },
        orderBy: { saleDate: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.cashSale.count({ where }),
    ]);
    res.json({ data: rows, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

// ─── Get one ─────────────────────────────────────────────────────
exports.getOne = async (req, res, next) => {
  try {
    const sale = await prisma.cashSale.findUnique({
      where: { id: Number(req.params.id) },
      include: { account: true, journalEntry: { include: { lines: true } } },
    });
    if (!sale) throw createError('Cash sale not found', 404);
    res.json(sale);
  } catch (err) { next(err); }
};

// ─── Create ──────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { saleDate, buyerName, description, accountId, vatCode = 'VAT', amount, paymentMethod, notes } = req.body;
    if (!accountId) throw createError('accountId is required', 400);
    if (!description) throw createError('description is required', 400);
    if (!Number(amount) || Number(amount) <= 0) throw createError('amount must be greater than 0', 400);
    if (!paymentMethod) throw createError('paymentMethod is required', 400);

    const account = await prisma.account.findFirst({
      where: { id: Number(accountId), businessId: req.businessId, accountType: 'REVENUE', isActive: true },
    });
    if (!account) throw createError('accountId must be an active REVENUE account', 400);

    const v = vatCode === 'VAT' ? computeVAT(Number(amount), true) : { base: Number(amount), vat: 0, total: Number(amount) };
    const saleNo = await genSaleNo();

    const sale = await prisma.cashSale.create({
      data: {
        businessId: req.businessId,
        saleNo,
        saleDate: new Date(saleDate),
        buyerName: buyerName || null,
        description,
        accountId: Number(accountId),
        vatCode,
        subtotal: v.base,
        vatAmount: v.vat,
        totalAmount: v.total,
        paymentMethod,
        notes: notes || null,
        createdBy: req.user?.id || null,
      },
    });

    const { lines } = buildCashSaleEntry({
      saleNo, accountId: Number(accountId),
      subtotal: v.base, vatAmount: v.vat, totalAmount: v.total, paymentMethod,
    });
    const entry = await glPost.safePost({
      entryDate: sale.saleDate,
      description: `Cash Sale — ${buyerName || 'Walk-in'} (${saleNo})`,
      reference: saleNo,
      lines,
      userId: req.user?.id || 1,
      businessId: req.businessId,
    });

    if (entry) {
      await prisma.cashSale.update({ where: { id: sale.id }, data: { journalEntryId: entry.id } });
    }

    res.status(201).json({ ...sale, journalEntryId: entry?.id || null });
  } catch (err) { next(err); }
};

// ─── Void ────────────────────────────────────────────────────────
exports.voidSale = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body;
    if (!reason || !reason.trim()) throw createError('A void reason is required', 400);

    const sale = await prisma.cashSale.findUnique({ where: { id } });
    if (!sale) throw createError('Cash sale not found', 404);
    if (sale.status === 'VOID') throw createError('Cash sale is already voided', 400);

    await prisma.$transaction([
      prisma.cashSale.update({
        where: { id },
        data: { status: 'VOID', voidedReason: reason, voidedAt: new Date() },
      }),
      ...(sale.journalEntryId
        ? [prisma.journalEntry.update({ where: { id: sale.journalEntryId }, data: { status: 'VOIDED' } })]
        : []),
    ]);

    res.json({ message: `Cash sale ${sale.saleNo} voided` });
  } catch (err) { next(err); }
};
