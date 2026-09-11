jest.mock('../server/config/database', () => ({
  business:     { findUnique: jest.fn(), update: jest.fn() },
  licenseEvent: { create: jest.fn() },
}));
jest.mock('../server/utils/paymongo', () => ({
  isConfigured: jest.fn(),
  createPaymentLink: jest.fn(),
}));

const prisma = require('../server/config/database');
const paymongo = require('../server/utils/paymongo');
const ctrl = require('../server/controllers/businessController');

const run = (user, id, body) => new Promise((resolve, reject) => {
  ctrl.generatePaymentLink({ params: { id: String(id) }, user, body }, { json: resolve }, reject);
});

const admin = { id: 2, role: 'ADMIN' };

beforeEach(() => jest.clearAllMocks());

describe('businessController.generatePaymentLink', () => {
  test('generates a link and stores it on the business', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING' });
    paymongo.isConfigured.mockReturnValue(true);
    paymongo.createPaymentLink.mockResolvedValue({ id: 'link_123', url: 'https://pm.link/finara/abc' });
    prisma.business.update.mockResolvedValue({ id: 3, paymentLinkUrl: 'https://pm.link/finara/abc' });

    const result = await run(admin, 3, { amount: 15000, description: 'License fee' });

    expect(paymongo.createPaymentLink).toHaveBeenCalledWith({ amount: 15000, description: 'License fee', businessId: 3 });
    expect(prisma.business.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: {
        paymentLinkId: 'link_123',
        paymentLinkUrl: 'https://pm.link/finara/abc',
        paymentLinkAmount: 15000,
        paymentLinkGeneratedAt: expect.any(Date),
      },
    });
    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: { businessId: 3, eventType: 'PAYMENT_LINK_GENERATED', amount: 15000, actorUserId: 2 },
    });
    expect(result).toEqual({ paymentLinkUrl: 'https://pm.link/finara/abc' });
  });

  test('defaults the description when none is given', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING' });
    paymongo.isConfigured.mockReturnValue(true);
    paymongo.createPaymentLink.mockResolvedValue({ id: 'link_1', url: 'https://pm.link/x' });
    prisma.business.update.mockResolvedValue({});

    await run(admin, 3, { amount: 5000 });

    expect(paymongo.createPaymentLink).toHaveBeenCalledWith({ amount: 5000, description: 'Finara license — NCC', businessId: 3 });
  });

  test('rejects a zero or missing amount with 400', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, licenseStatus: 'PENDING' });
    await expect(run(admin, 3, { amount: 0 })).rejects.toMatchObject({ statusCode: 400 });
    expect(paymongo.createPaymentLink).not.toHaveBeenCalled();
  });

  test('rejects generating a link for an already-ACTIVE business with 400', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, licenseStatus: 'ACTIVE' });
    await expect(run(admin, 3, { amount: 5000 })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects with 400 when PayMongo is not configured', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING' });
    paymongo.isConfigured.mockReturnValue(false);
    await expect(run(admin, 3, { amount: 5000 })).rejects.toMatchObject({ statusCode: 400 });
    expect(paymongo.createPaymentLink).not.toHaveBeenCalled();
  });

  test('404s when the business does not exist', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    await expect(run(admin, 99, { amount: 5000 })).rejects.toMatchObject({ statusCode: 404 });
  });
});
