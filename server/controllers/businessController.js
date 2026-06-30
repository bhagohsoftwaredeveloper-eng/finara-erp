const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');

// ─── List all businesses the current user can access ─────────────
exports.list = async (req, res, next) => {
  try {
    let businesses;
    if (req.user.role === 'ADMIN') {
      businesses = await prisma.business.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
    } else {
      const ubs = await prisma.userBusiness.findMany({
        where: { userId: req.user.id },
        include: { business: true },
      });
      businesses = ubs.map((ub) => ub.business).filter((b) => b.isActive);
    }
    res.json(businesses);
  } catch (err) { next(err); }
};

// ─── Get one ─────────────────────────────────────────────────────
exports.get = async (req, res, next) => {
  try {
    const biz = await prisma.business.findUnique({ where: { id: Number(req.params.id) } });
    if (!biz) throw createError('Business not found', 404);
    res.json(biz);
  } catch (err) { next(err); }
};

// ─── Create ──────────────────────────────────────────────────────
exports.create = async (req, res, next) => {
  try {
    const { code, name, tin, address, phone, email, industry } = req.body;
    if (!code || !name) throw createError('code and name are required', 400);

    const biz = await prisma.business.create({
      data: { code: code.toUpperCase(), name, tin, address, phone, email, industry },
    });

    // Auto-clone the default COA from business 1 into the new business
    const sourceAccounts = await prisma.account.findMany({
      where: { businessId: 1 },
      orderBy: { accountCode: 'asc' },
    });

    if (sourceAccounts.length > 0) {
      // Insert in two passes: first without parentId, then update parentId
      const idMap = {}; // old id → new id

      // Pass 1: insert roots (no parent)
      for (const acc of sourceAccounts.filter((a) => !a.parentId)) {
        const newAcc = await prisma.account.create({
          data: {
            businessId:   biz.id,
            accountCode:  acc.accountCode,
            accountName:  acc.accountName,
            accountType:  acc.accountType,
            normalBalance:acc.normalBalance,
            description:  acc.description,
            isActive:     acc.isActive,
          },
        });
        idMap[acc.id] = newAcc.id;
      }

      // Pass 2: insert children with mapped parentId
      for (const acc of sourceAccounts.filter((a) => a.parentId)) {
        const newAcc = await prisma.account.create({
          data: {
            businessId:   biz.id,
            accountCode:  acc.accountCode,
            accountName:  acc.accountName,
            accountType:  acc.accountType,
            normalBalance:acc.normalBalance,
            parentId:     idMap[acc.parentId] || null,
            description:  acc.description,
            isActive:     acc.isActive,
          },
        });
        idMap[acc.id] = newAcc.id;
      }
    }

    // Grant all ADMIN users access to the new business
    const admins = await prisma.user.findMany({ where: { role: 'ADMIN' } });
    await prisma.userBusiness.createMany({
      data: admins.map((u) => ({ userId: u.id, businessId: biz.id })),
      skipDuplicates: true,
    });

    res.status(201).json(biz);
  } catch (err) { next(err); }
};

// ─── Update ──────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, tin, address, phone, email, industry, isActive } = req.body;
    const biz = await prisma.business.update({
      where: { id },
      data: { name, tin, address, phone, email, industry, isActive },
    });
    res.json(biz);
  } catch (err) { next(err); }
};

// ─── User access management ──────────────────────────────────────
exports.listUsers = async (req, res, next) => {
  try {
    const bizId = Number(req.params.id);
    const ubs = await prisma.userBusiness.findMany({
      where: { businessId: bizId },
      include: { user: { select: { id: true, firstName: true, lastName: true, email: true, role: true } } },
    });
    res.json(ubs.map((ub) => ub.user));
  } catch (err) { next(err); }
};

exports.grantUser = async (req, res, next) => {
  try {
    const bizId  = Number(req.params.id);
    const userId = Number(req.body.userId);
    await prisma.userBusiness.upsert({
      where:  { userId_businessId: { userId, businessId: bizId } },
      create: { userId, businessId: bizId },
      update: {},
    });
    res.json({ message: 'Access granted' });
  } catch (err) { next(err); }
};

exports.revokeUser = async (req, res, next) => {
  try {
    const bizId  = Number(req.params.id);
    const userId = Number(req.params.userId);
    await prisma.userBusiness.deleteMany({ where: { userId, businessId: bizId } });
    res.json({ message: 'Access revoked' });
  } catch (err) { next(err); }
};
