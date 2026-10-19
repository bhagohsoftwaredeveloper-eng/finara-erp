const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { clearBusinessCache } = require('../utils/glPost');
const { cloneChartOfAccounts } = require('../utils/cloneChartOfAccounts');
const { resetDemoBusiness } = require('../../prisma/seedDemo');
const mailer = require('../utils/mailer');
const { recordAudit } = require('../utils/audit');
const { isDue, parseEffective, applyDueSuspension } = require('../utils/licenseSchedule');
const { readModules, writeModules } = require('./permissionsController');
const paymongo = require('../utils/paymongo');

const LICENSE_TRANSITIONS = {
  PENDING:   { ACTIVE: 'ACTIVATED' },
  SUSPENDED: { ACTIVE: 'REACTIVATED' },
  ACTIVE:    { SUSPENDED: 'SUSPENDED' },
};
const { COMPANY_TYPES, TAX_TYPES } = require('../utils/companyTypes');
const { provisionByType, rollbackBusiness, createProvisionedBusiness } = require('../utils/provisionBusiness');
const { assertBusinessAccess, assertBusinessDataAccess, canAccessBusinessData, ownedWhere } = require('../utils/businessAccess');

// ─── List businesses ─────────────────────────────────────────────
// Default (the business switcher, My Businesses): only companies this user
// created or was granted, for every role. A client's company is private to its
// owners, so the operator's switcher stays short and never lands in a client's
// books.
// ?scope=manage (SUPER_ADMIN only, Settings > Businesses): every company, for
// license and subscription administration. Each row carries `isOwned` so the UI
// only offers data-level actions (edit, user access) where they are allowed.
exports.list = async (req, res, next) => {
  try {
    if (req.query?.scope === 'manage') {
      if (req.user.role !== 'SUPER_ADMIN') throw createError('Insufficient permissions', 403);
      const all = await prisma.business.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
        include: { userBusinesses: { where: { userId: req.user.id }, select: { id: true } } },
      });
      // Locked businesses whose client asked to be activated again: the operator's to-do list.
      const lockedIds = all.filter((b) => b.licenseStatus !== 'ACTIVE').map((b) => String(b.id));
      const asks = lockedIds.length
        ? await prisma.auditLog.findMany({
            where: { entity: 'Business', action: 'REQUEST_ACTIVATION', entityId: { in: lockedIds } },
            orderBy: { createdAt: 'desc' },
            select: { entityId: true, createdAt: true, userEmail: true },
          })
        : [];
      const askFor = (id) => asks.find((a) => a.entityId === String(id));
      return res.json(all.map(({ userBusinesses, ...b }) => ({
        ...b,
        isOwned: b.createdByUserId === req.user.id || userBusinesses.length > 0,
        activationRequestedAt: askFor(b.id)?.createdAt || null,
        activationRequestedBy: askFor(b.id)?.userEmail || null,
      })));
    }

    let businesses;
    if (req.user.role === 'SUPER_ADMIN' || req.user.role === 'ADMIN') {
      businesses = await prisma.business.findMany({
        where: {
          isActive: true,
          // A SUPER_ADMIN still sees their own PENDING/SUSPENDED companies
          ...(req.user.role !== 'SUPER_ADMIN' && { licenseStatus: 'ACTIVE' }),
          ...ownedWhere(req.user),
        },
        orderBy: { name: 'asc' },
      });
    } else {
      const ubs = await prisma.userBusiness.findMany({
        where: { userId: req.user.id },
        include: { business: true },
      });
      businesses = ubs.map((ub) => ub.business).filter((b) => b.isActive && b.licenseStatus === 'ACTIVE');
    }
    res.json(businesses);
  } catch (err) { next(err); }
};

