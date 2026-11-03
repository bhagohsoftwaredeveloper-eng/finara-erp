// Machine-to-machine API for locally installed copies of Finara. An installation registers its
// business here (it then shows up in Settings > Businesses as a PENDING license) and asks for its
// status; the operator activates it with the normal License button. Authenticated by a shared
// secret (INSTALL_API_KEY) in `x-api-key`, not by a user login.
const { timingSafeEqual } = require('crypto');
const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { isDue, applyDueSuspension } = require('../utils/licenseSchedule');

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,19}$/;
const MACHINE_RE = /^[0-9a-f]{32}\.[0-9a-f]{32}\.[0-9a-f]{32}$/i;

function requireApiKey(req) {
  const expected = process.env.INSTALL_API_KEY;
  if (!expected) throw createError('Installation licensing is not configured on this server.', 503);
  const given = Buffer.from(String(req.headers['x-api-key'] || ''));
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) throw createError('Invalid API key', 401);
}

function readIdentity(body) {
  const code = String(body.code || '').trim().toUpperCase();
  const machineId = String(body.machineId || '').trim().toLowerCase();
  if (!CODE_RE.test(code)) throw createError('A valid business code is required', 400);
  if (!MACHINE_RE.test(machineId)) throw createError('A valid machineId is required', 400);
  return { code, machineId };
}

// What the installation needs to know: is it licensed right now?
async function statusOf(biz) {
  if (isDue(biz) && (await applyDueSuspension(biz).catch(() => false))) biz = { ...biz, licenseStatus: 'SUSPENDED' };
  if (biz.licenseStatus === 'ACTIVE') {
    return { valid: true, licenseId: biz.code, isTrial: false, expiresAt: biz.paidUntil || null };
  }
  return { valid: false, reason: biz.licenseStatus === 'SUSPENDED' ? 'SUSPENDED' : 'PENDING' };
}

// Idempotent: a reinstall on the same PC returns the existing record; a code already bound to a
// different machine is refused.
exports.register = async (req, res, next) => {
  try {
    requireApiKey(req);
    const { code, machineId } = readIdentity(req.body);
    const name = String(req.body.name || '').trim();
    if (!name) throw createError('Company name is required', 400);

    let biz = await prisma.business.findUnique({ where: { code } });
    if (biz) {
      if (biz.machineId && biz.machineId !== machineId) throw createError('This business code is already registered on another computer.', 409);
      if (!biz.machineId) biz = await prisma.business.update({ where: { id: biz.id }, data: { machineId } });
    } else {
      const optional = (k, max) => (req.body[k] ? String(req.body[k]).trim().slice(0, max) : null);
      biz = await prisma.business.create({
        data: {
          code, name: name.slice(0, 150), machineId, licenseStatus: 'PENDING',
          tin: optional('tin', 30), email: optional('email', 150), phone: optional('phone', 30), address: optional('address', 2000),
          industry: optional('industry', 80), taxType: optional('taxType', 20),
        },
      });
      await prisma.licenseEvent.create({
        data: { businessId: biz.id, eventType: 'CREATED', note: 'Registered from a local installation' },
      });
    }
    res.json({ registered: true, ...(await statusOf(biz)) });
  } catch (err) { next(err); }
};

exports.status = async (req, res, next) => {
  try {
    requireApiKey(req);
    const { code, machineId } = readIdentity(req.body);
    const biz = await prisma.business.findUnique({ where: { code } });
    if (!biz) return res.json({ valid: false, reason: 'NOT_FOUND' });
    if (biz.machineId && biz.machineId !== machineId) return res.json({ valid: false, reason: 'MACHINE_MISMATCH' });
    res.json(await statusOf(biz));
  } catch (err) { next(err); }
};
