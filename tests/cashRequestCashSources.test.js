jest.mock('../server/config/database', () => ({
  account: { findMany: jest.fn(), findFirst: jest.fn() },
  cashRequest: { findFirst: jest.fn(), update: jest.fn() },
  cashRequestItem: { update: jest.fn() },
  cashDenominationCount: { findMany: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));
jest.mock('../server/utils/cashDenomination', () => ({
  resolveCount: jest.fn().mockResolvedValue(null),
  saveCount: jest.fn(),
}));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/cashRequestController');

const call = async (handler, req) => {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next };
};

beforeEach(() => jest.clearAllMocks());

describe('cashSources', () => {
  test('splits the active ASSET/LIABILITY accounts of this business into cash and owner groups', async () => {
    prisma.account.findMany.mockResolvedValue([
      { id: 1, accountCode: '1010', accountName: 'Cash on Hand', accountType: 'ASSET', isActive: true },
      { id: 2, accountCode: '1104', accountName: 'Advances to Officers & Employees', accountType: 'ASSET', isActive: true },
      { id: 3, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'LIABILITY', isActive: true },
      { id: 4, accountCode: '2540', accountName: 'Due To Owner', accountType: 'LIABILITY', isActive: true },
    ]);

    const { res } = await call(ctrl.cashSources, { businessId: 9 });

    expect(prisma.account.findMany.mock.calls[0][0].where).toMatchObject({ businessId: 9, isActive: true });
    expect(res.body).toEqual({
      cash:  [{ id: 1, accountCode: '1010', accountName: 'Cash on Hand' }],
      owner: [{ id: 4, accountCode: '2540', accountName: 'Due To Owner' }],
    });
  });
});

describe('release', () => {
  const approved = { id: 5, requestNo: 'CR-000005', requestedFor: 'Juan', status: 'APPROVED', items: [] };
  const req = (body) => ({ params: { id: '5' }, businessId: 9, body, user: { id: 1, name: 'Tester' } });

  beforeEach(() => {
    prisma.cashRequest.findFirst.mockResolvedValue(approved);
    prisma.cashRequest.update.mockResolvedValue({ ...approved, status: 'RELEASED' });
    prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  });

  test("an owner source posts DR 1104 / CR the owner's account and is stored as the source", async () => {
    prisma.account.findFirst.mockResolvedValue({
      id: 4, accountCode: '2540', accountName: 'Due To Owner', accountType: 'LIABILITY', isActive: true,
    });

    const { res, next } = await call(ctrl.release, req({ releasedAmount: 15000, cashAccountCode: '2540', releasedDate: '2026-10-28' }));

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(prisma.account.findFirst.mock.calls[0][0].where).toEqual({ accountCode: '2540', businessId: 9 });
    expect(glPost.safePost.mock.calls[0][0].lines).toEqual([
      expect.objectContaining({ accountCode: '1104', debit: 15000 }),
      expect.objectContaining({ accountCode: '2540', credit: 15000, description: 'Owner funded cash — CR-000005' }),
    ]);
    expect(prisma.cashRequest.update.mock.calls[0][0].data).toMatchObject({ status: 'RELEASED', cashAccountCode: '2540' });
  });

  test('rejects an account that is not a cash source, before writing anything', async () => {
    prisma.account.findFirst.mockResolvedValue({
      id: 3, accountCode: '2010', accountName: 'Accounts Payable', accountType: 'LIABILITY', isActive: true,
    });

    const { next } = await call(ctrl.release, req({ releasedAmount: 100, cashAccountCode: '2010' }));

    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 400, message: "2010 can't be used as a cash source" });
    expect(prisma.cashRequest.update).not.toHaveBeenCalled();
    expect(glPost.safePost).not.toHaveBeenCalled();
  });

  test('rejects the old "funded by owner" payload sent by a stale page', async () => {
    const { next } = await call(ctrl.release, req({ releasedAmount: 100, cashAccountCode: '1010', fundedByOwnerAccountId: 4 }));

    expect(next.mock.calls[0][0]).toMatchObject({
      statusCode: 400,
      message: "This page is out of date. Reload it and choose the owner's account under Cash Source.",
    });
    expect(prisma.cashRequest.update).not.toHaveBeenCalled();
    expect(glPost.safePost).not.toHaveBeenCalled();
  });
});

describe('getOne', () => {
  test("includes the cash source's account name, looked up in this business", async () => {
    prisma.cashRequest.findFirst.mockResolvedValue({ id: 5, cashAccountCode: '2540', items: [], liquidation: null });
    prisma.cashDenominationCount.findMany.mockResolvedValue([]);
    prisma.account.findFirst.mockResolvedValue({ accountName: 'Due To Owner' });

    const { res } = await call(ctrl.getOne, { params: { id: '5' }, businessId: 9 });

    expect(res.body.cashAccountName).toBe('Due To Owner');
    expect(prisma.account.findFirst.mock.calls[0][0].where).toEqual({ businessId: 9, accountCode: '2540' });
  });

  test('cashAccountName is null before release', async () => {
    prisma.cashRequest.findFirst.mockResolvedValue({ id: 6, cashAccountCode: null, items: [], liquidation: null });
    prisma.cashDenominationCount.findMany.mockResolvedValue([]);

    const { res } = await call(ctrl.getOne, { params: { id: '6' }, businessId: 9 });

    expect(res.body.cashAccountName).toBeNull();
    expect(prisma.account.findFirst).not.toHaveBeenCalled();
  });
});
