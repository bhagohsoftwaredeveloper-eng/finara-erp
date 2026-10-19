const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { parsePackageInput } = require('../utils/packageInput');

const ITEM_SELECT = { id: true, sku: true, name: true, unit: true, currentStock: true };
const INCLUDE = { items: { include: { item: { select: ITEM_SELECT } }, orderBy: { id: 'asc' } } };

// Every item must be one of this business's own (active) inventory items, and
// a revenue account, when given, must be an active REVENUE account.
async function assertOwned(businessId, data) {
  const found = await prisma.inventoryItem.findMany({
    where: { id: { in: data.items.map((i) => i.itemId) }, businessId, isActive: true },
    select: { id: true },
  });
  if (found.length !== data.items.length) throw createError('One or more items were not found in your inventory', 400);

  if (data.accountId) {
    const acct = await prisma.account.findFirst({
      where: { id: data.accountId, businessId, accountType: 'REVENUE', isActive: true },
      select: { id: true },
    });
    if (!acct) throw createError('The revenue account must be an active REVENUE account', 400);
  }
}

exports.list = async (req, res, next) => {
  try {
    const { active, search } = req.query;
    const where = { businessId: req.businessId };
    if (active !== undefined) where.isActive = active === 'true';
    if (search) where.name = { contains: String(search) };
    const rows = await prisma.package.findMany({ where, include: INCLUDE, orderBy: { name: 'asc' } });
    res.json(rows);
  } catch (err) { next(err); }
};

exports.get = async (req, res, next) => {
  try {
    const row = await prisma.package.findFirst({
      where: { id: Number(req.params.id), businessId: req.businessId },
      include: INCLUDE,
    });
    if (!row) throw createError('Package not found', 404);
    res.json(row);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const data = parsePackageInput(req.body);
    await assertOwned(req.businessId, data);
    const created = await prisma.package.create({
      data: {
        businessId: req.businessId,
        name: data.name, description: data.description, price: data.price,
        accountId: data.accountId, vatCode: data.vatCode,
        items: { create: data.items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })) },
      },
      include: INCLUDE,
    });
    res.status(201).json(created);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.package.findFirst({ where: { id, businessId: req.businessId }, select: { id: true } });
    if (!existing) throw createError('Package not found', 404);

    const data = parsePackageInput(req.body);
    await assertOwned(req.businessId, data);
    // Invoices keep their own snapshot of the contents, so replacing the items
    // here never changes an invoice already issued.
    const updated = await prisma.package.update({
      where: { id },
      data: {
        name: data.name, description: data.description, price: data.price,
        accountId: data.accountId, vatCode: data.vatCode,
        ...(typeof req.body.isActive === 'boolean' && { isActive: req.body.isActive }),
        items: { deleteMany: {}, create: data.items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })) },
      },
      include: INCLUDE,
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// Deactivate rather than delete: past invoices reference the package id.
exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await prisma.package.findFirst({ where: { id, businessId: req.businessId }, select: { id: true } });
    if (!existing) throw createError('Package not found', 404);
    await prisma.package.update({ where: { id }, data: { isActive: false } });
    res.json({ message: 'Package deactivated' });
  } catch (err) { next(err); }
};
