const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { computeVAT } = require('../utils/phCompliance');
const glPost = require('../utils/glPost');

// ─── Sequential numbers ───────────────────────────────────────────
async function genQuotationNo() {
  const count = await prisma.quotation.count();
  return `QUO-${String(count + 1).padStart(6, '0')}`;
}
async function genInvNo() {
  const count = await prisma.invoice.count();
  return `INV-${String(count + 1).padStart(6, '0')}`;
}

// Compute subtotal/VAT and per-line amounts (VAT-inclusive base, like AR invoices)
function computeTotals(lines = []) {
  let subtotal = 0, vatAmount = 0;
  const processed = lines.map((l) => {
    const amt = Number(l.quantity) * Number(l.unitPrice);
    const v = l.vatCode === 'VAT' ? computeVAT(amt) : { base: amt, vat: 0, total: amt };
    subtotal += v.base; vatAmount += v.vat;
    return { ...l, amount: v.base };
  });
  return { subtotal, vatAmount, processed };
}

// ─── List ─────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { status, customerId, from, to, page = 1, limit = 20 } = req.query;
    const where = { businessId: req.businessId };
    if (status)     where.status     = status;
    if (customerId) where.customerId = Number(customerId);
    if (from || to) where.quotationDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) };

    const [data, total] = await Promise.all([
      prisma.quotation.findMany({
        where,
        include: { customer: { select: { name: true, customerCode: true } }, lines: true },
        orderBy: { quotationDate: 'desc' },
        skip: (Number(page) - 1) * Number(limit), take: Number(limit),
      }),
      prisma.quotation.count({ where }),
    ]);
    res.json({ data, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

// ─── Get one ──────────────────────────────────────────────────────
exports.get = async (req, res, next) => {
  try {
    const q = await prisma.quotation.findUnique({
      where: { id: Number(req.params.id) },
      include: { customer: true, lines: { include: { account: { select: { accountCode: true, accountName: true } } } } },
    });
    if (!q) throw createError('Quotation not found', 404);
    res.json(q);
  } catch (err) { next(err); }
};

// ─── Create ───────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { customerId, quotationDate, validUntil, description, lines } = req.body;
    const { subtotal, vatAmount, processed } = computeTotals(lines);
    const quotationNo = await genQuotationNo();

    const q = await prisma.quotation.create({
      data: {
        businessId: req.businessId,
        quotationNo, customerId: Number(customerId),
        quotationDate: new Date(quotationDate), validUntil: new Date(validUntil),
        description, subtotal, vatAmount, totalAmount: subtotal + vatAmount,
        lines: { create: processed.map((l) => ({
          accountId: Number(l.accountId), description: l.description,
          quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
        })) },
      },
      include: { customer: true, lines: true },
    });
    res.status(201).json(q);
  } catch (err) { next(err); }
};

// ─── Update (DRAFT only) ──────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.quotation.findUnique({ where: { id } });
    if (!existing) throw createError('Quotation not found', 404);
    if (existing.status !== 'DRAFT') throw createError('Only DRAFT quotations can be edited', 400);

    const { customerId, quotationDate, validUntil, description, lines } = req.body;
    const { subtotal, vatAmount, processed } = computeTotals(lines || []);

    await prisma.quotation.update({
      where: { id },
      data: {
        customerId:    customerId ? Number(customerId) : undefined,
        quotationDate: quotationDate ? new Date(quotationDate) : undefined,
        validUntil:    validUntil ? new Date(validUntil) : undefined,
        description,
        ...(Array.isArray(lines) ? { subtotal, vatAmount, totalAmount: subtotal + vatAmount } : {}),
      },
    });

    if (Array.isArray(lines)) {
      await prisma.quotationLine.deleteMany({ where: { quotationId: id } });
      if (processed.length) {
        await prisma.quotationLine.createMany({
          data: processed.map((l) => ({
            quotationId: id, accountId: Number(l.accountId), description: l.description,
            quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
          })),
        });
      }
    }

    const updated = await prisma.quotation.findUnique({ where: { id }, include: { customer: true, lines: true } });
    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Status transitions ───────────────────────────────────────────
const transition = (target, allowedFrom) => async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const q = await prisma.quotation.findUnique({ where: { id } });
    if (!q) throw createError('Quotation not found', 404);
    if (!allowedFrom.includes(q.status)) throw createError(`Cannot mark ${target} from ${q.status}`, 400);
    const updated = await prisma.quotation.update({ where: { id }, data: { status: target } });
    res.json(updated);
  } catch (err) { next(err); }
};
exports.send   = transition('SENT',     ['DRAFT']);
exports.accept = transition('ACCEPTED', ['DRAFT', 'SENT']);
exports.reject = transition('REJECTED', ['DRAFT', 'SENT']);

// ─── Delete (anything except CONVERTED) ───────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const q = await prisma.quotation.findUnique({ where: { id } });
    if (!q) throw createError('Quotation not found', 404);
    if (q.status === 'CONVERTED') throw createError('Cannot delete a converted quotation', 400);
    await prisma.quotation.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
};

// ─── Convert to AR Invoice ────────────────────────────────────────
exports.convert = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const q = await prisma.quotation.findUnique({ where: { id }, include: { lines: true, customer: true } });
    if (!q) throw createError('Quotation not found', 404);
    if (q.status === 'CONVERTED') throw createError('Quotation already converted to an invoice', 400);
    if (!q.lines.length)         throw createError('Quotation has no line items', 400);

    const { dueDate } = req.body;
    const invoiceNo = await genInvNo();
    const due = dueDate ? new Date(dueDate) : new Date(Date.now() + 30 * 86400000);

    const inv = await prisma.invoice.create({
      data: {
        businessId: q.businessId,
        invoiceNo, customerId: q.customerId,
        invoiceDate: new Date(), dueDate: due,
        description: q.description || `From quotation ${q.quotationNo}`,
        subtotal: q.subtotal, vatAmount: q.vatAmount, totalAmount: q.totalAmount,
        lines: { create: q.lines.map((l) => ({
          accountId: l.accountId, description: l.description,
          quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
        })) },
      },
      include: { customer: true, lines: true },
    });

    // ── Auto-post to GL (same as a normal AR invoice) ───────────────────────────
    const glLines = [
      { accountCode: '1100', debit: Number(inv.totalAmount), description: `AR — ${inv.customer.name} (${inv.invoiceNo})` },
      ...inv.lines.map((l) => ({ accountId: l.accountId, credit: Number(l.amount), description: l.description })),
      ...(Number(inv.vatAmount) > 0 ? [{ accountCode: '2030', credit: Number(inv.vatAmount), description: 'Output VAT' }] : []),
    ];
    await glPost.safePost({
      entryDate:   inv.invoiceDate,
      description: `AR Invoice — ${inv.customer.name} (${inv.invoiceNo}) [from ${q.quotationNo}]`,
      reference:   inv.invoiceNo,
      lines:       glLines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    await prisma.quotation.update({ where: { id }, data: { status: 'CONVERTED', convertedInvoiceId: inv.id } });

    res.status(201).json({ invoice: inv, quotationId: id });
  } catch (err) { next(err); }
};
