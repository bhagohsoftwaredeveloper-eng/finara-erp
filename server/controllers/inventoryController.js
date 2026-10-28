const prisma = require('../config/database');
const glPost = require('../utils/glPost');
const { recordAudit } = require('../utils/audit');
const {
  packagingFromBody, COLUMNS, MAX_ROWS, TEMPLATE_ROW, findHeaderRow, guessMapping, validateMapping,
  readRows, planImport, toPlanItem, exportRow, nextSkuNumber, formatSku,
} = require('../utils/inventoryImport');

// ── Helpers ──────────────────────────────────────────────────────────────────
function pad(n, len = 6) { return String(n).padStart(len, '0'); }

// Next sequential SKU (SKU-0001, SKU-0002, …) per business
async function nextSku(businessId) {
  const rows = await prisma.inventoryItem.findMany({
    where: { businessId, sku: { startsWith: 'SKU-' } },
    select: { sku: true },
  });
  return formatSku(nextSkuNumber(rows.map((r) => r.sku)));
}

async function nextTxnNo() {
  const last = await prisma.inventoryTransaction.findFirst({ orderBy: { id: 'desc' } });
  const seq  = last ? last.id + 1 : 1;
  return `INV-TXN-${pad(seq)}`;
}
exports.nextTxnNo = nextTxnNo;

// ── Categories ────────────────────────────────────────────────────────────────
exports.listCategories = async (req, res, next) => {
  try {
    const cats = await prisma.inventoryCategory.findMany({
      where: { businessId: req.businessId, isActive: true },
      include: { _count: { select: { items: true } } },
      orderBy: { name: 'asc' },
    });
    res.json(cats);
  } catch (e) { next(e); }
};

exports.createCategory = async (req, res, next) => {
  const { name, type = 'PRODUCT', description } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  try {
    const cat = await prisma.inventoryCategory.create({ data: { businessId: req.businessId, name, type, description } });
    res.status(201).json(cat);
  } catch (e) { next(e); }
};

exports.updateCategory = async (req, res, next) => {
  const { id } = req.params;
  const { name, type, description, isActive } = req.body;
  try {
    // Tenant guard: the category must belong to the caller's business.
    const owned = await prisma.inventoryCategory.findFirst({
      where: { id: Number(id), businessId: req.businessId },
      select: { id: true },
    });
    if (!owned) return res.status(404).json({ error: 'Category not found' });

    const cat = await prisma.inventoryCategory.update({
      where: { id: Number(id) },
      data: { name, type, description, ...(isActive !== undefined && { isActive }) },
    });
    res.json(cat);
  } catch (e) { next(e); }
};

exports.deleteCategory = async (req, res, next) => {
  const { id } = req.params;
  try {
    // Tenant guard: the category must belong to the caller's business.
    const owned = await prisma.inventoryCategory.findFirst({
      where: { id: Number(id), businessId: req.businessId },
      select: { id: true },
    });
    if (!owned) return res.status(404).json({ error: 'Category not found' });

    await prisma.inventoryCategory.update({
      where: { id: Number(id) },
      data: { isActive: false },
    });
    res.json({ message: 'Category deactivated' });
  } catch (e) { next(e); }
};

// ── Items ─────────────────────────────────────────────────────────────────────
exports.listItems = async (req, res, next) => {
  const { search, categoryId, type, lowStock, isActive } = req.query;
  try {
    const where = { businessId: req.businessId };
    if (isActive !== 'all') where.isActive = isActive === 'false' ? false : true;
    if (search) where.OR = [
      { name:        { contains: search } },
      { sku:         { contains: search } },
      { description: { contains: search } },
    ];
    if (categoryId) where.categoryId = Number(categoryId);
    if (type) where.category = { type };
    if (lowStock === 'true') {
      where.AND = [
        { currentStock: { lte: prisma.inventoryItem.fields.reorderLevel } },
      ];
    }

    const items = await prisma.inventoryItem.findMany({
      where,
      include: {
        category:          { select: { id: true, name: true, type: true } },
        inventoryAccount:  { select: { id: true, accountCode: true, accountName: true } },
        cogsAccount:       { select: { id: true, accountCode: true, accountName: true } },
        revenueAccount:    { select: { id: true, accountCode: true, accountName: true } },
        _count:            { select: { transactions: true } },
      },
      orderBy: { name: 'asc' },
    });

    // Compute derived fields
    const enriched = items.map((i) => ({
      ...i,
      stockValue: Number(i.currentStock) * Number(i.costPrice),
      isLowStock: Number(i.currentStock) <= Number(i.reorderLevel),
      isOutOfStock: Number(i.currentStock) <= 0,
    }));

    res.json(enriched);
  } catch (e) { next(e); }
};

