jest.mock('../server/config/database', () => ({
  business: { updateMany: jest.fn(), findMany: jest.fn() },
  licenseEvent: { create: jest.fn() },
  user: { findUnique: jest.fn() },
}));
jest.mock('../server/utils/mailer', () => ({ sendLicenseSuspendedNotice: jest.fn().mockResolvedValue(true) }));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const mailer = require('../server/utils/mailer');
const {
  effectiveInstant, isDue, parseEffective, applyDueSuspension, sweepDueSuspensions,
} = require('../server/utils/licenseSchedule');

const NOW = new Date('2026-10-19T10:00:00+08:00');
beforeEach(() => {
  jest.clearAllMocks();
  prisma.business.updateMany.mockResolvedValue({ count: 1 });
  prisma.user.findUnique.mockResolvedValue({ id: 3, email: 'owner@x.com' });
});

describe('effectiveInstant', () => {
  test('the effective date starts at midnight Manila time, so the client has the whole day before it', () => {
    expect(effectiveInstant('2026-10-31').toISOString()).toBe('2026-10-30T16:00:00.000Z');
  });
});

describe('isDue', () => {
  const biz = (over = {}) => ({ licenseStatus: 'ACTIVE', suspendAt: new Date('2026-10-19T00:00:00+08:00'), ...over });

  test('an active license whose suspension moment has passed is due', () => {
    expect(isDue(biz(), NOW)).toBe(true);
    expect(isDue(biz({ suspendAt: new Date('2026-10-19T10:00:00+08:00') }), NOW)).toBe(true);
  });

  test('not due before the moment, with no schedule, or when the license is not ACTIVE', () => {
    expect(isDue(biz({ suspendAt: new Date('2026-10-20T00:00:00+08:00') }), NOW)).toBe(false);
    expect(isDue(biz({ suspendAt: null }), NOW)).toBe(false);
    expect(isDue(biz({ licenseStatus: 'SUSPENDED' }), NOW)).toBe(false);
    expect(isDue(biz({ licenseStatus: 'PENDING' }), NOW)).toBe(false);
  });
});

describe('parseEffective', () => {
  test('nothing, or a date that is today or earlier, means suspend now', () => {
    expect(parseEffective(undefined, NOW)).toEqual({ immediate: true });
    expect(parseEffective('', NOW)).toEqual({ immediate: true });
    expect(parseEffective('2026-10-19', NOW)).toEqual({ immediate: true });
    expect(parseEffective('2026-10-01', NOW)).toEqual({ immediate: true });
  });

  test('a future date is a schedule, effective from midnight Manila time', () => {
    const r = parseEffective('2026-10-31', NOW);

    expect(r.immediate).toBeUndefined();
    expect(r.dateStr).toBe('2026-10-31');
    expect(r.at.toISOString()).toBe('2026-10-30T16:00:00.000Z');
  });

  test('bad dates and dates more than a year away are rejected', () => {
    expect(() => parseEffective('31/10/2026', NOW)).toThrow('effectiveDate');
    expect(() => parseEffective('2026-13-40', NOW)).toThrow('effectiveDate');
    expect(() => parseEffective('2028-01-01', NOW)).toThrow('year');
  });
});

describe('applyDueSuspension', () => {
  const due = { id: 9, name: 'Tindang Juan', licenseStatus: 'ACTIVE', suspendAt: new Date('2026-10-19T00:00:00+08:00'), createdByUserId: 3 };

  test('suspends only if the row is still due (race-safe), records the event and tells the owner', async () => {
    const done = await applyDueSuspension(due, NOW);

    expect(done).toBe(true);
    expect(prisma.business.updateMany).toHaveBeenCalledWith({
      where: { id: 9, licenseStatus: 'ACTIVE', suspendAt: { lte: NOW } },
      data: { licenseStatus: 'SUSPENDED', suspendAt: null },
    });
    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ businessId: 9, eventType: 'SUSPENDED', actorUserId: null, note: expect.stringContaining('Scheduled') }),
    });
    expect(mailer.sendLicenseSuspendedNotice).toHaveBeenCalled();
  });

  test('does nothing when someone else already handled it', async () => {
    prisma.business.updateMany.mockResolvedValue({ count: 0 });

    expect(await applyDueSuspension(due, NOW)).toBe(false);
    expect(prisma.licenseEvent.create).not.toHaveBeenCalled();
    expect(mailer.sendLicenseSuspendedNotice).not.toHaveBeenCalled();
  });

  test('a failing email never undoes the suspension', async () => {
    mailer.sendLicenseSuspendedNotice.mockRejectedValue(new Error('smtp'));

    expect(await applyDueSuspension(due, NOW)).toBe(true);
  });
});

describe('sweepDueSuspensions', () => {
  test('applies every due suspension and counts them', async () => {
    prisma.business.findMany.mockResolvedValue([
      { id: 1, name: 'A', licenseStatus: 'ACTIVE', suspendAt: new Date('2026-10-18T00:00:00+08:00') },
      { id: 2, name: 'B', licenseStatus: 'ACTIVE', suspendAt: new Date('2026-10-19T00:00:00+08:00') },
    ]);
    prisma.business.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });

    expect(await sweepDueSuspensions(NOW)).toBe(1);
    expect(prisma.business.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { licenseStatus: 'ACTIVE', suspendAt: { lte: NOW } },
    }));
  });
});
