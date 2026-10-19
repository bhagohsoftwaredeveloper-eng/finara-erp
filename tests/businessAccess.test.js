jest.mock('../server/config/database', () => ({
  userBusiness: { findUnique: jest.fn() },
  business:     { count: jest.fn() },
}));

const prisma = require('../server/config/database');
const { assertBusinessAccess } = require('../server/utils/businessAccess');

beforeEach(() => jest.clearAllMocks());

describe('assertBusinessAccess', () => {
  // ADMIN is a tenant, not a skeleton key: only companies they created or were
  // granted. The role alone never opens another company's data.
  test('ADMIN passes for a business they created or were granted', async () => {
    prisma.business.count.mockResolvedValue(1);
    await expect(assertBusinessAccess({ id: 1, role: 'ADMIN' }, 5)).resolves.toBeUndefined();
    expect(prisma.business.count).toHaveBeenCalledWith({
      where: {
        id: 5, isActive: true,
        OR: [{ createdByUserId: 1 }, { userBusinesses: { some: { userId: 1 } } }],
      },
    });
  });

  test('ADMIN is denied a business they neither created nor were granted', async () => {
    prisma.business.count.mockResolvedValue(0);
    await expect(assertBusinessAccess({ id: 1, role: 'ADMIN' }, 5)).rejects.toMatchObject({ statusCode: 403 });
  });

  // Reading a business RECORD (license, plan) is how SUPER_ADMIN administers
  // subscriptions; its books stay private (see canAccessBusinessData).
  test('SUPER_ADMIN may read any business record for license administration', async () => {
    await expect(assertBusinessAccess({ id: 1, role: 'SUPER_ADMIN' }, 5)).resolves.toBeUndefined();
    expect(prisma.userBusiness.findUnique).not.toHaveBeenCalled();
    expect(prisma.business.count).not.toHaveBeenCalled();
  });

  test('a non-admin with a matching grant passes', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue({ userId: 7, businessId: 5 });
    await expect(assertBusinessAccess({ id: 7, role: 'MANAGER' }, 5)).resolves.toBeUndefined();
    expect(prisma.userBusiness.findUnique).toHaveBeenCalledWith({
      where: { userId_businessId: { userId: 7, businessId: 5 } },
    });
  });

  test('a non-admin with no grant is denied', async () => {
    prisma.userBusiness.findUnique.mockResolvedValue(null);
    await expect(assertBusinessAccess({ id: 7, role: 'MANAGER' }, 5)).rejects.toMatchObject({ statusCode: 403 });
  });
});