exports.getItem = async (req, res, next) => {
  try {
    const item = await prisma.inventoryItem.findFirst({
      where: { id: Number(req.params.id), businessId: req.businessId },
      include: {
        category:         { select: { id: true, name: true, type: true } },
        inventoryAccount: { select: { id: true, accountCode: true, accountName: true } },
        cogsAccount:      { select: { id: true, accountCode: true, accountName: true } },
        revenueAccount:   { select: { id: true, accountCode: true, accountName: true } },
        transactions:     { orderBy: { txnDate: 'desc' }, take: 20 },
      },
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json({
      ...item,
      stockValue:   Number(item.currentStock) * Number(item.costPrice),
      isLowStock:   Number(item.currentStock) <= Number(item.reorderLevel),
      isOutOfStock: Number(item.currentStock) <= 0,
    });
  } catch (e) { next(e); }
};

exports.createItem = async (req, res, next) => {
  const {
    sku, name, description, categoryId,
    unit = 'pcs', costPrice = 0, sellingPrice = 0,
    reorderLevel = 0, warehouseLocation,
    inventoryAccountId, cogsAccountId, revenueAccountId,
  } = req.body;
  if (!name) return res.status(400).json({ error: 'Name is required' });
  let packaging;
  try { packaging = packagingFromBody(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const finalSku = (sku && sku.trim()) ? sku.trim() : await nextSku(req.businessId);
    const item = await prisma.inventoryItem.create({
      data: {
        businessId: req.businessId,
        sku: finalSku, name, description, unit,
        costPrice:    Number(costPrice),
        sellingPrice: Number(sellingPrice),
        reorderLevel: Number(reorderLevel),
        warehouseLocation,
        categoryId:         categoryId        ? Number(categoryId)        : null,
        inventoryAccountId: inventoryAccountId ? Number(inventoryAccountId) : null,
        cogsAccountId:      cogsAccountId      ? Number(cogsAccountId)      : null,
        revenueAccountId:   revenueAccountId   ? Number(revenueAccountId)   : null,
        ...packaging,
      },
      include: {
        category:         true,
        inventoryAccount: true,
        cogsAccount:      true,
        revenueAccount:   true,
      },
    });
    res.status(201).json(item);
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ error: 'SKU already exists' });
    next(e);
  }
};

exports.updateItem = async (req, res, next) => {
  const { id } = req.params;
  const {
    sku, name, description, categoryId,
    unit, costPrice, sellingPrice, reorderLevel, warehouseLocation,
    inventoryAccountId, cogsAccountId, revenueAccountId, isActive,
  } = req.body;
  let packaging;
  try { packaging = packagingFromBody(req.body, { partial: true }); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    // Tenant guard: the item must belong to the caller's business.
    const owned = await prisma.inventoryItem.findFirst({
      where: { id: Number(id), businessId: req.businessId },
      select: { id: true },
    });
    if (!owned) return res.status(404).json({ error: 'Item not found' });

    const item = await prisma.inventoryItem.update({
      where: { id: Number(id) },
      data: {
        ...(sku             !== undefined && { sku }),
        ...(name            !== undefined && { name }),
        ...(description     !== undefined && { description }),
        ...(unit            !== undefined && { unit }),
        ...(costPrice       !== undefined && { costPrice:    Number(costPrice) }),
        ...(sellingPrice    !== undefined && { sellingPrice: Number(sellingPrice) }),
        ...(reorderLevel    !== undefined && { reorderLevel: Number(reorderLevel) }),
        ...(warehouseLocation !== undefined && { warehouseLocation }),
        ...(isActive        !== undefined && { isActive }),
        categoryId:         categoryId        !== undefined ? (categoryId        ? Number(categoryId)        : null) : undefined,
        inventoryAccountId: inventoryAccountId !== undefined ? (inventoryAccountId ? Number(inventoryAccountId) : null) : undefined,
        cogsAccountId:      cogsAccountId      !== undefined ? (cogsAccountId      ? Number(cogsAccountId)      : null) : undefined,
        revenueAccountId:   revenueAccountId   !== undefined ? (revenueAccountId   ? Number(revenueAccountId)   : null) : undefined,
        ...packaging,
      },
      include: {
        category:         true,
        inventoryAccount: true,
        cogsAccount:      true,
        revenueAccount:   true,
      },
    });
    res.json(item);
  } catch (e) {
    if (e.code === 'P2002') return res.status(400).json({ error: 'SKU already exists' });
    next(e);
  }
};

exports.deleteItem = async (req, res, next) => {
  const { id } = req.params;
  try {
    // Tenant guard: the item must belong to the caller's business.
    const owned = await prisma.inventoryItem.findFirst({
      where: { id: Number(id), businessId: req.businessId },
      select: { id: true },
    });
    if (!owned) return res.status(404).json({ error: 'Item not found' });

    await prisma.inventoryItem.update({
      where: { id: Number(id) },
      data: { isActive: false },
    });
    res.json({ message: 'Item deactivated' });
  } catch (e) { next(e); }
};

// ── Bulk upload / download ────────────────────────────────────────────────────
// Every rule lives in utils/inventoryImport.js; these handlers only load the
// business's items and categories and write the plan.
const ITEM_COLUMNS = {
  id: true, sku: true, name: true, isActive: true, unit: true, description: true,
  costPrice: true, sellingPrice: true, reorderLevel: true, warehouseLocation: true,
  weightPerPackKg: true, packsPerCase: true, pcsPerPack: true,
  category: { select: { name: true } },
};

exports.importItems = async (req, res, next) => {
  try {
    const { grid, mapping: chosen, dryRun = false } = req.body || {};
    if (!Array.isArray(grid) || grid.length === 0) return res.status(400).json({ error: 'The file is empty.' });

    const headerIndex = findHeaderRow(grid);
    if (headerIndex < 0) {
      return res.status(400).json({ error: "Couldn't find the header row. The file needs column names such as Product Code and Item Name." });
    }
    const header = (grid[headerIndex] || []).map((c) => String(c ?? '').trim());
    const mapping = chosen ?? guessMapping(header);
    const mappingError = validateMapping(mapping, header);
    if (mappingError) return res.status(400).json({ error: mappingError });

    const rows = readRows(grid, headerIndex, mapping);
    if (!rows.length) return res.status(400).json({ error: 'There are no items below the header row.' });
    if (rows.length > MAX_ROWS) return res.status(400).json({ error: `Upload at most ${MAX_ROWS} items at a time.` });

    const [items, categories] = await Promise.all([
      prisma.inventoryItem.findMany({ where: { businessId: req.businessId }, select: ITEM_COLUMNS }),
      prisma.inventoryCategory.findMany({
        where: { businessId: req.businessId, isActive: true },
        select: { id: true, name: true },
      }),
    ]);
    const plan = planImport(rows, items.map(toPlanItem), categories, nextSkuNumber(items.map((i) => i.sku)));
    const result = {
      header,
      mapping,
      fields: COLUMNS,
      ignoredHeaders: header.filter((h, i) => h && !mapping[i]),
      summary: plan.summary,
      newCategories: plan.newCategories,
      rows: plan.rows,
    };

    if (dryRun) return res.json(result);
    if (plan.summary.errors) {
      const n = plan.summary.errors;
      return res.status(422).json({ error: `${n} row${n === 1 ? ' has' : 's have'} errors. Nothing was imported.`, ...result });
    }

    const catIds = new Map(categories.map((c) => [c.name.trim().toLowerCase(), c.id]));
    await prisma.$transaction(async (tx) => {
      for (const name of plan.newCategories) {
        const cat = await tx.inventoryCategory.create({ data: { businessId: req.businessId, name, type: 'PRODUCT' } });
        catIds.set(name.trim().toLowerCase(), cat.id);
      }
      const categoryId = (name) => (name ? catIds.get(name.trim().toLowerCase()) ?? null : null);
      if (plan.creates.length) {
        await tx.inventoryItem.createMany({
          data: plan.creates.map(({ category, ...fields }) => ({
            ...fields, businessId: req.businessId, categoryId: categoryId(category),
          })),
        });
      }
      for (const { id, data } of plan.updates) {
        const { category, ...fields } = data;
        await tx.inventoryItem.updateMany({
          where: { id, businessId: req.businessId },
          data: { ...fields, ...(category !== undefined && { categoryId: categoryId(category) }) },
        });
      }
    }, { timeout: 60000 });

    const done = {
      created: plan.creates.length,
      updated: plan.updates.length,
      unchanged: plan.summary.unchanged,
      categoriesCreated: plan.newCategories.length,
    };
    await recordAudit({
      req, action: 'IMPORT', entity: 'InventoryItem',
      summary: `Imported inventory items: ${done.created} created, ${done.updated} updated, `
        + `${done.categoriesCreated} categor${done.categoriesCreated === 1 ? 'y' : 'ies'} added`,
    });
    res.json(done);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'Items changed while importing. Check the file again.' });
    next(e);
  }
};

