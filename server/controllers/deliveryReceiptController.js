const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const glPost = require('../utils/glPost');
const { nextDocNumber } = require('../utils/docNumber');
const { deductStock, restoreStock, cogsLines } = require('../utils/deliveryStock');

const DR_INCLUDE = {
  customer: { select: { id: true, name: true, customerCode: true, address: true, tin: true } },
  invoice:  { select: { id: true, invoiceNo: true, status: true } },
  lines: {
    include: { item: { select: { id: true, sku: true, name: true, unit: true, sellingPrice: true, revenueAccountId: true } } },
    orderBy: { id: 'asc' },
  },
};

const genDrNo = async () => {
  const last = await prisma.deliveryReceipt.findFirst({
    where: { drNo: { startsWith: 'DR-' } }, orderBy: { drNo: 'desc' }, select: { drNo: true },
  });
  return nextDocNumber('DR-', last?.drNo, 6);
};

async function findDr(id, businessId, include) {
  const dr = await prisma.deliveryReceipt.findFirst({ where: { id, businessId }, ...(include && { include }) });
  if (!dr) throw createError('Delivery receipt not found', 404);
  return dr;
}

// An invoice's "shipped" flag came from a delivery receipt only if no other delivered DR
// is linked to it and nobody entered courier/tracking by hand. Used by cancel and unlink.
async function unshipIfOnlyFromDr(db, { invoiceId, excludeDrId, businessId }) {
  const others = await db.deliveryReceipt.count({
    where: { invoiceId, status: 'DELIVERED', id: { not: excludeDrId } },
  });
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, businessId } });
  if (others === 0 && invoice && !invoice.courier && !invoice.trackingNumber) {
    await db.invoice.update({ where: { id: invoice.id }, data: { deliveryStatus: 'PENDING', shippedDate: null } });
  }
}

// An invoice's lines as delivery lines. A package line becomes its contents.
function linesFromInvoice(invoice) {
  const out = [];
  for (const l of invoice.lines) {
    if (l.packageId && Array.isArray(l.packageComponents) && l.packageComponents.length) {
      for (const c of l.packageComponents) out.push({ description: c.description, quantity: Number(c.quantity), unit: c.unit || null });
    } else {
      out.push({ description: l.description, quantity: Number(l.quantity), unit: null });
    }
  }
  return out;
}

async function cleanLines(lines, businessId) {
  if (!Array.isArray(lines) || lines.length === 0) throw createError('Add at least one line', 400);
  const seen = new Set();
  const out = [];
  for (const l of lines) {
    const description = String(l.description || '').trim();
    const quantity = Number(l.quantity);
    if (!description) throw createError('Every line needs a description', 400);
    if (!(quantity > 0)) throw createError(`Line "${description}" needs a quantity greater than 0`, 400);
    let itemId = null;
    if (l.itemId) {
      itemId = Number(l.itemId);
      if (seen.has(itemId)) throw createError('The same inventory item cannot appear on two lines', 400);
      seen.add(itemId);
      const found = await prisma.inventoryItem.findFirst({ where: { id: itemId, businessId, isActive: true }, select: { id: true } });
      if (!found) throw createError(`Inventory item not found for line "${description}"`, 404);
    }
    out.push({ itemId, description, quantity, unit: l.unit ? String(l.unit).slice(0, 20) : null });
  }
  return out;
}

// Insert a DR, retrying on the off chance a concurrent create took the same number.
async function insertDr(data) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.deliveryReceipt.create({ data: { ...data, drNo: await genDrNo() }, include: DR_INCLUDE });
    } catch (err) {
      if (err.code === 'P2002' && attempt < 3) continue;
      throw err;
    }
  }
}

// driverId / vehicleId link to the Drivers and Vehicles lists. They are written only
// when the caller sends them (null clears), so receipts that never use them are
// stored exactly as before.
const linkFields = (b) => ({
  ...('driverId' in b && { driverId: b.driverId ? Number(b.driverId) : null }),
  ...('vehicleId' in b && { vehicleId: b.vehicleId ? Number(b.vehicleId) : null }),
});

const headerFields = (b) => ({
  deliveryAddress: b.deliveryAddress || null,
  driverName: b.driverName || null,
  vehicleNo: b.vehicleNo || null,
  notes: b.notes || null,
  deductStock: !!b.deductStock,
  ...linkFields(b),
});

