const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const glPost = require('../utils/glPost');

const genPONumber = async () => {
  const count = await prisma.purchaseOrder.count();
  return `PO-${String(count + 1).padStart(6, '0')}`;
};

const genBillNo = async () => {
  const count = await prisma.bill.count();
  return `BILL-${String(count + 1).padStart(6, '0')}`;
};

const computeTotals = (lines, taxAmount = 0) => {
  const subtotal = lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  return { subtotal, taxAmount: Number(taxAmount || 0), total: subtotal + Number(taxAmount || 0) };
};

exports.list = async (req, res, next) => {
  try {
    const { status, vendorId, search, page = 1, limit = 20 } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (vendorId) where.vendorId = Number(vendorId);
    if (search) where.OR = [{ poNumber: { contains: search } }, { notes: { contains: search } }];

    const [data, total] = await Promise.all([
      prisma.purchaseOrder.findMany({
        where,
        include: { vendor: { select: { name: true, vendorCode: true } }, lines: true },
        orderBy: { id: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.purchaseOrder.count({ where }),
    ]);
    res.json({ data, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const po = await prisma.purchaseOrder.findFirst({
      where: { id: Number(req.params.id), businessId: req.businessId },
      include: { vendor: true, lines: { orderBy: { lineOrder: 'asc' } } },
    });
    if (!po) throw createError('Purchase order not found', 404);
    res.json(po);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { vendorId, orderDate, expectedDate, notes, taxAmount, lines } = req.body;
    if (!lines?.length) throw createError('At least one line item is required', 400);

    const { subtotal, taxAmount: tax, total } = computeTotals(lines, taxAmount);
    const poNumber = await genPONumber();

    const po = await prisma.purchaseOrder.create({
      data: {
        businessId: req.businessId,
        poNumber,
        vendorId: Number(vendorId),
        orderDate: new Date(orderDate),
        expectedDate: expectedDate ? new Date(expectedDate) : null,
        notes,
        subtotal, taxAmount: tax, total,
        createdBy: req.user?.id ?? null,
        lines: {
          create: lines.map((l, i) => ({
            description: l.description,
            quantity: Number(l.quantity || 0),
            unitPrice: Number(l.unitPrice || 0),
            amount: Number(l.quantity || 0) * Number(l.unitPrice || 0),
            accountId: l.accountId ? Number(l.accountId) : null,
            lineOrder: i,
          })),
        },
      },
      include: { vendor: true, lines: true },
    });
    await recordAudit({ req, action: 'CREATE', entity: 'PurchaseOrder', entityId: po.id, summary: `Created PO ${po.poNumber} for ${po.vendor.name}` });
    res.status(201).json(po);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const po = await prisma.purchaseOrder.findFirst({ where: { id, businessId: req.businessId } });
    if (!po) throw createError('Purchase order not found', 404);
    if (!['DRAFT', 'SENT'].includes(po.status)) throw createError('Only DRAFT or SENT purchase orders can be edited', 400);

    const { vendorId, orderDate, expectedDate, notes, taxAmount, lines } = req.body;
    const { subtotal, taxAmount: tax, total } = computeTotals(lines || [], taxAmount);

    const updated = await prisma.$transaction(async (tx) => {
      if (lines) {
        await tx.purchaseOrderLine.deleteMany({ where: { poId: id } });
        await tx.purchaseOrderLine.createMany({
          data: lines.map((l, i) => ({
            poId: id, description: l.description,
            quantity: Number(l.quantity || 0), unitPrice: Number(l.unitPrice || 0),
            amount: Number(l.quantity || 0) * Number(l.unitPrice || 0),
            accountId: l.accountId ? Number(l.accountId) : null, lineOrder: i,
          })),
        });
      }
      return tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(vendorId && { vendorId: Number(vendorId) }),
          ...(orderDate && { orderDate: new Date(orderDate) }),
          expectedDate: expectedDate ? new Date(expectedDate) : null,
          notes,
          ...(lines && { subtotal, taxAmount: tax, total }),
        },
        include: { vendor: true, lines: true },
      });
    });
    await recordAudit({ req, action: 'UPDATE', entity: 'PurchaseOrder', entityId: id, summary: `Updated PO ${po.poNumber}` });
    res.json(updated);
  } catch (err) { next(err); }
};

exports.send = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const po = await prisma.purchaseOrder.findFirst({ where: { id, businessId: req.businessId } });
    if (!po) throw createError('Purchase order not found', 404);
    if (po.status !== 'DRAFT') throw createError('Only DRAFT purchase orders can be sent', 400);
    const updated = await prisma.purchaseOrder.update({ where: { id }, data: { status: 'SENT' } });
    await recordAudit({ req, action: 'UPDATE', entity: 'PurchaseOrder', entityId: id, summary: `Marked PO ${po.poNumber} as SENT` });
    res.json(updated);
  } catch (err) { next(err); }
};

