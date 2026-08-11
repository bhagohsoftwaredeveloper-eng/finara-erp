const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { computeVAT, round2 } = require('../utils/phCompliance');
const { nextDocNumber } = require('../utils/docNumber');
const { buildCashSaleEntry } = require('../utils/cashSale');
const { nextTxnNo } = require('./inventoryController');
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
        orderBy: [{ saleDate: 'desc' }, { id: 'desc' }],
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
    const sale = await prisma.cashSale.findFirst({
      where: { id: Number(req.params.id), businessId: req.businessId },
      include: { account: true, journalEntry: { include: { lines: true } } },
    });
    if (!sale) throw createError('Cash sale not found', 404);
    res.json(sale);
  } catch (err) { next(err); }
};

// ─── Create ──────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { saleDate, buyerName, description, accountId, vatCode = 'VAT', amount, paymentMethod, notes, itemId, quantity } = req.body;
    if (!accountId) throw createError('accountId is required', 400);
    if (!description) throw createError('description is required', 400);
    if (!Number(amount) || Number(amount) <= 0) throw createError('amount must be greater than 0', 400);
    if (!paymentMethod) throw createError('paymentMethod is required', 400);

    const account = await prisma.account.findFirst({
      where: { id: Number(accountId), businessId: req.businessId, accountType: 'REVENUE', isActive: true },
    });
    if (!account) throw createError('accountId must be an active REVENUE account', 400);

    let item = null;
    let qty = 0;
    if (itemId) {
      qty = Number(quantity);
      if (!qty || qty <= 0) throw createError('quantity must be greater than 0', 400);
      item = await prisma.inventoryItem.findFirst({
        where: { id: Number(itemId), businessId: req.businessId, isActive: true },
      });
      if (!item) throw createError('Inventory item not found', 404);
      if (Number(item.currentStock) < qty) {
        throw createError(`Insufficient stock — only ${item.currentStock} ${item.unit} available`, 400);
      }
    }

    const cleanAmount = round2(Number(amount));
    // Compute vat first (backed out of the VAT-inclusive total) and derive
    // base as total - vat, so base + vat === total by construction. Using
    // computeVAT()'s independently-rounded base + remainder vat can be off
    // by a centavo (e.g. ₱24.50 → base 21.88 + vat 2.63 = 24.51 ≠ 24.50),
    // which misbalances the GL entry built from these figures. Do not swap
    // this back to computeVAT(cleanAmount, true) — see cash sale VAT rounding
    // regression test in tests/cashSaleController.test.js.
    const v = vatCode === 'VAT'
      ? (() => {
          const vat = round2(cleanAmount - cleanAmount / 1.12);
          return { base: round2(cleanAmount - vat), vat, total: cleanAmount };
        })()
      : { base: cleanAmount, vat: 0, total: cleanAmount };
    const saleNo = await genSaleNo();

    const saleData = {
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
    };

    let sale, totalCost = 0;
    if (item) {
      const newStock = round2(Number(item.currentStock) - qty);
      const unitCost = Number(item.costPrice);
      totalCost = round2(qty * unitCost);
      const txnNo = await nextTxnNo();

      const [saleRow] = await prisma.$transaction([
        prisma.cashSale.create({ data: saleData }),
        prisma.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } }),
        prisma.inventoryTransaction.create({
          data: {
            txnNo,
            itemId: item.id,
            type: 'OUT',
            quantity: qty,
            unitCost,
            totalCost,
            runningStock: newStock,
            reference: saleNo,
            notes: `Cash sale — ${saleNo}`,
            txnDate: new Date(saleDate),
          },
        }),
      ]);
      sale = saleRow;
    } else {
      sale = await prisma.cashSale.create({ data: saleData });
    }

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

    if (item && totalCost > 0) {
      const cogsLine = item.cogsAccountId
        ? { accountId: item.cogsAccountId, debit: totalCost, description: `COGS — ${item.sku} ×${qty}` }
        : { accountCode: '5010', debit: totalCost, description: `COGS — ${item.sku} ×${qty}` };
      const invLine = item.inventoryAccountId
        ? { accountId: item.inventoryAccountId, credit: totalCost, description: `Inventory out — ${item.name}` }
        : { accountCode: '1210', credit: totalCost, description: `Inventory out — ${item.name}` };
      await glPost.safePost({
        entryDate: sale.saleDate,
        description: `Inventory OUT — ${item.name} (${saleNo})`,
        reference: saleNo,
        lines: [cogsLine, invLine],
        userId: req.user?.id || 1,
        businessId: req.businessId,
      });
    }

    res.status(201).json({ ...sale, journalEntryId: entry?.id || null, posted: !!entry?.id });
  } catch (err) { next(err); }
};

// ─── Void ────────────────────────────────────────────────────────
exports.voidSale = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body;
    if (!reason || !reason.trim()) throw createError('A void reason is required', 400);

    const sale = await prisma.cashSale.findFirst({ where: { id, businessId: req.businessId } });
    if (!sale) throw createError('Cash sale not found', 404);
    if (sale.status === 'VOID') throw createError('Cash sale is already voided', 400);

    const outTxn = await prisma.inventoryTransaction.findFirst({
      where: { reference: sale.saleNo, type: 'OUT' },
    });
    const item = outTxn ? await prisma.inventoryItem.findFirst({ where: { id: outTxn.itemId } }) : null;

    let newStock, txnNo;
    if (item) {
      newStock = round2(Number(item.currentStock) + Number(outTxn.quantity));
      txnNo = await nextTxnNo();
    }

    await prisma.$transaction([
      prisma.cashSale.update({
        where: { id },
        data: { status: 'VOID', voidedReason: reason, voidedAt: new Date() },
      }),
      ...(sale.journalEntryId
        ? [prisma.journalEntry.update({ where: { id: sale.journalEntryId }, data: { status: 'VOIDED' } })]
        : []),
      ...(item ? [
        prisma.inventoryItem.update({ where: { id: item.id }, data: { currentStock: newStock } }),
        prisma.inventoryTransaction.create({
          data: {
            txnNo,
            itemId: item.id,
            type: 'RETURN_IN',
            quantity: outTxn.quantity,
            unitCost: outTxn.unitCost,
            totalCost: outTxn.totalCost,
            runningStock: newStock,
            reference: sale.saleNo,
            notes: `Void reversal — ${sale.saleNo}`,
            txnDate: new Date(),
          },
        }),
      ] : []),
    ]);

    if (item) {
      const totalCost = Number(outTxn.totalCost);
      if (totalCost > 0) {
        const invLine = item.inventoryAccountId
          ? { accountId: item.inventoryAccountId, debit: totalCost, description: `Inventory in — ${item.name} (void)` }
          : { accountCode: '1210', debit: totalCost, description: `Inventory in — ${item.name} (void)` };
        const cogsLine = item.cogsAccountId
          ? { accountId: item.cogsAccountId, credit: totalCost, description: `COGS reversal — ${item.sku} (void)` }
          : { accountCode: '5010', credit: totalCost, description: `COGS reversal — ${item.sku} (void)` };
        await glPost.safePost({
          entryDate: new Date(),
          description: `Cash sale void — ${item.name} (${sale.saleNo})`,
          reference: sale.saleNo,
          lines: [invLine, cogsLine],
          userId: req.user?.id || 1,
          businessId: req.businessId,
        });
      }
    }

    res.json({ message: `Cash sale ${sale.saleNo} voided` });
  } catch (err) { next(err); }
};