// ─── Get one ─────────────────────────────────────────────────────
// ─── Modules of any business, for the operator (SUPER_ADMIN) ─────────────────────
// The operator controls which modules a client business has without being able to open
// that business's books: these two endpoints touch only the module switches, by the id in
// the URL, and skip the data-access check that resolveBusiness applies to everything else.
async function businessForModules(req) {
  if (req.user?.role !== 'SUPER_ADMIN') throw createError('Insufficient permissions', 403);
  const business = await prisma.business.findUnique({ where: { id: Number(req.params.id) }, select: { id: true, name: true } });
  if (!business) throw createError('Business not found', 404);
  return business;
}

exports.getModules = async (req, res, next) => {
  try {
    const business = await businessForModules(req);
    res.json({ business, ...(await readModules(business.id)) });
  } catch (err) { next(err); }
};

exports.saveModules = async (req, res, next) => {
  try {
    const business = await businessForModules(req);
    const saved = await writeModules(business.id, req.body);
    await recordAudit({
      req, businessId: business.id, action: 'UPDATE', entity: 'Business', entityId: business.id,
      summary: `Modules of ${business.name} changed by the operator: ${saved.disabled.length ? `off: ${saved.disabled.join(', ')}` : 'all on'}`,
    });
    res.json({ business, message: 'Modules saved', ...saved });
  } catch (err) { next(err); }
};

exports.get = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await assertBusinessAccess(req.user, id);
    const biz = await prisma.business.findUnique({ where: { id } });
    if (!biz) throw createError('Business not found', 404);
    // A scheduled suspension whose date has arrived takes effect on first contact.
    if (isDue(biz) && (await applyDueSuspension(biz))) biz.licenseStatus = 'SUSPENDED';

    if (req.user.role !== 'SUPER_ADMIN' && biz.licenseStatus !== 'ACTIVE') {
      throw createError(
        biz.licenseStatus === 'PENDING' ? 'License not yet activated' : 'Business license suspended',
        403
      );
    }

    res.json(biz);
  } catch (err) { next(err); }
};

// ─── Shared by create() and onboard(): see ../utils/provisionBusiness ───
// ─── Create (ADMIN) ──────────────────────────────────────────────
// companyType is optional here for backwards compatibility: without it the
// business is created as before (cloned COA, no type-specific setup).
exports.create = async (req, res, next) => {
  try {
    const { code, name, tin, address, phone, email, companyType, taxType, booksStartDate } = req.body;
    if (!code || !name) throw createError('code and name are required', 400);
    if (companyType && !COMPANY_TYPES[companyType]) throw createError('Invalid company type', 400);
    if (taxType && !TAX_TYPES.includes(taxType)) throw createError('Invalid tax type', 400);

    const biz = await prisma.business.create({
      data: {
        code: code.toUpperCase(), name, tin, address, phone, email,
        industry: companyType ? COMPANY_TYPES[companyType].label : req.body.industry,
        taxType: taxType || null,
        booksStartDate: booksStartDate ? new Date(booksStartDate) : null,
        licenseStatus: 'PENDING',
        createdByUserId: req.user.id,
      },
    });

    try {
      // Auto-clone the default COA from business 1 into the new business
      await cloneChartOfAccounts(1, biz.id);
      if (companyType) await provisionByType(biz.id, companyType);

      // The creator owns it. Other admins are NOT granted automatically: a
      // company's books are private to its owners, so access is given
      // explicitly per user (Settings > Businesses > User Access).
      await prisma.userBusiness.createMany({
        data: [{ userId: req.user.id, businessId: biz.id }],
        skipDuplicates: true,
      });
    } catch (err) {
      await rollbackBusiness(biz.id);
      throw err;
    }

    await prisma.licenseEvent.create({
      data: { businessId: biz.id, eventType: 'CREATED', actorUserId: req.user.id },
    });

    // Fire-and-forget: sendMail never throws, so this never blocks the response.
    const superAdmins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' } });
    mailer.sendLicensePendingNotice(biz, req.user, superAdmins.map((u) => u.email));

    res.status(201).json(biz);
  } catch (err) { next(err); }
};