exports.list = async (req, res, next) => {
  try {
    const { status, customerId, search, from, to } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (customerId) where.customerId = Number(customerId);
    if (from || to) where.drDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };
    if (search) where.OR = [{ drNo: { contains: search } }, { customer: { name: { contains: search } } }];
    res.json(await prisma.deliveryReceipt.findMany({
      where,
      include: { customer: { select: { id: true, name: true } }, invoice: { select: { id: true, invoiceNo: true } }, _count: { select: { lines: true } } },
      orderBy: [{ drDate: 'desc' }, { id: 'desc' }],
      take: 300,
    }));
  } catch (err) { next(err); }
};

exports.get = async (req, res, next) => {
  try {
    res.json(await findDr(Number(req.params.id), req.businessId, DR_INCLUDE));
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const b = req.body;
    const businessId = req.businessId;

    let customerId = b.customerId ? Number(b.customerId) : null;
    let invoice = null;
    if (b.invoiceId) {
      invoice = await prisma.invoice.findFirst({
        where: { id: Number(b.invoiceId), businessId }, include: { lines: true },
      });
      if (!invoice) throw createError('Invoice not found', 404);
      if (invoice.status === 'VOID') throw createError('Cannot create a delivery receipt for a voided invoice', 400);
      customerId = invoice.customerId;
    }
    if (!customerId) throw createError('customerId or invoiceId is required', 400);

    const customer = await prisma.customer.findFirst({ where: { id: customerId, businessId }, select: { id: true, address: true } });
    if (!customer) throw createError('Customer not found', 404);

    const rawLines = Array.isArray(b.lines) && b.lines.length ? b.lines : (invoice ? linesFromInvoice(invoice) : b.lines);
    const lines = await cleanLines(rawLines, businessId);
    const header = headerFields(b);
    header.deliveryAddress = b.deliveryAddress || invoice?.shippingAddress || customer.address || null;

    const dr = await insertDr({
      businessId, customerId, invoiceId: invoice ? invoice.id : null,
      drDate: new Date(b.drDate), ...header, lines: { create: lines },
    });
    res.status(201).json(dr);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const dr = await findDr(id, req.businessId);
    if (dr.status !== 'DRAFT') throw createError('Only draft delivery receipts can be edited', 400);

    const b = req.body;
    const lines = await cleanLines(b.lines, req.businessId);
    res.json(await prisma.deliveryReceipt.update({
      where: { id },
      data: {
        ...(b.drDate && { drDate: new Date(b.drDate) }),
        ...headerFields(b),
        lines: { deleteMany: {}, create: lines },
      },
      include: DR_INCLUDE,
    }));
  } catch (err) { next(err); }
};

exports.deliver = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const dr = await findDr(id, req.businessId, { lines: { include: { item: true } } });
    if (dr.status !== 'DRAFT') throw createError('Only a draft delivery receipt can be marked delivered', 400);

    const stocked = dr.deductStock ? dr.lines.filter((l) => l.item) : [];
    let movements = [];
    let updated;
    await prisma.$transaction(async (tx) => {
      if (stocked.length) {
        movements = await deductStock(tx, {
          drNo: dr.drNo, drDate: dr.drDate,
          lines: stocked.map((l) => ({ quantity: Number(l.quantity), item: l.item })),
        });
      }
      updated = await tx.deliveryReceipt.update({
        where: { id }, data: { status: 'DELIVERED', deliveredAt: new Date() }, include: DR_INCLUDE,
      });
      if (dr.invoiceId) {
        const invoice = await tx.invoice.findFirst({ where: { id: dr.invoiceId, businessId: req.businessId } });
        if (invoice && invoice.deliveryStatus !== 'SHIPPED') {
          await tx.invoice.update({ where: { id: invoice.id }, data: { deliveryStatus: 'SHIPPED', shippedDate: dr.drDate } });
        }
      }
    });

    const lines = cogsLines(movements);
    if (lines.length) {
      await glPost.safePost({
        entryDate: dr.drDate, description: `Inventory OUT — ${dr.drNo}`, reference: dr.drNo,
        lines, userId: req.user?.id || 1, businessId: req.businessId,
      });
    }
    res.json(updated);
  } catch (err) { next(err); }
};

exports.cancel = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const dr = await findDr(id, req.businessId);
    if (dr.status === 'CANCELLED') throw createError('This delivery receipt is already cancelled', 400);

    const wasDelivered = dr.status === 'DELIVERED';
    let movements = [];
    let updated;
    await prisma.$transaction(async (tx) => {
      if (wasDelivered && dr.deductStock) {
        movements = await restoreStock(tx, { drNo: dr.drNo, businessId: req.businessId });
      }
      updated = await tx.deliveryReceipt.update({
        where: { id },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: req.body?.reason ? String(req.body.reason).slice(0, 255) : null },
        include: DR_INCLUDE,
      });
      if (wasDelivered && dr.invoiceId) {
        await unshipIfOnlyFromDr(tx, { invoiceId: dr.invoiceId, excludeDrId: id, businessId: req.businessId });
      }
    });

    const lines = cogsLines(movements, { reverse: true });
    if (lines.length) {
      await glPost.safePost({
        entryDate: new Date(), description: `Inventory IN (cancelled) — ${dr.drNo}`, reference: dr.drNo,
        lines, userId: req.user?.id || 1, businessId: req.businessId,
      });
    }
    res.json(updated);
  } catch (err) { next(err); }
};