exports.exportItems = async (req, res, next) => {
  try {
    if (req.query.template === '1') return res.json({ columns: COLUMNS, rows: [TEMPLATE_ROW] });
    const items = await prisma.inventoryItem.findMany({
      where: { businessId: req.businessId, isActive: true },
      select: ITEM_COLUMNS,
      orderBy: { name: 'asc' },
    });
    res.json({ columns: COLUMNS, rows: items.map(exportRow) });
  } catch (e) { next(e); }
};

// ── Transactions ──────────────────────────────────────────────────────────────
exports.listTransactions = async (req, res, next) => {
  const { itemId, type, from, to, search, limit = 100, offset = 0 } = req.query;
  try {
    const where = { item: { businessId: req.businessId } };
    if (itemId) where.itemId = Number(itemId);
    if (type)   where.type   = type;
    if (from || to) {
      where.txnDate = {};
      if (from) where.txnDate.gte = new Date(from);
      if (to)   where.txnDate.lte = new Date(to);
    }
    if (search) where.OR = [
      { txnNo:    { contains: search } },
      { reference:{ contains: search } },
      { notes:    { contains: search } },
    ];

    const [txns, total] = await prisma.$transaction([
      prisma.inventoryTransaction.findMany({
        where,
        include: { item: { select: { id: true, sku: true, name: true, unit: true } } },
        orderBy: [{ txnDate: 'desc' }, { id: 'desc' }],
        take:  Number(limit),
        skip:  Number(offset),
      }),
      prisma.inventoryTransaction.count({ where }),
    ]);

    res.json({ data: txns, total });
  } catch (e) { next(e); }
};

