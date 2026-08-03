const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const { nextDocNumber } = require('../utils/docNumber');

const genRequestNo = async () => {
  const last = await prisma.cashRequest.findFirst({
    orderBy: { id: 'desc' },
    select: { requestNo: true },
  });
  return nextDocNumber('CR-', last?.requestNo);
};

const sumItems = (items = []) =>
  items.reduce((s, i) => s + Number(i.estimatedCost || 0), 0);

const mapItems = (items = []) =>
  items
    .filter((i) => i.description && Number(i.estimatedCost) > 0)
    .map((i) => ({
      description:   i.description,
      quantity:      i.quantity != null && i.quantity !== '' ? Number(i.quantity) : null,
      estimatedCost: Number(i.estimatedCost),
      accountId:     i.accountId ? Number(i.accountId) : null,
    }));

exports.list = async (req, res, next) => {
  try {
    const { status, search, from, to, page = 1, limit = 20 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (search) where.OR = [
      { requestNo:    { contains: search } },
      { requestedFor: { contains: search } },
      { purpose:      { contains: search } },
    ];
    if (from || to) where.requestDate = {
      ...(from && { gte: new Date(from) }),
      ...(to   && { lte: new Date(to) }),
    };

    const [data, total] = await Promise.all([
      prisma.cashRequest.findMany({
        where,
        include: { items: true, liquidation: { select: { id: true, voucherNo: true, totalAmount: true } } },
        orderBy: { id: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.cashRequest.count({ where }),
    ]);
    res.json({ data, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const cr = await prisma.cashRequest.findFirst({
      where: { id: Number(req.params.id), businessId: req.businessId },
      include: {
        items: { include: { account: { select: { accountCode: true, accountName: true } } } },
        liquidation: { include: { items: true } },
      },
    });
    if (!cr) throw createError('Cash request not found', 404);
    res.json(cr);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { requestDate, neededDate, requestedFor, purpose, notes, items } = req.body;
    if (!requestedFor?.trim()) throw createError('Requested for (name) is required', 400);
    if (!purpose?.trim())      throw createError('Purpose is required', 400);

    const rows = mapItems(items);
    if (!rows.length) throw createError('At least one item with an estimated cost is required', 400);

    const requestNo = await genRequestNo();
    const cr = await prisma.cashRequest.create({
      data: {
        businessId:      req.businessId,
        requestNo,
        requestDate:     requestDate ? new Date(requestDate) : new Date(),
        neededDate:      neededDate ? new Date(neededDate) : null,
        requestedFor:    requestedFor.trim(),
        purpose:         purpose.trim(),
        requestedAmount: sumItems(rows),
        notes:           notes || null,
        requestedBy:     req.user ? `${req.user.firstName} ${req.user.lastName}`.trim() : null,
        items:           { create: rows },
      },
      include: { items: true },
    });

    await recordAudit({
      req, action: 'CREATE', entity: 'CashRequest', entityId: cr.id,
      summary: `Created cash request ${cr.requestNo} for ${cr.requestedFor}`,
    });
    res.status(201).json(cr);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cr = await prisma.cashRequest.findFirst({ where: { id, businessId: req.businessId } });
    if (!cr) throw createError('Cash request not found', 404);
    if (!['DRAFT', 'SUBMITTED'].includes(cr.status)) {
      throw createError('Only DRAFT or SUBMITTED requests can be edited', 400);
    }

    const { requestDate, neededDate, requestedFor, purpose, notes, items } = req.body;
    const rows = items ? mapItems(items) : null;
    if (items && !rows.length) throw createError('At least one item with an estimated cost is required', 400);

    const updated = await prisma.$transaction(async (tx) => {
      if (rows) {
        await tx.cashRequestItem.deleteMany({ where: { requestId: id } });
        await tx.cashRequestItem.createMany({ data: rows.map((r) => ({ ...r, requestId: id })) });
      }
      return tx.cashRequest.update({
        where: { id },
        data: {
          ...(requestDate  && { requestDate: new Date(requestDate) }),
          neededDate:   neededDate ? new Date(neededDate) : null,
          ...(requestedFor && { requestedFor: requestedFor.trim() }),
          ...(purpose      && { purpose: purpose.trim() }),
          notes: notes ?? null,
          ...(rows && { requestedAmount: sumItems(rows) }),
        },
        include: { items: true },
      });
    });

    await recordAudit({
      req, action: 'UPDATE', entity: 'CashRequest', entityId: id,
      summary: `Updated cash request ${cr.requestNo}`,
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// Shared status transition helper
const transition = (from, to, verb, extraData = () => ({})) => async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const cr = await prisma.cashRequest.findFirst({ where: { id, businessId: req.businessId } });
    if (!cr) throw createError('Cash request not found', 404);
    if (!from.includes(cr.status)) {
      throw createError(`Only ${from.join(' or ')} requests can be ${verb}`, 400);
    }
    const updated = await prisma.cashRequest.update({
      where: { id },
      data: { status: to, ...extraData(req) },
      include: { items: true },
    });
    await recordAudit({
      req, action: 'UPDATE', entity: 'CashRequest', entityId: id,
      summary: `Cash request ${cr.requestNo} ${verb}`,
    });
    res.json(updated);
  } catch (err) { next(err); }
};

exports.submit = transition(['DRAFT'], 'SUBMITTED', 'submitted');

exports.approve = transition(['SUBMITTED'], 'APPROVED', 'approved', (req) => ({
  approvedBy: req.body.approvedBy
    || (req.user ? `${req.user.firstName} ${req.user.lastName}`.trim() : null),
}));

exports.reject = async (req, res, next) => {
  try {
    const { reason } = req.body;
    if (!reason?.trim()) throw createError('A reason is required to reject a request', 400);
    return transition(['SUBMITTED', 'APPROVED'], 'REJECTED', 'rejected', () => ({
      rejectedReason: reason.trim(),
    }))(req, res, next);
  } catch (err) { next(err); }
};

exports.cancel = transition(
  ['DRAFT', 'SUBMITTED', 'APPROVED'], 'CANCELLED', 'cancelled',
);