// Receive goods: body.lines = [{ id, receivedQty }]
exports.receive = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const po = await prisma.purchaseOrder.findFirst({ where: { id, businessId: req.businessId }, include: { lines: true } });
    if (!po) throw createError('Purchase order not found', 404);
    if (['CANCELLED', 'BILLED'].includes(po.status)) throw createError('Cannot receive on a cancelled or billed PO', 400);

    const recvMap = Object.fromEntries((req.body.lines || []).map((l) => [Number(l.id), Number(l.receivedQty)]));

    await prisma.$transaction(
      po.lines
        .filter((l) => recvMap[l.id] != null)
        .map((l) => prisma.purchaseOrderLine.update({
          where: { id: l.id },
          data: { receivedQty: Math.min(recvMap[l.id], Number(l.quantity)) },
        }))
    );

    const fresh = await prisma.purchaseOrder.findUnique({ where: { id }, include: { lines: true } });
    const fullyReceived = fresh.lines.every((l) => Number(l.receivedQty) >= Number(l.quantity));
    const anyReceived = fresh.lines.some((l) => Number(l.receivedQty) > 0);
    const status = fullyReceived ? 'RECEIVED' : anyReceived ? 'PARTIAL' : po.status;

    const updated = await prisma.purchaseOrder.update({ where: { id }, data: { status }, include: { vendor: true, lines: true } });
    await recordAudit({ req, action: 'RECEIVE', entity: 'PurchaseOrder', entityId: id, summary: `Received goods on PO ${po.poNumber} (${status})` });
    res.json(updated);
  } catch (err) { next(err); }
};

// Convert PO into an AP Bill and auto-post to GL (mirrors payableController)
exports.convertToBill = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const po = await prisma.purchaseOrder.findFirst({ where: { id, businessId: req.businessId }, include: { vendor: true, lines: true } });
    if (!po) throw createError('Purchase order not found', 404);
    if (po.status === 'BILLED') throw createError('This PO has already been billed', 400);
    if (po.status === 'CANCELLED') throw createError('Cannot bill a cancelled PO', 400);
    if (po.lines.some((l) => !l.accountId)) throw createError('Every line must have an expense account before billing', 400);

    const { billDate, dueDate } = req.body;
    const billNo = await genBillNo();

    const bill = await prisma.bill.create({
      data: {
        businessId: req.businessId,
        billNo,
        vendorId: po.vendorId,
        billDate: billDate ? new Date(billDate) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 86400000),
        description: `From ${po.poNumber}`,
        subtotal: po.subtotal,
        vatAmount: po.taxAmount,
        totalAmount: po.total,
        lines: {
          create: po.lines.map((l) => ({
            accountId: l.accountId,
            description: l.description,
            quantity: l.quantity,
            unitPrice: l.unitPrice,
            amount: l.amount,
            vatCode: 'VAT',
          })),
        },
      },
      include: { vendor: true, lines: true },
    });

    // Auto-post AP entry to GL
    const glLines = [
      ...bill.lines.map((l) => ({ accountId: l.accountId, debit: Number(l.amount), description: l.description })),
      ...(Number(bill.vatAmount) > 0 ? [{ accountCode: '1330', debit: Number(bill.vatAmount), description: 'Input VAT' }] : []),
      { accountCode: '2010', credit: Number(bill.totalAmount), description: `AP — ${bill.vendor.name} (${bill.billNo})` },
    ];
    await glPost.safePost({
      entryDate: bill.billDate,
      description: `AP Bill — ${bill.vendor.name} (${bill.billNo}) from ${po.poNumber}`,
      reference: bill.billNo,
      businessId: req.businessId,
      lines: glLines,
      userId: req.user?.id || 1,
    });

    await prisma.purchaseOrder.update({ where: { id }, data: { status: 'BILLED', billId: bill.id } });
    await recordAudit({ req, action: 'CONVERT', entity: 'PurchaseOrder', entityId: id, summary: `Converted PO ${po.poNumber} → Bill ${bill.billNo}` });
    res.status(201).json({ bill, message: `PO converted to ${bill.billNo}` });
  } catch (err) { next(err); }
};

exports.cancel = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const po = await prisma.purchaseOrder.findFirst({ where: { id, businessId: req.businessId } });
    if (!po) throw createError('Purchase order not found', 404);
    if (po.status === 'BILLED') throw createError('Cannot cancel a billed PO', 400);
    const updated = await prisma.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    await recordAudit({ req, action: 'CANCEL', entity: 'PurchaseOrder', entityId: id, summary: `Cancelled PO ${po.poNumber}` });
    res.json(updated);
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const po = await prisma.purchaseOrder.findFirst({ where: { id, businessId: req.businessId } });
    if (!po) throw createError('Purchase order not found', 404);
    if (po.status === 'BILLED') throw createError('Cannot delete a billed PO', 400);
    await prisma.purchaseOrder.delete({ where: { id } });
    await recordAudit({ req, action: 'DELETE', entity: 'PurchaseOrder', entityId: id, summary: `Deleted PO ${po.poNumber}` });
    res.json({ message: 'Purchase order deleted' });
  } catch (err) { next(err); }
};