exports.createTransaction = async (req, res, next) => {
  const {
    itemId, type, quantity, unitCost = 0,
    reference, notes, txnDate,
  } = req.body;

  // An ADJUSTMENT quantity is the counted stock, so 0 (nothing left) is valid.
  const hasQty = quantity !== undefined && quantity !== null && quantity !== '';
  if (!itemId || !type || !hasQty)
    return res.status(400).json({ error: 'itemId, type, and quantity are required' });

  const validTypes = ['IN', 'OUT', 'ADJUSTMENT', 'RETURN_IN', 'RETURN_OUT'];
  if (!validTypes.includes(type))
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });

  const qty = Number(quantity);
  if (!Number.isFinite(qty) || qty < 0) return res.status(400).json({ error: 'Quantity must be 0 or more' });
  if (qty === 0 && type !== 'ADJUSTMENT') return res.status(400).json({ error: 'Quantity cannot be zero' });

  try {
    // Tenant guard: the item must belong to the caller's business.
    const item = await prisma.inventoryItem.findFirst({
      where: { id: Number(itemId), businessId: req.businessId },
    });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    // Determine stock delta
    let delta = qty;
    if (['OUT', 'RETURN_OUT'].includes(type)) delta = -qty;
    if (type === 'ADJUSTMENT') delta = qty - Number(item.currentStock); // absolute target

    if (type === 'ADJUSTMENT' && delta === 0) {
      return res.status(400).json({ error: 'Counted quantity matches current stock — nothing to adjust' });
    }

    const newStock   = Number(item.currentStock) + delta;
    const cost       = Number(unitCost);
    const totalCost  = Math.abs(delta) * cost;
    const txnNo      = await nextTxnNo();
    const date       = txnDate ? new Date(txnDate) : new Date();

    const [txn] = await prisma.$transaction([
      prisma.inventoryTransaction.create({
        data: {
          txnNo,
          itemId: Number(itemId),
          type,
          quantity: qty,
          unitCost: cost,
          totalCost,
          runningStock: newStock,
          reference,
          notes,
          txnDate: date,
          createdBy: req.user?.firstName ? `${req.user.firstName} ${req.user.lastName}` : 'System',
        },
        include: { item: { select: { id: true, sku: true, name: true, unit: true } } },
      }),
      prisma.inventoryItem.update({
        where: { id: Number(itemId) },
        data: {
          currentStock: newStock,
          ...(type === 'IN' && cost > 0 && { costPrice: cost }),
        },
      }),
    ]);

    // ── Auto-post to GL ──────────────────────────────────────────────────────
    // Only post when there's a cost value (free adjustments with no cost skip GL)
    if (totalCost > 0) {
      if (['IN', 'RETURN_IN'].includes(type)) {
        // Stock received: DR Inventory, CR AP Trade (assume on account) or Cash
        await glPost.safePost({
          entryDate:   date,
          description: `Inventory IN — ${item.name} (${txn.txnNo})`,
          reference:   txn.txnNo,
          lines: [
            { accountCode: '1210', debit:  totalCost, description: `Stock in — ${item.sku} ×${Math.abs(delta)}` },
            { accountCode: '2010', credit: totalCost, description: `Inventory payable — ${item.name}` },
          ],
          userId:     req.user?.id || 1,
          businessId: req.businessId,
        });
      } else if (['OUT', 'RETURN_OUT'].includes(type)) {
        // Stock out / sold: DR COGS, CR Inventory
        await glPost.safePost({
          entryDate:   date,
          description: `Inventory OUT — ${item.name} (${txn.txnNo})`,
          reference:   txn.txnNo,
          lines: [
            { accountCode: '5010', debit:  totalCost, description: `COGS — ${item.sku} ×${Math.abs(delta)}` },
            { accountCode: '1210', credit: totalCost, description: `Inventory out — ${item.name}` },
          ],
          userId:     req.user?.id || 1,
          businessId: req.businessId,
        });
      }
      // ADJUSTMENT type: no GL post (manual balance correction; accountant handles separately)
    }

    res.status(201).json(txn);
  } catch (e) {
    if (e.code === 'P2025') return res.status(404).json({ error: 'Item not found' });
    next(e);
  }
};

