const prisma = require('../config/database');
const logger = require('./logger');
const mailer = require('./mailer');
const { createError } = require('../middleware/errorHandler');

// Scheduled license suspension: a grace period for a client to pay.
// Business.suspendAt holds the moment the suspension takes effect while the license is
// still ACTIVE. Nothing has to run for the lock to happen: every license check goes through
// isDue()/applyDueSuspension(), and an hourly sweep (server/index.js) tidies up and sends the
// notice for businesses nobody has touched since.

const DAY_MS = 86400000;

// The effective date starts at midnight Manila time: the client keeps access for the whole
// day before it, and is locked out when the date arrives.
const effectiveInstant = (dateStr) => new Date(`${dateStr}T00:00:00+08:00`);

const isDue = (biz, now = new Date()) =>
  biz.licenseStatus === 'ACTIVE' && !!biz.suspendAt && new Date(biz.suspendAt) <= now;

// The effective date a super admin typed: blank or today-or-earlier means "suspend now".
function parseEffective(input, now = new Date()) {
  if (input === undefined || input === null || input === '') return { immediate: true };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input)) || Number.isNaN(Date.parse(`${input}T00:00:00Z`))) {
    throw createError('effectiveDate must be a date in YYYY-MM-DD format', 400);
  }
  const at = effectiveInstant(input);
  if (at <= now) return { immediate: true };
  if (at - now > 366 * DAY_MS) throw createError('effectiveDate cannot be more than a year away', 400);
  return { at, dateStr: String(input) };
}

const phDate = (d) => new Date(new Date(d).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);

// Turns a due scheduled suspension into a real one. The conditional updateMany is the
// race-safe guard: of several concurrent requests only one wins and writes the event.
async function applyDueSuspension(biz, now = new Date()) {
  const r = await prisma.business.updateMany({
    where: { id: biz.id, licenseStatus: 'ACTIVE', suspendAt: { lte: now } },
    data: { licenseStatus: 'SUSPENDED', suspendAt: null },
  });
  if (r.count === 0) return false;

  await prisma.licenseEvent.create({
    data: {
      businessId: biz.id, eventType: 'SUSPENDED', actorUserId: null,
      note: `Scheduled suspension took effect (effective ${biz.suspendAt ? phDate(biz.suspendAt) : 'date not recorded'})`,
    },
  });
  logger.info(`[license] business ${biz.id} suspended: scheduled suspension reached`);

  try {
    const requester = biz.createdByUserId ? await prisma.user.findUnique({ where: { id: biz.createdByUserId } }) : null;
    await mailer.sendLicenseSuspendedNotice({ ...biz, licenseStatus: 'SUSPENDED' }, requester);
  } catch (err) {
    logger.error(`[license] suspension notice for business ${biz.id} failed: ${err.message}`);
  }
  return true;
}

async function sweepDueSuspensions(now = new Date()) {
  const due = await prisma.business.findMany({
    where: { licenseStatus: 'ACTIVE', suspendAt: { lte: now } },
  });
  let applied = 0;
  for (const biz of due) if (await applyDueSuspension(biz, now)) applied += 1;
  return applied;
}

module.exports = { effectiveInstant, isDue, parseEffective, applyDueSuspension, sweepDueSuspensions };
