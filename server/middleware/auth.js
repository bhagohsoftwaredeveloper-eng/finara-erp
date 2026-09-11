const jwt = require('jsonwebtoken');
const prisma = require('../config/database');

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
    select: { licenseStatus: true },
  });
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

    if (!headerBizId) {
      if (req.user?.role === 'SUPER_ADMIN') {
        req.businessId = 1;
        return next();
      }
      if (req.user?.role === 'ADMIN') {
        if (!(await assertLicenseActive(req, res, 1))) return;
        req.businessId = 1;
        return next();
      }
      const ub = await prisma.userBusiness.findFirst({
        where: { userId: req.user.id },
        orderBy: { businessId: 'asc' },
      });
      const bizId = ub?.businessId || 1;
      if (!(await assertLicenseActive(req, res, bizId))) return;
      req.businessId = bizId;
      return next();
    }

    if (req.user?.role === 'SUPER_ADMIN') {
      req.businessId = headerBizId;
      return next();
    }
    if (req.user?.role === 'ADMIN') {
      if (!(await assertLicenseActive(req, res, headerBizId))) return;
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
