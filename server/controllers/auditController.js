const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { canAccessBusinessData, defaultBusinessId } = require('../utils/businessAccess');

// The audit trail of one company: what happened in it, plus the sign-ins (which belong to
// no company) of the people who work in it. The operator (SUPER_ADMIN) sees everything.
async function scopeFor(req) {
  if (req.user.role === 'SUPER_ADMIN') return null;
  const header = Number(req.headers['x-business-id']);
  const bizId = header || (await defaultBusinessId(req.user));
  if (!bizId || !(await canAccessBusinessData(req.user, bizId))) throw createError('Access denied to this business', 403);

  const [members, biz] = await Promise.all([
    prisma.userBusiness.findMany({ where: { businessId: bizId }, select: { userId: true } }),
    prisma.business.findUnique({ where: { id: bizId }, select: { createdByUserId: true } }),
  ]);
  const memberIds = members.map((m) => m.userId);
  if (biz?.createdByUserId) memberIds.push(biz.createdByUserId);
  return { OR: [{ businessId: bizId }, { businessId: null, userId: { in: memberIds } }] };
}

exports.list = async (req, res, next) => {
  try {
    const { action, entity, entityId, userId, from, to, search, page = 1, limit = 50 } = req.query;
    const scope = await scopeFor(req);
    const where = scope ? { AND: [scope] } : {};
    if (action) where.action = action;
    if (entity) where.entity = entity;
    if (entityId) where.entityId = String(entityId);
    if (userId) where.userId = Number(userId);
    if (from || to) {
      where.createdAt = {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(`${to}T23:59:59.999Z`) }),
      };
    }
    if (search) {
      const match = { OR: [
        { summary: { contains: search } },
        { userEmail: { contains: search } },
        { entityId: { contains: search } },
      ] };
      where.AND = [...(where.AND || []), match];
    }

    const [data, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (Number(page) - 1) * Number(limit),
        take: Number(limit),
      }),
      prisma.auditLog.count({ where }),
    ]);

    res.json({ data, total, page: Number(page), pages: Math.ceil(total / Number(limit)) });
  } catch (err) { next(err); }
};

// Distinct values for filter dropdowns
exports.filters = async (req, res, next) => {
  try {
    const scope = await scopeFor(req);
    const where = scope || {};
    const [actions, entities] = await Promise.all([
      prisma.auditLog.findMany({ where, distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
      prisma.auditLog.findMany({ where, distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
    ]);
    res.json({
      actions: actions.map((a) => a.action),
      entities: entities.map((e) => e.entity),
    });
  } catch (err) { next(err); }
};
