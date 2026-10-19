jest.mock('../server/config/database', () => ({
  business:     { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  user:         { findUnique: jest.fn() },
  licenseEvent: { create: jest.fn() },
  userBusiness: { findUnique: jest.fn().mockResolvedValue({ id: 1 }) },
}));
jest.mock('../server/utils/mailer', () => ({
  sendLicenseActivatedNotice: jest.fn().mockResolvedValue(true),
  sendLicenseSuspendedNotice: jest.fn().mockResolvedValue(true),
  sendLicenseSuspensionScheduledNotice: jest.fn().mockResolvedValue(true),
}));

const prisma = require('../server/config/database');
const mailer = require('../server/utils/mailer');
const ctrl   = require('../server/controllers/businessController');

const superAdmin = { id: 3, role: 'SUPER_ADMIN' };
const call = (fn, body = {}, id = 9, user = superAdmin) => new Promise((resolve, reject) => {
  fn({ params: { id: String(id) }, user, body }, { json: resolve }, reject);
});

// 30 days ahead (the date must be in the future but within a year)
const FUTURE = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const FUTURE_INSTANT = new Date(`${FUTURE}T00:00:00+08:00`).toISOString();
const active = (over = {}) => ({ id: 9, name: 'Tindang Juan', licenseStatus: 'ACTIVE', suspendAt: null, createdByUserId: 11, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.business.update.mockImplementation(async ({ data }) => ({ id: 9, name: 'Tindang Juan', licenseStatus: 'ACTIVE', ...data }));
  prisma.user.findUnique.mockResolvedValue({ id: 11, email: 'owner@x.com' });
});

describe('suspending with an effective date', () => {
  test('a future date only schedules it: the license stays ACTIVE, an event is logged and the owner is warned', async () => {
    prisma.business.findUnique.mockResolvedValue(active());

    const r = await call(ctrl.updateLicense, { status: 'SUSPENDED', effectiveDate: FUTURE, note: 'Unpaid since September' });

    const data = prisma.business.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('licenseStatus');
    expect(data.suspendAt.toISOString()).toBe(FUTURE_INSTANT);
    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 9, eventType: 'SUSPENSION_SCHEDULED', actorUserId: 3,
        note: `Suspension effective ${FUTURE}. Unpaid since September`,
      }),
    });
    expect(mailer.sendLicenseSuspensionScheduledNotice).toHaveBeenCalledWith(expect.anything(), { id: 11, email: 'owner@x.com' }, FUTURE);
    expect(mailer.sendLicenseSuspendedNotice).not.toHaveBeenCalled();
    expect(r.licenseStatus).toBe('ACTIVE');
  });

  test('scheduling again simply moves the date', async () => {
    prisma.business.findUnique.mockResolvedValue(active({ suspendAt: new Date('2099-06-01T00:00:00+08:00') }));

    await call(ctrl.updateLicense, { status: 'SUSPENDED', effectiveDate: FUTURE });

    expect(prisma.business.update.mock.calls[0][0].data.suspendAt.toISOString()).toBe(FUTURE_INSTANT);
  });

  test('no date, or today, still suspends immediately and clears any schedule', async () => {
    prisma.business.findUnique.mockResolvedValue(active({ suspendAt: new Date('2099-06-01T00:00:00+08:00') }));

    await call(ctrl.updateLicense, { status: 'SUSPENDED' });

    expect(prisma.business.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { licenseStatus: 'SUSPENDED', suspendAt: null } });
    expect(prisma.licenseEvent.create.mock.calls[0][0].data.eventType).toBe('SUSPENDED');
    expect(mailer.sendLicenseSuspendedNotice).toHaveBeenCalled();
  });

  test('a bad date is rejected and nothing changes', async () => {
    prisma.business.findUnique.mockResolvedValue(active());

    await expect(call(ctrl.updateLicense, { status: 'SUSPENDED', effectiveDate: 'next week' })).rejects.toThrow('effectiveDate');
    expect(prisma.business.update).not.toHaveBeenCalled();
  });
});

describe('cancelScheduledSuspension', () => {
  test('clears the schedule and logs SUSPENSION_CANCELLED', async () => {
    prisma.business.findUnique.mockResolvedValue(active({ suspendAt: new Date('2099-06-01T00:00:00+08:00') }));

    await call(ctrl.cancelScheduledSuspension, { note: 'Paid by GCash' });

    expect(prisma.business.update).toHaveBeenCalledWith({ where: { id: 9 }, data: { suspendAt: null } });
    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: { businessId: 9, eventType: 'SUSPENSION_CANCELLED', note: 'Paid by GCash', actorUserId: 3 },
    });
  });

  test('nothing scheduled, or no such business', async () => {
    prisma.business.findUnique.mockResolvedValue(active());
    await expect(call(ctrl.cancelScheduledSuspension)).rejects.toThrow('No suspension');

    prisma.business.findUnique.mockResolvedValue(null);
    await expect(call(ctrl.cancelScheduledSuspension)).rejects.toThrow('not found');
  });
});

describe('a scheduled suspension that has arrived', () => {
  test('get() locks it for the client but not for the operator', async () => {
    const due = active({ suspendAt: new Date('2020-01-01T00:00:00+08:00') });
    prisma.business.findUnique.mockResolvedValue({ ...due });
    prisma.business.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue(null);

    // the client user has access to the business (a user_businesses grant); the license is what fails
    await expect(call(ctrl.get, {}, 9, { id: 11, role: 'MANAGER' })).rejects.toThrow('suspended');
    expect(prisma.business.updateMany).toHaveBeenCalled();
  });
});
