const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');

// ─── Helper: build date range for a single calendar day ──────────
function dayRange(dateStr) {
  // dateStr = 'YYYY-MM-DD'
  // Use ISO midnight so Prisma / MySQL interprets correctly regardless of server TZ
  const start = new Date(`${dateStr}T00:00:00.000Z`);
  const end   = new Date(`${dateStr}T23:59:59.999Z`);
  return { gte: start, lte: end };
}

// ─── Auto-Calculate from existing transactions ────────────────────
exports.calculate = async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) throw createError('date query param required (YYYY-MM-DD)', 400);

    const range = dayRange(date);

    const [invoices, arPayments, bills, apPayments, invTxns, expVouchers, pettyCashGL] = await Promise.all([
      prisma.invoice.findMany({
        where: { businessId: req.businessId, invoiceDate: range },
        include: { customer: { select: { name: true, customerCode: true } } },
        orderBy: { invoiceNo: 'asc' },
      }),
      prisma.paymentAR.findMany({
        where: { invoice: { businessId: req.businessId }, paymentDate: range },
        include: { invoice: { include: { customer: { select: { name: true } } } } },
        orderBy: { paymentNo: 'asc' },
      }),
      prisma.bill.findMany({
        where: { businessId: req.businessId, billDate: range },
        include: { vendor: { select: { name: true, vendorCode: true } } },
        orderBy: { billNo: 'asc' },
      }),
      prisma.paymentAP.findMany({
        where: { bill: { businessId: req.businessId }, paymentDate: range },
        include: { bill: { include: { vendor: { select: { name: true } } } } },
        orderBy: { paymentNo: 'asc' },
      }),
      prisma.inventoryTransaction.findMany({
        where: { item: { businessId: req.businessId }, txnDate: range },
        include: { item: { select: { name: true, sku: true } } },
        orderBy: { txnNo: 'asc' },
      }),
      // Expense vouchers APPROVED or PAID on this date
      prisma.expenseVoucher.findMany({
        where: { businessId: req.businessId, date: range, status: { in: ['APPROVED', 'PAID'] } },
        orderBy: { voucherNo: 'asc' },
      }),
      // Petty Cash Fund (1011) running balance from all POSTED GL entries
      prisma.journalLine.aggregate({
        where: {
          entry: { businessId: req.businessId, status: 'POSTED' },
          account: { accountCode: '1011', businessId: req.businessId },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);

    // ── Expense voucher split ────────────────────────────────────
    const paidVouchers    = expVouchers.filter(v => v.status === 'PAID');
    // Petty cash comes from a separate fund — does NOT affect daily collections net cash
    const paidPettyCash   = paidVouchers.filter(v => v.type === 'PETTY_CASH');
    // Direct payments, reimbursements, etc. ARE actual cash outflows from collections
    const paidCashOutflow = paidVouchers.filter(v => v.type !== 'PETTY_CASH');

    // ── Totals ──────────────────────────────────────────────────
    const totalSales     = invoices.reduce((s, i) => s + Number(i.totalAmount), 0);
    const vatCollected   = invoices.reduce((s, i) => s + Number(i.vatAmount),   0);
    const cashReceived   = arPayments.reduce((s, p) => s + Number(p.amount),    0);
    // totalExpenses = AP Bills + ALL approved/paid vouchers (informational card)
    const totalExpenses  = bills.reduce((s, b) => s + Number(b.totalAmount),    0)
                         + expVouchers.reduce((s, v) => s + Number(v.totalAmount), 0);
    // pettyCashTotal shown separately — from petty cash fund, not from collections
    const pettyCashTotal = paidPettyCash.reduce((s, v) => s + Number(v.totalAmount), 0);
    // cashDisbursed = AP Payments + non-petty-cash PAID vouchers only
    const cashDisbursed  = apPayments.reduce((s, p) => s + Number(p.amount),    0)
                         + paidCashOutflow.reduce((s, v) => s + Number(v.totalAmount), 0);
    // netCash = what should be physically remitted from daily collections
    const netCash        = cashReceived - cashDisbursed;
    // Petty Cash Fund running balance (1011): total debits − total credits on POSTED entries
    const pcDebits       = Number(pettyCashGL._sum.debit  || 0);
    const pcCredits      = Number(pettyCashGL._sum.credit || 0);
    const pettyCashBalance = pcDebits - pcCredits;

    // ── Detail line items ────────────────────────────────────────
    const items = [
      // Sales invoices issued today
      ...invoices.map(i => ({
        category:    'SALES',
        reference:   i.invoiceNo,
        description: `Invoice — ${i.customer.name}`,
        amount:      Number(i.totalAmount),
        meta:        JSON.stringify({ customer: i.customer.name, subtotal: Number(i.subtotal), vat: Number(i.vatAmount), status: i.status }),
      })),
      // AR collections received today
      ...arPayments.map(p => ({
        category:    'COLLECTION',
        reference:   p.paymentNo,
        description: `Collection — ${p.invoice.customer.name} (${p.invoice.invoiceNo})`,
        amount:      Number(p.amount),
        meta:        JSON.stringify({ customer: p.invoice.customer.name, invoice: p.invoice.invoiceNo, method: p.paymentMethod }),
      })),
      // Bills / expenses incurred today
      ...bills.map(b => ({
        category:    'EXPENSE',
        reference:   b.billNo,
        description: `Bill — ${b.vendor.name}`,
        amount:      Number(b.totalAmount),
        meta:        JSON.stringify({ vendor: b.vendor.name, subtotal: Number(b.subtotal), vat: Number(b.vatAmount), status: b.status }),
      })),
      // AP disbursements made today
      ...apPayments.map(p => ({
        category:    'DISBURSEMENT',
        reference:   p.paymentNo,
        description: `Payment — ${p.bill.vendor.name} (${p.bill.billNo})`,
        amount:      Number(p.amount),
        meta:        JSON.stringify({ vendor: p.bill.vendor.name, bill: p.bill.billNo, method: p.paymentMethod }),
      })),
      // Inventory movements today
      ...invTxns.map(t => ({
        category:    'INVENTORY',
        reference:   t.txnNo,
        description: `${t.type} — ${t.item.name} (${t.item.sku}) × ${Number(t.quantity)}`,
        amount:      Number(t.totalCost),
        meta:        JSON.stringify({ sku: t.item.sku, item: t.item.name, type: t.type, qty: Number(t.quantity), unitCost: Number(t.unitCost) }),
      })),
      // Expense vouchers (APPROVED or PAID) — appear as EXPENSE items
      ...expVouchers.map(v => ({
        category:    'EXPENSE',
        reference:   v.voucherNo,
        description: `[${v.type.replace('_', ' ')}] ${v.payee} — ${v.purpose.slice(0, 80)}`,
        amount:      Number(v.totalAmount),
        meta:        JSON.stringify({ type: v.type, payee: v.payee, category: v.category, status: v.status, requestedBy: v.requestedBy }),
      })),
      // Non-petty-cash PAID vouchers appear as DISBURSEMENT (cash from collections)
      ...paidCashOutflow.map(v => ({
        category:    'DISBURSEMENT',
        reference:   v.voucherNo,
        description: `Paid — ${v.payee} (${v.voucherNo})`,
        amount:      Number(v.totalAmount),
        meta:        JSON.stringify({ type: v.type, payee: v.payee, category: v.category, paidBy: v.paidBy }),
      })),
      // Petty cash PAID vouchers shown separately — from petty fund, not from collections
      ...paidPettyCash.map(v => ({
        category:    'PETTY_CASH',
        reference:   v.voucherNo,
        description: `[Petty Cash] Paid — ${v.payee} (${v.voucherNo})`,
        amount:      Number(v.totalAmount),
        meta:        JSON.stringify({ type: v.type, payee: v.payee, category: v.category, paidBy: v.paidBy }),
      })),
    ];

    res.json({
      date,
      totalSales, vatCollected, cashReceived,
      totalExpenses, pettyCashTotal, pettyCashBalance, cashDisbursed, netCash,
      counts: {
        invoices:      invoices.length,
        collections:   arPayments.length,
        expenses:      bills.length + expVouchers.length,
        disbursements: apPayments.length + paidCashOutflow.length,
        pettyCash:     paidPettyCash.length,
        inventory:     invTxns.length,
        vouchers:      expVouchers.length,
      },
      items,
    });
  } catch (err) { next(err); }
};

// ─── List ─────────────────────────────────────────────────────────
exports.list = async (req, res, next) => {
  try {
    const { status, from, to } = req.query;
    const where = { businessId: req.businessId };
    if (status) where.status = status;
    if (from || to) {
      where.date = {};
      if (from) where.date.gte = new Date(from + 'T00:00:00.000Z');
      if (to)   where.date.lte = new Date(to   + 'T23:59:59.999Z');
    }
    const rows = await prisma.dailyRemittance.findMany({
      where,
      orderBy: { date: 'desc' },
      include: { _count: { select: { items: true } } },
    });
    res.json(rows);
  } catch (err) { next(err); }
};

// ─── Get One ──────────────────────────────────────────────────────
exports.get = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const row = await prisma.dailyRemittance.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!row) throw createError('Daily remittance not found', 404);
    res.json(row);
  } catch (err) { next(err); }
};