// ─── "Mark as Shipped" on an invoice makes the delivery receipt (already delivered) ──
// Returns the new DR, or null when the invoice already has an active one.
exports.createForShipment = async (businessId, invoiceId, { shippedDate, shippingAddress, courier, trackingNumber }) => {
  const existing = await prisma.deliveryReceipt.count({
    where: { businessId, invoiceId, status: { not: 'CANCELLED' } },
  });
  if (existing > 0) return null;

  const invoice = await prisma.invoice.findFirst({ where: { id: invoiceId, businessId }, include: { lines: true } });
  if (!invoice) throw createError('Invoice not found', 404);
  const customer = await prisma.customer.findFirst({ where: { id: invoice.customerId, businessId }, select: { id: true, address: true } });
  const lines = await cleanLines(linesFromInvoice(invoice), businessId);

  return insertDr({
    businessId, customerId: invoice.customerId, invoiceId,
    drDate: shippedDate ? new Date(shippedDate) : new Date(),
    deliveryAddress: shippingAddress || invoice.shippingAddress || customer?.address || null,
    driverName: courier || null,
    notes: trackingNumber ? `Tracking: ${trackingNumber}` : null,
    status: 'DELIVERED', deliveredAt: new Date(), deductStock: false,
    lines: { create: lines },
  });
};

// ─── Connect an existing DR and an existing invoice (e.g. after the invoice was paid) ──
exports.link = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const dr = await findDr(id, req.businessId);
    if (dr.status === 'CANCELLED') throw createError('That delivery receipt is cancelled', 400);
    if (dr.invoiceId) throw createError('That delivery receipt is already linked to an invoice. Unlink it first.', 400);

    const invoice = await prisma.invoice.findFirst({ where: { id: Number(req.body.invoiceId), businessId: req.businessId } });
    if (!invoice) throw createError('Invoice not found', 404);
    if (invoice.status === 'VOID') throw createError('Cannot link to a voided invoice', 400);
    if (invoice.customerId !== dr.customerId) throw createError('That invoice belongs to a different customer', 400);

    await exports.applyLink(dr, invoice.id);
    res.json(await findDr(id, req.businessId, DR_INCLUDE));
  } catch (err) { next(err); }
};

exports.unlink = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const dr = await findDr(id, req.businessId);
    if (!dr.invoiceId) throw createError('That delivery receipt is not linked to an invoice', 400);

    await prisma.$transaction(async (tx) => {
      await tx.deliveryReceipt.update({ where: { id }, data: { invoiceId: null } });
      if (dr.status === 'DELIVERED') {
        await unshipIfOnlyFromDr(tx, { invoiceId: dr.invoiceId, excludeDrId: id, businessId: req.businessId });
      }
    });
    res.json(await findDr(id, req.businessId, DR_INCLUDE));
  } catch (err) { next(err); }
};

// ─── Linking a DR to the invoice made from it (used by receivableController.createInvoice) ──
// Checked BEFORE the invoice is created, so a bad id can never leave a half-linked invoice.
exports.prepareLink = async (deliveryReceiptId, customerId, businessId) => {
  const dr = await prisma.deliveryReceipt.findFirst({ where: { id: Number(deliveryReceiptId), businessId } });
  if (!dr) throw createError('Delivery receipt not found', 404);
  if (dr.status === 'CANCELLED') throw createError('That delivery receipt is cancelled', 400);
  if (dr.invoiceId) throw createError('That delivery receipt is already linked to an invoice', 400);
  if (dr.customerId !== Number(customerId)) throw createError('That delivery receipt belongs to a different customer', 400);
  return dr;
};

exports.applyLink = async (dr, invoiceId) => {
  await prisma.deliveryReceipt.update({ where: { id: dr.id }, data: { invoiceId } });
  if (dr.status === 'DELIVERED') {
    await prisma.invoice.update({
      where: { id: invoiceId }, data: { deliveryStatus: 'SHIPPED', shippedDate: dr.deliveredAt || dr.drDate },
    });
  }
};