// ── Reports ───────────────────────────────────────────────────────────────────
// ?from=&to= turn the snapshot into a period view: stock as of `to` (today when
// omitted) plus opening / in / out for the range. Balances come from each
// transaction's runningStock, so an adjustment's delta is its change in stock.
const dayStart = (s) => new Date(`${s}T00:00:00.000Z`);
const nextDay  = (s) => new Date(dayStart(s).getTime() + 24 * 60 * 60 * 1000);

async function periodBalances(itemIds, from, to) {
  const txns = await prisma.inventoryTransaction.findMany({
    where: {
      itemId: { in: itemIds },
      ...(to && { txnDate: { lt: nextDay(to) } }),
    },
    select: { itemId: true, txnDate: true, runningStock: true },
    orderBy: [{ itemId: 'asc' }, { txnDate: 'asc' }, { id: 'asc' }],
  });
  const out = new Map(); // itemId -> { opening, closing, qtyIn, qtyOut }
  const fromTs = from ? dayStart(from).getTime() : null;
  const endTs  = to ? nextDay(to).getTime() : null;
  for (const t of txns) {
    if (endTs !== null && t.txnDate.getTime() >= endTs) continue;
    const b = out.get(t.itemId) || { opening: 0, closing: 0, qtyIn: 0, qtyOut: 0 };
    const after = Number(t.runningStock);
    const delta = after - b.closing;
    if (fromTs !== null && t.txnDate.getTime() < fromTs) {
      b.opening = after;
    } else if (delta >= 0) {
      b.qtyIn += delta;
    } else {
      b.qtyOut += -delta;
    }
    b.closing = after;
    out.set(t.itemId, b);
  }
  return out;
}

