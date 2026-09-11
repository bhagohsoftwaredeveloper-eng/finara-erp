jest.mock('../server/config/database', () => ({
  business:     { findUnique: jest.fn(), update: jest.fn() },
  user:         { findUnique: jest.fn() },
  licenseEvent: { create: jest.fn() },
}));
jest.mock('../server/utils/mailer', () => ({
  sendLicenseActivatedNotice: jest.fn().mockResolvedValue(true),
  sendLicenseSuspendedNotice: jest.fn().mockResolvedValue(true),
}));

const prisma = require('../server/config/database');
const mailer = require('../server/utils/mailer');
const ctrl   = require('../server/controllers/businessController');

const run = (user, id, body) => new Promise((resolve, reject) => {
  ctrl.updateLicense({ params: { id: String(id) }, user, body }, { json: resolve }, reject);
});

const superAdmin = { id: 1, role: 'SUPER_ADMIN' };

beforeEach(() => jest.clearAllMocks());

describe('businessController.updateLicense', () => {
  test('PENDING -> ACTIVE activates and logs ACTIVATED', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING', createdByUserId: 7 });
    prisma.business.update.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'ACTIVE' });
    prisma.user.findUnique.mockResolvedValue({ id: 7, email: 'juan@finara.ph' });

    const result = await run(superAdmin, 3, { status: 'ACTIVE', note: 'Paid via GCash ref #12345' });

    expect(prisma.business.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { licenseStatus: 'ACTIVE', licenseActivatedAt: expect.any(Date), licenseActivatedBy: 1 },
    });
    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: { businessId: 3, eventType: 'ACTIVATED', note: 'Paid via GCash ref #12345', actorUserId: 1 },
    });
    expect(mailer.sendLicenseActivatedNotice).toHaveBeenCalledWith(
      { id: 3, name: 'NCC', licenseStatus: 'ACTIVE' },
      { id: 7, email: 'juan@finara.ph' },
    );
    expect(result).toEqual({ id: 3, name: 'NCC', licenseStatus: 'ACTIVE' });
  });

  test('SUSPENDED -> ACTIVE logs REACTIVATED', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'SUSPENDED', createdByUserId: null });
    prisma.business.update.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'ACTIVE' });

    await run(superAdmin, 3, { status: 'ACTIVE' });

    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: { businessId: 3, eventType: 'REACTIVATED', note: null, actorUserId: 1 },
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  test('ACTIVE -> SUSPENDED logs SUSPENDED and does not touch licenseActivatedAt/By', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'ACTIVE', createdByUserId: null });
    prisma.business.update.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'SUSPENDED' });

    await run(superAdmin, 3, { status: 'SUSPENDED', note: 'Non-payment dispute' });

    expect(prisma.business.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { licenseStatus: 'SUSPENDED' },
    });
    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: { businessId: 3, eventType: 'SUSPENDED', note: 'Non-payment dispute', actorUserId: 1 },
    });
    expect(mailer.sendLicenseSuspendedNotice).toHaveBeenCalled();
  });

  test('rejects re-activating an already-ACTIVE business with 400', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, licenseStatus: 'ACTIVE' });
    await expect(run(superAdmin, 3, { status: 'ACTIVE' })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.business.update).not.toHaveBeenCalled();
  });

  test('rejects PENDING -> SUSPENDED with 400', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, licenseStatus: 'PENDING' });
    await expect(run(superAdmin, 3, { status: 'SUSPENDED' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects an invalid status value with 400', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, licenseStatus: 'PENDING' });
    await expect(run(superAdmin, 3, { status: 'BOGUS' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('404s when the business does not exist', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    await expect(run(superAdmin, 99, { status: 'ACTIVE' })).rejects.toMatchObject({ statusCode: 404 });
  });
});
