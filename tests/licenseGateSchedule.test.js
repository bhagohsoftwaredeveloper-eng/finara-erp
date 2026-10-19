jest.mock('../server/config/database', () => ({
  business:     { findUnique: jest.fn(), updateMany: jest.fn() },
  userBusiness: { findUnique: jest.fn() },
  licenseEvent: { create: jest.fn() },
  user:         { findUnique: jest.fn() },
}));
jest.mock('../server/utils/mailer', () => ({ sendLicenseSuspendedNotice: jest.fn().mockResolvedValue(true) }));

const prisma = require('../server/config/database');
const { resolveBusiness } = require('../server/middleware/auth');

const manager = { id: 11, role: 'MANAGER' };
const open = (bizId) => new Promise((resolve) => {
  const req = { user: manager, headers: { 'x-business-id': String(bizId) } };
  const res = { status: (code) => ({ json: (body) => resolve({ code, body }) }) };
  resolveBusiness(req, res, () => resolve({ code: 200, businessId: req.businessId }));
});

const biz = (over = {}) => ({ id: 9, name: 'Tindang Juan', email: null, createdByUserId: null, licenseStatus: 'ACTIVE', suspendAt: null, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.userBusiness.findUnique.mockResolvedValue({ id: 1 });
  prisma.business.updateMany.mockResolvedValue({ count: 1 });
});

describe('license gate with a scheduled suspension', () => {
  test('before the effective date the client keeps working normally', async () => {
    prisma.business.findUnique.mockResolvedValue(biz({ suspendAt: new Date(Date.now() + 5 * 86400000) }));

    expect(await open(9)).toEqual({ code: 200, businessId: 9 });
    expect(prisma.business.updateMany).not.toHaveBeenCalled();
  });

  test('once the date has arrived the business is suspended on first contact and the request is refused', async () => {
    prisma.business.findUnique.mockResolvedValue(biz({ suspendAt: new Date(Date.now() - 60 * 1000) }));

    const r = await open(9);

    expect(r).toEqual({ code: 403, body: { error: 'Business license suspended' } });
    expect(prisma.business.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 9, licenseStatus: 'ACTIVE' }),
      data: { licenseStatus: 'SUSPENDED', suspendAt: null },
    }));
    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ eventType: 'SUSPENDED', businessId: 9 }) });
  });

  test('a business with no schedule is untouched', async () => {
    prisma.business.findUnique.mockResolvedValue(biz());

    expect((await open(9)).code).toBe(200);
    expect(prisma.business.updateMany).not.toHaveBeenCalled();
  });

  test('even if recording the suspension fails, the request is still refused', async () => {
    prisma.business.findUnique.mockResolvedValue(biz({ suspendAt: new Date(Date.now() - 1000) }));
    prisma.business.updateMany.mockRejectedValue(new Error('db'));

    expect((await open(9)).code).toBe(403);
  });
});
