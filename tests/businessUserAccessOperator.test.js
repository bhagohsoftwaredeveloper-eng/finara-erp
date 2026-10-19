jest.mock('../server/config/database', () => ({
  business:     { count: jest.fn(), findUnique: jest.fn() },
  auditLog:     { create: jest.fn().mockResolvedValue({}) },
  userBusiness: { findMany: jest.fn().mockResolvedValue([]), upsert: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({}), findUnique: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/businessController');

const operator = { id: 1, role: 'SUPER_ADMIN' };
const run = (fn, req) => new Promise((resolve, reject) => fn({ user: operator, params: { id: '9' }, body: {}, ...req }, { json: resolve }, reject));

beforeEach(() => { jest.clearAllMocks(); prisma.business.count.mockResolvedValue(0); }); // not the operator's own business

describe('operator staff administration', () => {
  test('lists and adds users of a client business without owning it', async () => {
    await run(ctrl.listUsers, {});
    await run(ctrl.grantUser, { body: { userId: 22 } });
    expect(prisma.userBusiness.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { userId: 22, businessId: 9 } }));
  });

  test('can grant themselves one client business, and it is audited', async () => {
    await run(ctrl.grantUser, { body: { userId: 1 } });
    expect(prisma.userBusiness.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { userId: 1, businessId: 9 } }));
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'GRANT_ACCESS', entityId: '9', summary: expect.stringContaining('themselves') }),
    }));
  });

  test('an ADMIN still needs data access to the business', async () => {
    await expect(run(ctrl.listUsers, { user: { id: 5, role: 'ADMIN' } })).rejects.toMatchObject({ statusCode: 403 });
  });
});