exports.stockOnHand = async (req, res, next) => {
  const { categoryId, type, from, to } = req.query;
  try {
    const where = { isActive: true, businessId: req.businessId };
    if (categoryId) where.categoryId = Number(categoryId);
    if (type) where.category = { type };

    const items = await prisma.inventoryItem.findMany({
      where,
      include: { category: { select: { id: true, name: true, type: true } } },
      orderBy: { name: 'asc' },
    });

    const ranged = Boolean(from || to);
    const balances = ranged && items.length
      ? await periodBalances(items.map((i) => i.id), from, to)
      : new Map();
    const today = new Date().toISOString().slice(0, 10);

    const enriched = items.map((i) => {
      const b = balances.get(i.id) || { opening: 0, closing: 0, qtyIn: 0, qtyOut: 0 };
      // Up to today the live figure is authoritative; an earlier `to` uses the ledger.
      const stock = ranged && to && to < today ? b.closing : Number(i.currentStock);
      return {
        id:        i.id,
        sku:       i.sku,
        name:      i.name,
        unit:      i.unit,
        category:  i.category,
        costPrice: Number(i.costPrice),
        sellingPrice: Number(i.sellingPrice),
        currentStock: stock,
        reorderLevel: Number(i.reorderLevel),
        stockValue:   stock * Number(i.costPrice),
        isLowStock:   stock <= Number(i.reorderLevel),
        isOutOfStock: stock <= 0,
        ...(ranged && { openingStock: b.opening, qtyIn: b.qtyIn, qtyOut: b.qtyOut }),
      };
    });

    const summary = {
      totalItems:   enriched.length,
      totalValue:   enriched.reduce((s, i) => s + i.stockValue, 0),
      lowStock:     enriched.filter((i) => i.isLowStock && !i.isOutOfStock).length,
      outOfStock:   enriched.filter((i) => i.isOutOfStock).length,
    };

    res.json({ summary, items: enriched });
  } catch (e) { next(e); }
};

exports.valuationReport = async (req, res, next) => {
  const { categoryId } = req.query;
  try {
    const where = { isActive: true, businessId: req.businessId };
    if (categoryId) where.categoryId = Number(categoryId);

    const items = await prisma.inventoryItem.findMany({
      where,
      include: { category: { select: { name: true, type: true } } },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    });

    // Group by category
    const groups = {};
    for (const i of items) {
      const cat = i.category?.name || 'Uncategorized';
      if (!groups[cat]) groups[cat] = { category: cat, type: i.category?.type, items: [], subtotal: 0 };
      const val = Number(i.currentStock) * Number(i.costPrice);
      groups[cat].items.push({
        sku: i.sku, name: i.name, unit: i.unit,
        qty: Number(i.currentStock), costPrice: Number(i.costPrice), value: val,
      });
      groups[cat].subtotal += val;
    }

    const grandTotal = Object.values(groups).reduce((s, g) => s + g.subtotal, 0);
    res.json({ groups: Object.values(groups), grandTotal });
  } catch (e) { next(e); }
};

exports.lowStockReport = async (req, res, next) => {
  try {
    const items = await prisma.$queryRaw`
      SELECT i.id, i.sku, i.name, i.unit,
             CAST(i.currentStock AS DECIMAL(12,3)) AS currentStock,
             CAST(i.reorderLevel AS DECIMAL(12,3)) AS reorderLevel,
             CAST(i.costPrice    AS DECIMAL(15,2)) AS costPrice,
             c.name AS categoryName, c.type AS categoryType
      FROM inventory_items i
      LEFT JOIN inventory_categories c ON c.id = i.categoryId
      WHERE i.isActive = 1
        AND i.businessId = ${req.businessId}
        AND i.currentStock <= i.reorderLevel
      ORDER BY (i.reorderLevel - i.currentStock) DESC
    `;
    res.json(items);
  } catch (e) { next(e); }
};

exports.movementSummary = async (req, res, next) => {
  const { from, to } = req.query;
  try {
    const where = { item: { businessId: req.businessId } };
    if (from || to) {
      where.txnDate = {};
      if (from) where.txnDate.gte = new Date(from);
      if (to)   where.txnDate.lte = new Date(to);
    }

    const txns = await prisma.inventoryTransaction.findMany({
      where,
      include: { item: { select: { sku: true, name: true, unit: true } } },
    });

    // Aggregate per item
    const map = {};
    for (const t of txns) {
      const key = t.itemId;
      if (!map[key]) map[key] = {
        itemId: t.itemId, sku: t.item.sku, name: t.item.name, unit: t.item.unit,
        totalIn: 0, totalOut: 0, totalAdj: 0, totalCostIn: 0, totalCostOut: 0, txnCount: 0,
      };
      const qty = Number(t.quantity);
      const cost = Number(t.totalCost);
      map[key].txnCount++;
      if (['IN', 'RETURN_IN'].includes(t.type))  { map[key].totalIn  += qty; map[key].totalCostIn  += cost; }
      if (['OUT', 'RETURN_OUT'].includes(t.type)) { map[key].totalOut += qty; map[key].totalCostOut += cost; }
      if (t.type === 'ADJUSTMENT') map[key].totalAdj += qty;
    }

    res.json(Object.values(map).sort((a, b) => a.name.localeCompare(b.name)));
  } catch (e) { next(e); }
};