// ─── Self-service company creation (first business for a new account) ───
// Only for a user who has no business yet. Creates the company, clones the
// default COA, and grants ONLY this user access — the company is theirs alone.
exports.onboard = async (req, res, next) => {
  try {
    // A client's company is created from a paid order (POST /orders, proof,
    // then approval), never directly: otherwise signup would hand out free
    // companies. Only a SUPER_ADMIN may provision one outright.
    if (req.user.role !== 'SUPER_ADMIN') {
      throw Object.assign(
        createError('Payment is required to create your company. Place an order and submit your payment.', 402),
        { code: 'PAYMENT_REQUIRED' },
      );
    }
    const { name, tin, address, phone, companyType, taxType, booksStartDate } = req.body;
    if (!name || !String(name).trim()) throw createError('Company name is required', 400);
    if (!COMPANY_TYPES[companyType]) throw createError('Choose a company type', 400);
    if (!TAX_TYPES.includes(taxType)) throw createError('Choose a tax type (VAT or Non-VAT)', 400);

    const already = await prisma.userBusiness.findFirst({ where: { userId: req.user.id }, select: { id: true } });
    if (already) throw createError('You already have a company', 409);

    const biz = await createProvisionedBusiness({
      name, tin, address, phone, email: req.user.email,
      companyType, taxType, booksStartDate, ownerUserId: req.user.id,
    });
    res.status(201).json(biz);
  } catch (err) { next(err); }
};

// ─── Update ──────────────────────────────────────────────────────
exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await assertBusinessDataAccess(req.user, id);
    const { name, tin, address, phone, email, industry, isActive, taxType, booksStartDate } = req.body;
    if (taxType && !TAX_TYPES.includes(taxType)) throw createError('Invalid tax type', 400);
    const biz = await prisma.business.update({
      where: { id },
      data: {
        name, tin, address, phone, email, industry, isActive,
        // '' clears it; undefined (field not sent) leaves it alone.
        taxType: taxType === '' ? null : taxType,
        // Only touch the cutover date when the client actually sent it, so a
        // partial PUT can't silently wipe it. '' / null clears it on purpose.
        ...(booksStartDate !== undefined && { booksStartDate: booksStartDate ? new Date(booksStartDate) : null }),
      },
    });

    // Posting caches the cutover date — without this it honours the old one
    // until the process restarts.
    clearBusinessCache(id);

    res.json(biz);
  } catch (err) { next(err); }
};

// ─── License transition (manual, SUPER_ADMIN only) ────────────────
exports.updateLicense = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { status, note } = req.body;
    if (!['ACTIVE', 'SUSPENDED'].includes(status)) {
      throw createError('status must be ACTIVE or SUSPENDED', 400);
    }

    const biz = await prisma.business.findUnique({ where: { id } });
    if (!biz) throw createError('Business not found', 404);

    const eventType = LICENSE_TRANSITIONS[biz.licenseStatus]?.[status];
    if (!eventType) {
      throw createError(`Cannot transition license from ${biz.licenseStatus} to ${status}`, 400);
    }

    // Suspending with a future effective date is a grace period for the client to pay: the
    // license stays ACTIVE and is locked automatically when the date arrives.
    if (status === 'SUSPENDED') {
      const eff = parseEffective(req.body.effectiveDate);
      if (!eff.immediate) {
        const scheduled = await prisma.business.update({ where: { id }, data: { suspendAt: eff.at } });
        await prisma.licenseEvent.create({
          data: {
            businessId: id, eventType: 'SUSPENSION_SCHEDULED', actorUserId: req.user.id,
            note: `Suspension effective ${eff.dateStr}${note ? `. ${note}` : ''}`,
          },
        });
        const owner = biz.createdByUserId ? await prisma.user.findUnique({ where: { id: biz.createdByUserId } }) : null;
        mailer.sendLicenseSuspensionScheduledNotice(scheduled, owner, eff.dateStr);
        return res.json(scheduled);
      }
    }

    const isActivating = status === 'ACTIVE';
    const updated = await prisma.business.update({
      where: { id },
      data: isActivating
        ? { licenseStatus: status, licenseActivatedAt: new Date(), licenseActivatedBy: req.user.id }
        : { licenseStatus: status, ...(biz.suspendAt && { suspendAt: null }) },
    });

    await prisma.licenseEvent.create({
      data: { businessId: id, eventType, note: note || null, actorUserId: req.user.id },
    });

    const requester = biz.createdByUserId
      ? await prisma.user.findUnique({ where: { id: biz.createdByUserId } })
      : null;
    if (isActivating) mailer.sendLicenseActivatedNotice(updated, requester);
    else mailer.sendLicenseSuspendedNotice(updated, requester);

    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Locked businesses (the "license suspended" screen) ──────────────
