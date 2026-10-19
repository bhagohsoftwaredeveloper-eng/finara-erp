jest.mock('../server/config/database', () => ({
  business: { findUnique: jest.fn() },
  systemSetting: { findUnique: jest.fn(), upsert: jest.fn() },
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const { recordAudit } = require('../server/utils/audit');
const ctrl = require('../server/controllers/businessController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 3, user: { id: 3, role: 'SUPER_ADMIN' }, params: {}, query: {}, body: {}, ...req },
    { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.business.findUnique.mockResolvedValue({ id: 9, name: 'Tindang Juan' });
  prisma.systemSetting.findUnique.mockImplementation(async ({ where }) => {
    const key = where.businessId_key.key;
    if (key === 'disabledModules') return { value: JSON.stringify(['bir', 'payroll', 'nonsense']) };
    if (key === 'adminExemptFromDisabled') return { value: 'true' };
    return null;
  });
});

describe('getModules (any business, no access to its books)', () => {
  test('reads the disabled modules of the business named in the URL, not the active one', async () => {
    const r = await run(ctrl.getModules, { params: { id: '9' } });

    expect(prisma.systemSetting.findUnique).toHaveBeenCalledWith({ where: { businessId_key: { businessId: 9, key: 'disabledModules' } } });
    expect(r).toEqual({ business: { id: 9, name: 'Tindang Juan' }, disabled: ['bir', 'payroll'], adminExempt: true });
  });

  test('404 for a business that does not exist', async () => {
    prisma.business.findUnique.mockResolvedValue(null);

    await expect(run(ctrl.getModules, { params: { id: '99' } })).rejects.toThrow('not found');
    expect(prisma.systemSetting.findUnique).not.toHaveBeenCalled();
  });

  test('only a super admin may use it', async () => {
    await expect(run(ctrl.getModules, { params: { id: '9' }, user: { id: 5, role: 'ADMIN' } })).rejects.toThrow('permissions');
  });
});

describe('saveModules', () => {
  test('stores the cleaned list for that business, and drops modules that cannot be switched off', async () => {
    const r = await run(ctrl.saveModules, {
      params: { id: '9' }, body: { disabled: ['bir', 'dashboard', 'settings', 'nonsense', 'budget'], adminExempt: false },
    });

    const upserts = Object.fromEntries(prisma.systemSetting.upsert.mock.calls.map(([a]) => [a.where.businessId_key.key, a]));
    expect(upserts.disabledModules.where.businessId_key.businessId).toBe(9);
    expect(JSON.parse(upserts.disabledModules.update.value)).toEqual(['bir', 'budget']);
    expect(upserts.adminExemptFromDisabled.update.value).toBe('false');
    expect(r).toMatchObject({ disabled: ['bir', 'budget'], adminExempt: false });
  });

  test('leaves a trail in the audit log under the affected business', async () => {
    await run(ctrl.saveModules, { params: { id: '9' }, body: { disabled: ['bir'], adminExempt: false } });

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      businessId: 9, entity: 'Business', entityId: 9, action: 'UPDATE',
      summary: expect.stringContaining('Tindang Juan'),
    }));
  });

  test('404 and only for a super admin', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    await expect(run(ctrl.saveModules, { params: { id: '99' }, body: { disabled: [] } })).rejects.toThrow('not found');

    await expect(run(ctrl.saveModules, { params: { id: '9' }, user: { id: 5, role: 'MANAGER' }, body: { disabled: [] } }))
      .rejects.toThrow('permissions');
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled();
  });
});
