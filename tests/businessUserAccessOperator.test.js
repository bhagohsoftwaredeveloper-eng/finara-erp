jest.mock('../server/config/database', () => ({
  business:     { count: jest.fn(), findUnique: jest.fn() },
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

  test('cannot grant themselves a client business', async () => {
    await expect(run(ctrl.grantUser, { body: { userId: 1 } })).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.userBusiness.upsert).not.toHaveBeenCalled();
  });

  test('an ADMIN still needs data access to the business', async () => {
    await expect(run(ctrl.listUsers, { user: { id: 5, role: 'ADMIN' } })).rejects.toMatchObject({ statusCode: 403 });
  });
});