// The businesses this user created or was granted whose license is not ACTIVE, which the
// switcher hides. For each: what is owed, the order being paid (if any) and whether
// activation was already requested. Skips resolveBusiness so it works while locked out.
const OPEN_ORDER = ['PENDING_PAYMENT', 'PROOF_SUBMITTED'];

exports.listLocked = async (req, res, next) => {
  try {
    const rows = await prisma.business.findMany({
      where: { isActive: true, ...ownedWhere(req.user) },
      orderBy: { name: 'asc' },
    });
    const locked = [];
    for (const biz of rows) {
      if (isDue(biz) && (await applyDueSuspension(biz).catch(() => false))) biz.licenseStatus = 'SUSPENDED';
      if (biz.licenseStatus !== 'ACTIVE') locked.push(biz);
    }

    const out = [];
    for (const biz of locked) {
      const [last, openOrder, requested] = await Promise.all([
        prisma.businessOrder.findFirst({ where: { businessId: biz.id }, orderBy: { createdAt: 'desc' } }),
        prisma.businessOrder.findFirst({ where: { businessId: biz.id, status: { in: OPEN_ORDER } }, orderBy: { createdAt: 'desc' } }),
        prisma.auditLog.findFirst({
          where: { entity: 'Business', entityId: String(biz.id), action: 'REQUEST_ACTIVATION' },
          orderBy: { createdAt: 'desc' },
        }),
      ]);
      const price = last
        ? await prisma.planPrice.findUnique({ where: { companyType_period: { companyType: last.companyType, period: last.period } } })
        : null;
      out.push({
        id: biz.id, name: biz.name, code: biz.code, licenseStatus: biz.licenseStatus, paidUntil: biz.paidUntil,
        period: last?.period || null,
        amountDue: openOrder ? openOrder.amount : (price?.isActive ? price.amount : null),
        openOrder: openOrder
          ? { id: openOrder.id, orderNo: openOrder.orderNo, status: openOrder.status, amount: openOrder.amount, period: openOrder.period, companyName: openOrder.companyName, mine: openOrder.userId === req.user.id }
          : null,
        activationRequestedAt: requested?.createdAt || null,
      });
    }
    res.json(out);
  } catch (err) { next(err); }
};

// The client asks the operator to activate a locked business again (for example after paying
// outside the app). Recorded in the audit log and mailed to the SUPER_ADMINs; once a day at most.
exports.requestActivation = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await assertBusinessAccess(req.user, id);
    const biz = await prisma.business.findUnique({ where: { id } });
    if (!biz) throw createError('Business not found', 404);
    if (biz.licenseStatus === 'ACTIVE') throw createError('This business is already active', 409);

    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const recent = await prisma.auditLog.findFirst({
      where: { entity: 'Business', entityId: String(id), action: 'REQUEST_ACTIVATION', createdAt: { gte: since } },
    });
    if (recent) throw createError('Activation was already requested today. We will get back to you.', 409);

    await recordAudit({ req, action: 'REQUEST_ACTIVATION', entity: 'Business', entityId: id, businessId: id, summary: `Requested activation of "${biz.name}"` });
    const superAdmins = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN' } });
    mailer.sendActivationRequestNotice(biz, req.user, superAdmins.map((u) => u.email));
    res.json({ requestedAt: new Date() });
  } catch (err) { next(err); }
};