// ─── Create ───────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const {
      date, totalSales, vatCollected, cashReceived,
      totalExpenses, cashDisbursed, netCash,
      preparedBy, notes, items = [],
    } = req.body;

    // Check uniqueness
    const existing = await prisma.dailyRemittance.findFirst({
      where: { businessId: req.businessId, date: new Date(date + 'T00:00:00.000Z') },
    });
    if (existing) throw createError(`A daily remittance for ${date} already exists`, 409);

    const record = await prisma.dailyRemittance.create({
      data: {
        businessId:   req.businessId,
        date:         new Date(date + 'T00:00:00.000Z'),
        totalSales:   Number(totalSales   || 0),
        vatCollected: Number(vatCollected || 0),
        cashReceived: Number(cashReceived || 0),
        totalExpenses:Number(totalExpenses|| 0),
        cashDisbursed:Number(cashDisbursed|| 0),
        netCash:      Number(netCash      || 0),
        preparedBy,
        notes,
        items: {
          create: items.map(it => ({
            category:    it.category,
            reference:   it.reference   || null,
            description: it.description,
            amount:      Number(it.amount || 0),
            meta:        it.meta ? (typeof it.meta === 'string' ? it.meta : JSON.stringify(it.meta)) : null,
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
    const existing = await prisma.dailyRemittance.findUnique({ where: { id } });
    if (!existing) throw createError('Not found', 404);
    if (existing.status === 'APPROVED') throw createError('Cannot edit an approved record', 400);

    const {
      totalSales, vatCollected, cashReceived,
      totalExpenses, cashDisbursed, netCash,
      preparedBy, notes, items,
    } = req.body;

    await prisma.dailyRemittance.update({
      where: { id },
      data: {
        totalSales:    totalSales    != null ? Number(totalSales)    : undefined,
        vatCollected:  vatCollected  != null ? Number(vatCollected)  : undefined,
        cashReceived:  cashReceived  != null ? Number(cashReceived)  : undefined,
        totalExpenses: totalExpenses != null ? Number(totalExpenses) : undefined,
        cashDisbursed: cashDisbursed != null ? Number(cashDisbursed) : undefined,
        netCash:       netCash       != null ? Number(netCash)       : undefined,
        preparedBy, notes,
      },
    });

    if (Array.isArray(items)) {
      await prisma.dailyRemittanceItem.deleteMany({ where: { dailyRemittanceId: id } });
      if (items.length) {
        await prisma.dailyRemittanceItem.createMany({
          data: items.map(it => ({
            dailyRemittanceId: id,
            category:    it.category,
            reference:   it.reference   || null,
            description: it.description,
            amount:      Number(it.amount || 0),
            meta:        it.meta ? (typeof it.meta === 'string' ? it.meta : JSON.stringify(it.meta)) : null,
          })),
        });
      }
    }

    const updated = await prisma.dailyRemittance.findUnique({ where: { id }, include: { items: true } });
    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Submit ───────────────────────────────────────────────────────
exports.submit = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { preparedBy } = req.body;
    const updated = await prisma.dailyRemittance.update({
      where: { id },
      data: { status: 'SUBMITTED', preparedBy: preparedBy || undefined },
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Approve ──────────────────────────────────────────────────────
exports.approve = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { approvedBy } = req.body;
    const updated = await prisma.dailyRemittance.update({
      where: { id },
      data: { status: 'APPROVED', approvedBy: approvedBy || undefined },
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Delete (draft/submitted only) ───────────────────────────────
exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.dailyRemittance.findUnique({ where: { id } });
    if (!existing) throw createError('Not found', 404);
    if (existing.status === 'APPROVED') throw createError('Cannot delete an approved record', 400);
    await prisma.dailyRemittance.delete({ where: { id } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
};
