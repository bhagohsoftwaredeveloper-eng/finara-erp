jest.mock('../server/config/database', () => ({
  business:     { findMany: jest.fn(), findUnique: jest.fn() },
  userBusiness: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/businessController');
const { resolveBusiness } = require('../server/middleware/auth');

const runGet = (user, id) => new Promise((resolve, reject) => {
  ctrl.get({ params: { id: String(id) }, user }, { json: resolve }, reject);
});
const runList = (user) => new Promise((resolve, reject) => {
  ctrl.list({ user }, { json: resolve }, reject);
});
const runResolve = (user, headerBizId) => new Promise((resolve) => {
  const req = { user, headers: headerBizId ? { 'x-business-id': String(headerBizId) } : {} };
  const res = { status: (code) => ({ json: (body) => resolve({ code, body }) }) };
  resolveBusiness(req, res, () => resolve({ code: 200, businessId: req.businessId }));
});

beforeEach(() => jest.clearAllMocks());

describe('businessController.get license gate', () => {
  test('ADMIN is denied a PENDING business with 403', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'New Client Co.', licenseStatus: 'PENDING' });
    await expect(runGet({ id: 1, role: 'ADMIN' }, 3)).rejects.toMatchObject({ statusCode: 403, message: 'License not yet activated' });
  });

  test('ADMIN is denied a SUSPENDED business with 403', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'New Client Co.', licenseStatus: 'SUSPENDED' });
    await expect(runGet({ id: 1, role: 'ADMIN' }, 3)).rejects.toMatchObject({ statusCode: 403, message: 'Business license suspended' });
  });

  test('SUPER_ADMIN can fetch a PENDING business', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'New Client Co.', licenseStatus: 'PENDING' });
    const biz = await runGet({ id: 1, role: 'SUPER_ADMIN' }, 3);
    expect(biz.licenseStatus).toBe('PENDING');
  });
});

describe('businessController.list license gate', () => {
  test('ADMIN only sees ACTIVE businesses', async () => {
    prisma.business.findMany.mockResolvedValue([{ id: 1, licenseStatus: 'ACTIVE' }]);
    await runList({ id: 1, role: 'ADMIN' });
    expect(prisma.business.findMany).toHaveBeenCalledWith({
      where: { isActive: true, licenseStatus: 'ACTIVE' },
      orderBy: { name: 'asc' },
    });
  });

  test('SUPER_ADMIN sees every license status', async () => {
    prisma.business.findMany.mockResolvedValue([{ id: 1, licenseStatus: 'PENDING' }]);
    await runList({ id: 1, role: 'SUPER_ADMIN' });
    expect(prisma.business.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  });

  test('a regular user only sees their ACTIVE granted businesses', async () => {
    prisma.userBusiness.findMany.mockResolvedValue([
      { business: { id: 1, isActive: true, licenseStatus: 'ACTIVE' } },
      { business: { id: 2, isActive: true, licenseStatus: 'PENDING' } },
    ]);
    const result = await runList({ id: 5, role: 'MANAGER' });
    expect(result).toEqual([{ id: 1, isActive: true, licenseStatus: 'ACTIVE' }]);
  });
});

describe('resolveBusiness license gate', () => {
  test('ADMIN defaulting to business 1 is blocked when business 1 is not ACTIVE', async () => {
    prisma.business.findUnique.mockResolvedValue({ licenseStatus: 'SUSPENDED' });
    const result = await runResolve({ id: 1, role: 'ADMIN' });
    expect(result.code).toBe(403);
    expect(result.body.error).toBe('Business license suspended');
  });

  test('ADMIN switching via header to a PENDING business is blocked', async () => {
    prisma.business.findUnique.mockResolvedValue({ licenseStatus: 'PENDING' });
    const result = await runResolve({ id: 1, role: 'ADMIN' }, 7);
    expect(result.code).toBe(403);
    expect(result.body.error).toBe('License not yet activated');
  });

  test('SUPER_ADMIN switching to a PENDING business is never blocked (no license lookup at all)', async () => {
    const result = await runResolve({ id: 1, role: 'SUPER_ADMIN' }, 7);
    expect(result.businessId).toBe(7);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  test('a granted regular user is blocked from a SUSPENDED business', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ userId: 5, businessId: 7 });
    prisma.business.findUnique.mockResolvedValue({ licenseStatus: 'SUSPENDED' });
    const result = await runResolve({ id: 5, role: 'MANAGER' }, 7);
    expect(result.code).toBe(403);
    expect(result.body.error).toBe('Business license suspended');
  });

  test('an ACTIVE business resolves normally for a regular user', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ userId: 5, businessId: 7 });
    prisma.business.findUnique.mockResolvedValue({ licenseStatus: 'ACTIVE' });
    const result = await runResolve({ id: 5, role: 'MANAGER' }, 7);
    expect(result.businessId).toBe(7);
  });
});
