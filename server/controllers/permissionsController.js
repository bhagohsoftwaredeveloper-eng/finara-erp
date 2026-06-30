const prisma = require('../config/database');

// Module keys must match lib/permissions.js MODULES
const ALL_KEYS = [
  'dashboard', 'accounts', 'journal', 'recurring', 'receivable', 'payable',
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