// Cancel a scheduled suspension (SUPER_ADMIN): the client paid, or it was a mistake.
exports.cancelScheduledSuspension = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const biz = await prisma.business.findUnique({ where: { id } });
    if (!biz) throw createError('Business not found', 404);
    if (!biz.suspendAt) throw createError('No suspension is scheduled for this business', 400);

    const updated = await prisma.business.update({ where: { id }, data: { suspendAt: null } });
    await prisma.licenseEvent.create({
      data: { businessId: id, eventType: 'SUSPENSION_CANCELLED', note: req.body?.note || null, actorUserId: req.user.id },
    });
    res.json(updated);
  } catch (err) { next(err); }
};

// ─── Payment link generation (ADMIN, online path) ──────────────────
exports.generatePaymentLink = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const amount = Number(req.body.amount);
    if (!amount || amount <= 0) throw createError('amount must be a positive number', 400);

    const biz = await prisma.business.findUnique({ where: { id } });
    if (!biz) throw createError('Business not found', 404);
    if (biz.licenseStatus === 'ACTIVE') throw createError('Business license is already active', 400);
    if (!paymongo.isConfigured()) {
      throw createError('Online payment not configured — use manual activation', 400);
    }

    const link = await paymongo.createPaymentLink({
      amount,
      description: req.body.description || `Finara license — ${biz.name}`,
      businessId: id,
    });

    const updated = await prisma.business.update({
      where: { id },
      data: {
        paymentLinkId: link.id,
        paymentLinkUrl: link.url,
        paymentLinkAmount: amount,
        paymentLinkGeneratedAt: new Date(),
      },
    });

    await prisma.licenseEvent.create({
      data: { businessId: id, eventType: 'PAYMENT_LINK_GENERATED', amount, actorUserId: req.user.id },
    });

    res.json({ paymentLinkUrl: updated.paymentLinkUrl });
  } catch (err) { next(err); }
};

// ─── Reset the demo account only ──────────────────────────────────
// Always resolves the target by the fixed DEMO business code — never by a
// client-supplied id — so this can never be pointed at a real business.
// Wipes all demo transactional data and rebuilds a clean baseline: Chart of
// Accounts, demo login, and sample customers/vendors/employees. AR/AP are
// left empty on purpose so a live demo starts from a blank slate.
exports.resetDemo = async (req, res, next) => {
  try {
    const { business } = await resetDemoBusiness({ withTransactions: false });
    res.json({
      message: `Demo account reset. "${business.name}" now has a fresh Chart of Accounts and sample customers/vendors/employees — no invoices or bills.`,
      business,
    });
  } catch (err) { next(err); }
};

// ─── User access management ──────────────────────────────────────
// Who may open a business is staff administration, not its books: the operator (SUPER_ADMIN)
// manages it for every business, while ADMINs only for their own. The operator still cannot
// grant THEMSELVES a client's business, which would open that client's books.
exports.listUsers = async (req, res, next) => {
  try {
    const bizId = Number(req.params.id);
    await assertBusinessAccess(req.user, bizId);
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
    await assertBusinessAccess(req.user, bizId);
    const userId = Number(req.body.userId);
    if (req.user.role === 'SUPER_ADMIN' && userId === req.user.id && !(await canAccessBusinessData(req.user, bizId))) {
      throw createError("A client's books stay private: you can add their staff, but not yourself", 403);
    }
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
    await assertBusinessAccess(req.user, bizId);
    const userId = Number(req.params.userId);
    await prisma.userBusiness.deleteMany({ where: { userId, businessId: bizId } });
    res.json({ message: 'Access revoked' });
  } catch (err) { next(err); }
};
