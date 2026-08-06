const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { dayRange, isValidDateStr } = require('../utils/dates');

// Split expense vouchers on the account the cash actually left from, NOT on
// voucher `type`. A reimbursement or direct payment settled out of the petty
// cash fund is a petty cash outflow; counting it against collections
// double-counts the peso. Rows created before `paymentAccountCode` existed fall
// back to the type-based default the GL posting used at the time.
const PETTY_CASH_ACCOUNTS = ['1011', '1012'];
const paidFromPettyCash = (v) =>
  PETTY_CASH_ACCOUNTS.includes(v.paymentAccountCode || (v.type === 'PETTY_CASH' ? '1011' : '1020'));

exports.paidFromPettyCash = paidFromPettyCash;

// ─── Auto-Calculate from existing transactions ────────────────────
exports.calculate = async (req, res, next) => {
  try {
    const { date } = req.query;
    if (!date) throw createError('date query param required (YYYY-MM-DD)', 400);
    if (!isValidDateStr(date)) throw createError('date must be a valid YYYY-MM-DD date', 400);

    const range = dayRange(date);

    const [invoices, arPayments, bills, apPayments, invTxns, expVouchers, pettyCashGL, pettyCashGcashGL, cashOnHandGL] = await Promise.all([
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
      // Petty Cash Fund – Cash (1011) movement on the selected date
      prisma.journalLine.aggregate({
        where: {
          entry: { businessId: req.businessId, status: 'POSTED', entryDate: range },
          account: { accountCode: '1011', businessId: req.businessId },
        },
        _sum: { debit: true, credit: true },
      }),
      // Petty Cash Fund – GCash (1012) movement on the selected date
      prisma.journalLine.aggregate({
        where: {
          entry: { businessId: req.businessId, status: 'POSTED', entryDate: range },
          account: { accountCode: '1012', businessId: req.businessId },
        },
        _sum: { debit: true, credit: true },
      }),
      // Cash on Hand (1010) movement on the selected date
      prisma.journalLine.aggregate({
        where: {
          entry: { businessId: req.businessId, status: 'POSTED', entryDate: range },
          account: { accountCode: '1010', businessId: req.businessId },
        },
        _sum: { debit: true, credit: true },
      }),
    ]);

    // ── Expense voucher split ────────────────────────────────────
    const paidVouchers    = expVouchers.filter(v => v.status === 'PAID');
    // Petty cash comes from a separate fund — does NOT affect daily collections net cash
    const paidPettyCash   = paidVouchers.filter(paidFromPettyCash);
    // Everything else IS an actual cash outflow from collections / bank
    const paidCashOutflow = paidVouchers.filter(v => !paidFromPettyCash(v));

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
    // Cash that LEFT each fund on the selected date. This report is a one-day
    // operational document — it never shows a balance, so nothing from an
    // adjacent day can appear on it. Running balances live in the Cash Position
    // report instead.
    const pettyCashOut      = Number(pettyCashGL._sum.credit      || 0);
    const pettyCashGcashOut = Number(pettyCashGcashGL._sum.credit || 0);
    const cashOnHandOut     = Number(cashOnHandGL._sum.credit     || 0);
    // 1012 is optional — hide the GCash card entirely for businesses that never
    // set the fund up rather than showing a phantom zero.
    const hasGcashFund = Number(pettyCashGcashGL._sum.debit || 0) > 0 || pettyCashGcashOut > 0;

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
      totalExpenses, pettyCashTotal,
      pettyCashOut,
      pettyCashGcashOut: hasGcashFund ? pettyCashGcashOut : null,
      cashOnHandOut, cashDisbursed, netCash,
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
      cashOnHandOut, pettyCashOut, pettyCashGcashOut,
      preparedBy, notes, items = [],
    } = req.body;

    if (!date) throw createError('date is required (YYYY-MM-DD)', 400);
    if (!isValidDateStr(date)) throw createError('date must be a valid YYYY-MM-DD date', 400);

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
        cashOnHandOut:     Number(cashOnHandOut     || 0),
        pettyCashOut:      Number(pettyCashOut      || 0),
        pettyCashGcashOut: Number(pettyCashGcashOut || 0),
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
      cashOnHandOut, pettyCashOut, pettyCashGcashOut,
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
        cashOnHandOut:     cashOnHandOut     != null ? Number(cashOnHandOut)     : undefined,
        pettyCashOut:      pettyCashOut      != null ? Number(pettyCashOut)      : undefined,
        pettyCashGcashOut: pettyCashGcashOut != null ? Number(pettyCashGcashOut) : undefined,
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
