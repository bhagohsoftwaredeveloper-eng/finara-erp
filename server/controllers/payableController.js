const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { computeVAT } = require('../utils/phCompliance');
const glPost = require('../utils/glPost');
const logger = require('../utils/logger');
const { recordAudit } = require('../utils/audit');
const { AGING_BUCKETS, classifyUpcomingBucket } = require('../utils/apAgingBuckets');
const { differenceInCalendarDays } = require('date-fns');

const genBillNo = async () => {
  const count = await prisma.bill.count();
  return `BILL-${String(count + 1).padStart(6, '0')}`;
};
const genPayNo = async () => {
  const count = await prisma.paymentAP.count();
  return `PAP-${String(count + 1).padStart(6, '0')}`;
};

// Next sequential vendor code (VEN-001, VEN-002, …) per business
async function nextVendorCode(businessId) {
  const rows = await prisma.vendor.findMany({
    where: { businessId, vendorCode: { startsWith: 'VEN-' } },
    select: { vendorCode: true },
  });
  let max = 0;
  for (const { vendorCode } of rows) {
    const m = /^VEN-(\d+)$/.exec(vendorCode);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return 'VEN-' + String(max + 1).padStart(3, '0');
}

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
    const base = { businessId: req.businessId, name, tin, address, contactName, email, phone };

    if (vendorCode && vendorCode.trim()) {
      const vendor = await prisma.vendor.create({ data: { ...base, vendorCode: vendorCode.trim() } });
      return res.status(201).json(vendor);
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const code = await nextVendorCode(req.businessId);
        const vendor = await prisma.vendor.create({ data: { ...base, vendorCode: code } });
        return res.status(201).json(vendor);
      } catch (err) {
        if (err.code === 'P2002' && attempt < 4) continue;
        throw err;
      }
    }
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
    const { vendorId, billDate, dueDate, description, notes, lines } = req.body;

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
        description, notes, subtotal, vatAmount, totalAmount: subtotal + vatAmount,
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

exports.addBillItems = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { editDate, lines } = req.body;
    const bill = await prisma.bill.findUnique({ where: { id }, include: { vendor: true } });
    if (!bill || bill.businessId !== req.businessId) throw createError('Bill not found', 404);
    if (bill.status === 'PAID') throw createError('Cannot add items to a fully paid bill.', 400);
    if (bill.status === 'VOID') throw createError('Cannot add items to a voided bill.', 400);

    let incSubtotal = 0, incVat = 0;
    const processedLines = lines.map((l) => {
      const amt = Number(l.quantity) * Number(l.unitPrice);
      const v = l.vatCode === 'VAT' ? computeVAT(amt) : { base: amt, vat: 0, total: amt };
      incSubtotal += v.base;
      incVat += v.vat;
      return { ...l, amount: v.base };
    });
    const incTotal = incSubtotal + incVat;

    const updated = await prisma.bill.update({
      where: { id },
      data: {
        subtotal: { increment: incSubtotal },
        vatAmount: { increment: incVat },
        totalAmount: { increment: incTotal },
        lastEditedAt: new Date(editDate),
        lines: { create: processedLines.map((l) => ({
          accountId: Number(l.accountId), description: l.description,
          quantity: l.quantity, unitPrice: l.unitPrice, amount: l.amount, vatCode: l.vatCode,
        })) },
      },
      include: { vendor: true, lines: { include: { account: { select: { accountCode: true, accountName: true } } } } },
    });

    // ── Auto-post incremental GL entry ────────────────────────────────────────
    const glLines = [
      ...processedLines.map((l) => ({
        accountId:   Number(l.accountId),
        debit:       Number(l.amount),
        description: l.description,
      })),
      ...(incVat > 0 ? [{
        accountCode: '1330',
        debit:       incVat,
        description: 'Input VAT',
      }] : []),
      {
        accountCode: '2010',
        credit:      incTotal,
        description: `AP — ${bill.vendor.name} (${bill.billNo}) — item added`,
      },
    ];
    await glPost.safePost({
      entryDate:   editDate,
      description: `AP Bill Edit — ${bill.vendor.name} (${bill.billNo})`,
      reference:   bill.billNo,
      lines:       glLines,
      userId:      req.user?.id || 1,
      businessId:  req.businessId,
    });

    res.json(updated);
  } catch (err) { next(err); }
};

exports.voidBill = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const bill = await prisma.bill.findUnique({ where: { id } });
    if (!bill) throw createError('Bill not found', 404);
    if (bill.paidAmount > 0) throw createError('Cannot void a bill with payments. Reverse payments first.', 400);
    const updated = await prisma.bill.update({ where: { id }, data: { status: 'VOID' } });

    // Void every posted GL entry tied to this bill — a bill with items added
    // after creation (see addBillItems) can have more than one, all sharing
    // the same reference — otherwise a voided bill's expense/AP impact keeps
    // showing up in the Income Statement, Trial Balance, and Balance Sheet.
    const entries = await prisma.journalEntry.findMany({
      where: { businessId: bill.businessId, reference: bill.billNo, status: 'POSTED' },
    });
    for (const entry of entries) {
      try {
        await prisma.journalEntry.update({ where: { id: entry.id }, data: { status: 'VOIDED' } });
      } catch (err) {
        logger.error(`[BILL VOID — GL VOID FAILED] billNo=${bill.billNo} biz=${bill.businessId} entryId=${entry.id} — ${err.message}`);
        try {
          await recordAudit({
            action:     'GL_POST_FAILED',
            entity:     'JournalEntry',
            entityId:   String(entry.id),
            summary:    `Failed to void GL entry for voided bill ${bill.billNo} — ${err.message}`,
            user:       req.user?.id ? { id: req.user.id } : undefined,
            businessId: bill.businessId,
          });
        } catch { /* auditing must never break anything either */ }
      }
    }

    res.json(updated);
  } catch (err) { next(err); }
};

exports.agingReport = async (req, res, next) => {
  try {
    const today = new Date();
    const bills = await prisma.bill.findMany({
      where: { businessId: req.businessId, status: { in: ['OPEN','PARTIAL','OVERDUE'] } },
    });

    // Fetch vendor names separately (not via `include`) so a bill whose vendor
    // was deleted out from under it (orphaned FK) can't crash the whole report —
    // Prisma throws on `include` when a required relation resolves to null.
    const vendorIds = [...new Set(bills.map((b) => b.vendorId))];
    const vendors = await prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, name: true } });
    const vendorNames = Object.fromEntries(vendors.map((v) => [v.id, v.name]));

    const report = bills.map((b) => {
      const due = new Date(b.dueDate);
      const daysOverdue = Math.max(0, differenceInCalendarDays(today, due));
      const outstanding = Number(b.totalAmount) - Number(b.paidAmount);
      return {
        billNo: b.billNo, vendor: vendorNames[b.vendorId] || 'Unknown vendor',
        dueDate: b.dueDate, outstanding, daysOverdue,
        bucket: daysOverdue === 0 ? classifyUpcomingBucket(due, today)
          : daysOverdue <= 30  ? '1-30 days'
          : daysOverdue <= 60  ? '31-60 days'
          : daysOverdue <= 90  ? '61-90 days'
          : 'Over 90 days',
      };
    });

    const buckets = AGING_BUCKETS;
    const summary = Object.fromEntries(buckets.map((b) => [b, report.filter((r) => r.bucket === b).reduce((s, r) => s + r.outstanding, 0)]));
    res.json({ items: report, summary, total: report.reduce((s, r) => s + r.outstanding, 0) });
  } catch (err) { next(err); }
};
