const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');

// A user's DATA tenancy: the businesses they created or were explicitly
// granted. This applies to every role, ADMIN and SUPER_ADMIN included, so the
// operator can never open a client's books just because of their role. Client
// companies still show up for license management (see businessController.list
// with scope=manage), but their data stays private to their owners.
const ownedWhere = (user) => ({
  OR: [
    { createdByUserId: user.id },
    { userBusinesses: { some: { userId: user.id } } },
  ],
});

const isAdminTier = (user) => user.role === 'ADMIN' || user.role === 'SUPER_ADMIN';

async function canAccessBusinessData(user, businessId) {
  if (isAdminTier(user)) {
    const n = await prisma.business.count({
      where: { id: Number(businessId), isActive: true, ...ownedWhere(user) },
    });
    return n > 0;
  }
  // Everyone else: an explicit grant
  const ub = await prisma.userBusiness.findUnique({
    where: { userId_businessId: { userId: user.id, businessId: Number(businessId) } },
  });
  return !!ub;
}

// The first business this user may open, lowest id first (their default)
async function defaultBusinessId(user, { activeOnly = false } = {}) {
  const biz = await prisma.business.findFirst({
    where: { isActive: true, ...(activeOnly && { licenseStatus: 'ACTIVE' }), ...ownedWhere(user) },
    orderBy: { id: 'asc' },
    select: { id: true },
  });
  return biz ? biz.id : null;
}

// Throws unless the user may open this business's DATA (books, people, settings).
async function assertBusinessDataAccess(user, businessId) {
  if (!(await canAccessBusinessData(user, businessId))) {
    throw createError('Access denied to this business', 403);
  }
}

// Shared by endpoints that read a business's own record (name, license status,
// plan) rather than its books. SUPER_ADMIN may read any business here: that is
// how licenses and orders are administered. Everyone else needs data access.
async function assertBusinessAccess(user, businessId) {
  if (user.role === 'SUPER_ADMIN') return;
  await assertBusinessDataAccess(user, businessId);
}

module.exports = {
  ownedWhere, canAccessBusinessData, defaultBusinessId,
  assertBusinessDataAccess, assertBusinessAccess,
};
