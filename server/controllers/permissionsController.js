const prisma = require('../config/database');

// Module keys must match lib/permissions.js MODULES
const ALL_KEYS = [
  'dashboard', 'accounts', 'journal', 'recurring', 'receivable', 'school', 'payable',
  'payroll', 'inventory', 'assets', 'bank', 'bir', 'remittance', 'budget',
  'reports', 'audit', 'settings',
];
const CONFIGURABLE_ROLES = ['MANAGER', 'ACCOUNTANT', 'VIEWER'];

const DEFAULTS = {
  MANAGER:    [...ALL_KEYS],
  ACCOUNTANT: ALL_KEYS.filter((k) => !['settings', 'audit'].includes(k)),
  VIEWER:     ALL_KEYS.filter((k) => !['payroll', 'settings', 'audit'].includes(k)),
};

const KEY = 'rolePermissions';

// GET current per-role module permissions for the active business
exports.get = async (req, res, next) => {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { businessId_key: { businessId: req.businessId, key: KEY } },
    });
    let config = DEFAULTS;
    if (row?.value) {
      try {
        const saved = JSON.parse(row.value);
        config = {};
        for (const role of CONFIGURABLE_ROLES) {
          const list = Array.isArray(saved[role]) ? saved[role] : DEFAULTS[role];
          config[role] = ALL_KEYS.filter((k) => list.includes(k)); // keep only known keys, stable order
        }
      } catch { config = DEFAULTS; }
    }
    res.json(config);
  } catch (err) { next(err); }
};

// PUT save permissions (ADMIN only)
exports.save = async (req, res, next) => {
  try {
    const config = {};
    for (const role of CONFIGURABLE_ROLES) {
      const list = Array.isArray(req.body[role]) ? req.body[role] : DEFAULTS[role];
      config[role] = ALL_KEYS.filter((k) => list.includes(k));
    }
    // VIEWER can never have payroll (salaries) — enforced server-side too
    config.VIEWER = config.VIEWER.filter((k) => k !== 'payroll');

    await prisma.systemSetting.upsert({
      where:  { businessId_key: { businessId: req.businessId, key: KEY } },
      update: { value: JSON.stringify(config) },
      create: { businessId: req.businessId, key: KEY, value: JSON.stringify(config) },
    });
    res.json({ message: 'Permissions saved', ...config });
  } catch (err) { next(err); }
};

// ─── Global module disable (SUPER_ADMIN only) ──────────────────────
// Independent of role permissions above — a module in this list is hidden
// from the sidebar and blocked from direct navigation for every role
// except SUPER_ADMIN, regardless of what the role-permission matrix allows.
//
// adminExempt (also SUPER_ADMIN-only to set) additionally exempts ADMIN from
// that same list, business by business — off by default, so existing
// businesses keep today's behaviour (Admin is restricted like everyone else)
// until a SUPER_ADMIN opts a specific business in.
const DISABLED_KEY = 'disabledModules';
const ADMIN_EXEMPT_KEY = 'adminExemptFromDisabled';
const NON_TOGGLEABLE = ['dashboard', 'settings'];

// The disabled modules and the admin-exempt flag of ANY business, by id. Shared by the
// active-business endpoints below and by the super admin's "manage a business's modules"
// endpoints (businessController), which never open that business's books.
async function readModules(businessId) {
  const [disabledRow, exemptRow] = await Promise.all([
    prisma.systemSetting.findUnique({ where: { businessId_key: { businessId, key: DISABLED_KEY } } }),
    prisma.systemSetting.findUnique({ where: { businessId_key: { businessId, key: ADMIN_EXEMPT_KEY } } }),
  ]);
  let list = [];
  if (disabledRow?.value) {
    try { list = JSON.parse(disabledRow.value); } catch { list = []; }
  }
  const disabled = Array.isArray(list) ? list.filter((k) => ALL_KEYS.includes(k) && !NON_TOGGLEABLE.includes(k)) : [];
  return { disabled, adminExempt: exemptRow?.value === 'true' };
}

async function writeModules(businessId, body) {
  const list = Array.isArray(body.disabled) ? body.disabled : [];
  const disabled = list.filter((k) => ALL_KEYS.includes(k) && !NON_TOGGLEABLE.includes(k));
  const adminExempt = !!body.adminExempt;
  await Promise.all([
    prisma.systemSetting.upsert({
      where:  { businessId_key: { businessId, key: DISABLED_KEY } },
      update: { value: JSON.stringify(disabled) },
      create: { businessId, key: DISABLED_KEY, value: JSON.stringify(disabled) },
    }),
    prisma.systemSetting.upsert({
      where:  { businessId_key: { businessId, key: ADMIN_EXEMPT_KEY } },
      update: { value: String(adminExempt) },
      create: { businessId, key: ADMIN_EXEMPT_KEY, value: String(adminExempt) },
    }),
  ]);
  return { disabled, adminExempt };
}

exports.readModules = readModules;
exports.writeModules = writeModules;

// GET currently disabled modules for the active business (any authenticated
// user — the Sidebar/route guard need this to know what to hide)
exports.getDisabled = async (req, res, next) => {
  try {
    res.json(await readModules(req.businessId));
  } catch (err) { next(err); }
};

// PUT save disabled modules + the admin-exempt flag (SUPER_ADMIN only)
exports.saveDisabled = async (req, res, next) => {
  try {
    const saved = await writeModules(req.businessId, req.body);
    res.json({ message: 'Disabled modules saved', ...saved });
  } catch (err) { next(err); }
};
