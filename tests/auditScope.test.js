jest.mock('../server/config/database', () => ({
  auditLog:     { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
  business:     { count: jest.fn(), findUnique: jest.fn() },
  userBusiness: { findMany: jest.fn(), findUnique: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/auditController');

const run = (fn, user, { headers = {}, query = {} } = {}) =>
  new Promise((resolve, reject) => fn({ user, headers, query }, { json: resolve }, reject));
const whereOf = () => prisma.auditLog.findMany.mock.calls[0][0].where;

beforeEach(() => {
  jest.clearAllMocks();
  prisma.userBusiness.findMany.mockResolvedValue([{ userId: 11 }, { userId: 12 }]);
  prisma.business.findUnique.mockResolvedValue({ createdByUserId: 7 });
});

describe('audit trail scope', () => {
  test('the operator sees every company', async () => {
    await run(ctrl.list, { id: 3, role: 'SUPER_ADMIN' });
    expect(whereOf()).toEqual({});
  });

  test("a manager sees their company's events plus the sign-ins of its people, nothing else", async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ id: 1 });   // granted to business 9
    await run(ctrl.list, { id: 11, role: 'MANAGER' }, { headers: { 'x-business-id': '9' } });

    expect(whereOf()).toEqual({
      AND: [{ OR: [{ businessId: 9 }, { businessId: null, userId: { in: [11, 12, 7] } }] }],
    });
  });

  test('a search is added on top of the scope, never replacing it', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ id: 1 });
    await run(ctrl.list, { id: 11, role: 'MANAGER' }, { headers: { 'x-business-id': '9' }, query: { search: 'login' } });

    const and = whereOf().AND;
    expect(and).toHaveLength(2);
    expect(and[0].OR[0]).toEqual({ businessId: 9 });
    expect(and[1].OR).toEqual(expect.arrayContaining([{ summary: { contains: 'login' } }]));
  });

  test("someone else's company is refused", async () => {
    prisma.userBusiness.findUnique.mockResolvedValue(null);
    await expect(run(ctrl.list, { id: 11, role: 'MANAGER' }, { headers: { 'x-business-id': '4' } }))
      .rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  test('the filter dropdowns are scoped too', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ id: 1 });
    await run(ctrl.filters, { id: 11, role: 'MANAGER' }, { headers: { 'x-business-id': '9' } });
    expect(prisma.auditLog.findMany.mock.calls[0][0].where.OR[0]).toEqual({ businessId: 9 });
  });
});
