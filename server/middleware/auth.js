const jwt = require('jsonwebtoken');
const prisma = require('../config/database');
const { canAccessBusinessData, defaultBusinessId } = require('../utils/businessAccess');
const { isDue, applyDueSuspension } = require('../utils/licenseSchedule');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// SUPER_ADMIN bypasses the license gate entirely; every other caller must
// resolve to an ACTIVE business or be rejected before req.businessId is
// trusted downstream.
async function assertLicenseActive(req, res, businessId) {
  const biz = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, email: true, createdByUserId: true, licenseStatus: true, suspendAt: true },
  });
  // A scheduled suspension whose date has arrived locks the business on first contact.
  if (biz && isDue(biz)) {
    await applyDueSuspension(biz).catch(() => {});
    biz.licenseStatus = 'SUSPENDED';
  }
  if (biz && biz.licenseStatus !== 'ACTIVE') {
    res.status(403).json({
      error: biz.licenseStatus === 'PENDING' ? 'License not yet activated' : 'Business license suspended',
    });
    return false;
  }
  return true;
}

// Resolves and validates businessId from x-business-id header.
// Must run AFTER authenticate. Attaches req.businessId.
// ADMIN users can access any business; others must be granted access via user_businesses.
const resolveBusiness = async (req, res, next) => {
  try {
    const headerBizId = Number(req.headers['x-business-id']);

    // ADMIN and SUPER_ADMIN are tenants like everyone else: they open only the
    // businesses they created or were granted. Role no longer opens a client's
    // books (the operator manages licenses from Settings > Businesses instead).
    const isAdminTier = req.user?.role === 'SUPER_ADMIN' || req.user?.role === 'ADMIN';

    if (!headerBizId) {
      if (isAdminTier) {
        const own = await defaultBusinessId(req.user, { activeOnly: req.user.role !== 'SUPER_ADMIN' });
        if (!own) return res.status(403).json({ error: 'Create your company to get started', code: 'NO_BUSINESS' });
        if (req.user.role !== 'SUPER_ADMIN' && !(await assertLicenseActive(req, res, own))) return;
        req.businessId = own;
        return next();
      }
      const ub = await prisma.userBusiness.findFirst({
        where: { userId: req.user.id },
        orderBy: { businessId: 'asc' },
      });
      // No business yet (e.g. a fresh self-signup): never fall back to another
      // tenant's data. The client sends these users to /onboarding.
      if (!ub) return res.status(403).json({ error: 'Create your company to get started', code: 'NO_BUSINESS' });
      const bizId = ub.businessId;
      if (!(await assertLicenseActive(req, res, bizId))) return;
      req.businessId = bizId;
      return next();
    }

    if (isAdminTier) {
      if (!(await canAccessBusinessData(req.user, headerBizId))) {
        return res.status(403).json({ error: 'Access denied to this business' });
      }
      // SUPER_ADMIN bypasses the license gate on their own companies
      if (req.user.role !== 'SUPER_ADMIN' && !(await assertLicenseActive(req, res, headerBizId))) return;
      req.businessId = headerBizId;
      return next();
    }

    // Non-admin: verify they have access to this business
    const ub = await prisma.userBusiness.findUnique({
      where: { userId_businessId: { userId: req.user.id, businessId: headerBizId } },
    });
    if (!ub) {
      return res.status(403).json({ error: 'Access denied to this business' });
    }
    if (!(await assertLicenseActive(req, res, headerBizId))) return;
    req.businessId = headerBizId;
    next();
  } catch (err) {
    // If user_businesses table doesn't exist yet (migration pending), default to business 1
    if (err.code === 'P2021' || err.message?.includes('user_businesses') || err.message?.includes('does not exist')) {
      req.businessId = 1;
      return next();
    }
    next(err);
  }
};

const authorize = (...roles) => (req, res, next) => {
  // SUPER_ADMIN is a hidden tier above ADMIN — it passes every role check
  // without needing to be listed explicitly at each call site.
  if (req.user?.role === 'SUPER_ADMIN') return next();
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

module.exports = { authenticate, authorize, resolveBusiness };
