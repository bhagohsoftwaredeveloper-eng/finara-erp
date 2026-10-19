jest.mock('../server/config/database', () => ({
  business:      { findMany: jest.fn(), findUnique: jest.fn(), count: jest.fn() },
  businessOrder: { findFirst: jest.fn() },
  planPrice:     { findUnique: jest.fn() },
  auditLog:      { findFirst: jest.fn(), create: jest.fn().mockResolvedValue({}) },
  user:          { findMany: jest.fn() },
  userBusiness:  { findUnique: jest.fn() },
}));
jest.mock('../server/utils/mailer', () => ({ sendActivationRequestNotice: jest.fn() }));

const prisma = require('../server/config/database');
const mailer = require('../server/utils/mailer');
const ctrl   = require('../server/controllers/businessController');

const user = { id: 5, role: 'ADMIN' };
const run = (fn, req) => new Promise((resolve, reject) => fn({ user, params: {}, body: {}, headers: {}, ...req }, { json: resolve }, reject));
const biz = (over = {}) => ({ id: 9, code: 'TJ', name: 'Tindang Juan', licenseStatus: 'SUSPENDED', suspendAt: null, paidUntil: new Date('2026-09-30'), ...over });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.auditLog.findFirst.mockResolvedValue(null);
  prisma.businessOrder.findFirst.mockResolvedValue(null);
  prisma.planPrice.findUnique.mockResolvedValue(null);
});

describe('GET /businesses/locked', () => {
  test('lists only non-active businesses with the amount due from the last plan', async () => {
    prisma.business.findMany.mockResolvedValue([biz(), biz({ id: 10, licenseStatus: 'ACTIVE' })]);
    // first call: last order; second call: open order (none)
    prisma.businessOrder.findFirst
      .mockResolvedValueOnce({ companyType: 'TRADING', period: 'MONTHLY' })
      .mockResolvedValueOnce(null);
    prisma.planPrice.findUnique.mockResolvedValue({ amount: 999, isActive: true });

    const r = await run(ctrl.listLocked, {});

    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ id: 9, licenseStatus: 'SUSPENDED', period: 'MONTHLY', amountDue: 999, openOrder: null, activationRequestedAt: null });
  });

  test('an open renewal order sets the amount due and is flagged as the caller\'s own', async () => {
    prisma.business.findMany.mockResolvedValue([biz()]);
    const open = { id: 4, orderNo: 'ORD-1', status: 'PENDING_PAYMENT', amount: 1200, period: 'YEARLY', companyName: 'Tindang Juan', userId: 5 };
    prisma.businessOrder.findFirst
      .mockResolvedValueOnce({ companyType: 'TRADING', period: 'MONTHLY' })
      .mockResolvedValueOnce(open);

    const r = await run(ctrl.listLocked, {});

    expect(r[0].amountDue).toBe(1200);
    expect(r[0].openOrder).toMatchObject({ id: 4, status: 'PENDING_PAYMENT', mine: true });
  });
});

describe('POST /businesses/:id/request-activation', () => {
  beforeEach(() => {
    prisma.business.count.mockResolvedValue(1);
    prisma.business.findUnique.mockResolvedValue(biz());
    prisma.user.findMany.mockResolvedValue([{ email: 'op@finara.ph' }]);
  });

  test('records the request and mails the super admins', async () => {
    const r = await run(ctrl.requestActivation, { params: { id: '9' } });

    expect(r.requestedAt).toBeInstanceOf(Date);
    expect(mailer.sendActivationRequestNotice).toHaveBeenCalledWith(expect.objectContaining({ id: 9 }), user, ['op@finara.ph']);
  });

  test('a second request within a day is refused', async () => {
    prisma.auditLog.findFirst.mockResolvedValue({ id: 1 });
    await expect(run(ctrl.requestActivation, { params: { id: '9' } })).rejects.toMatchObject({ statusCode: 409 });
    expect(mailer.sendActivationRequestNotice).not.toHaveBeenCalled();
  });

  test('an already active business has nothing to request', async () => {
    prisma.business.findUnique.mockResolvedValue(biz({ licenseStatus: 'ACTIVE' }));
    await expect(run(ctrl.requestActivation, { params: { id: '9' } })).rejects.toMatchObject({ statusCode: 409 });
  });
});
