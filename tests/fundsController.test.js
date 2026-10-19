jest.mock('../server/config/database', () => ({
  systemSetting: { findUnique: jest.fn(), upsert: jest.fn() },
  account: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  journalEntry: { findMany: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/fundsController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const acct = (id, code, name, accountType = 'ASSET') => ({ id, accountCode: code, accountName: name, accountType });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.systemSetting.findUnique.mockResolvedValue(null); // default settings
});

describe('config', () => {
  test('returns the merged settings for the business', async () => {
    const r = await run(ctrl.getConfig, {});

    expect(r.marketing).toMatchObject({ percent: 10, accountCode: '1013', enabled: false });
    expect(r.revolving.accountCodes).toEqual(['1011', '1012']);
  });

  test('saving validates and stores', async () => {
    const r = await run(ctrl.saveConfig, { body: { marketing: { enabled: true, percent: 12 } } });

    expect(r.marketing).toMatchObject({ enabled: true, percent: 12 });
    expect(prisma.systemSetting.upsert).toHaveBeenCalled();
  });

  test('a bad value is rejected', async () => {
    await expect(run(ctrl.saveConfig, { body: { marketing: { percent: 300 } } })).rejects.toThrow('percent');
  });
});

describe('createMarketingAccount', () => {
  test('creates the fund account under Current Assets when the code is free', async () => {
    prisma.account.findFirst
      .mockResolvedValueOnce(null)                         // 1013 does not exist yet
      .mockResolvedValueOnce({ id: 1, accountCode: '1000' }); // parent
    prisma.account.create.mockResolvedValue({ id: 50, accountCode: '1013' });

    const r = await run(ctrl.createMarketingAccount, {});

    expect(prisma.account.findFirst).toHaveBeenNthCalledWith(1, { where: { businessId: 1, accountCode: '1013' } });
    expect(prisma.account.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 1, accountCode: '1013', accountName: 'Marketing Fund', accountType: 'ASSET', normalBalance: 'DEBIT', parentId: 1,
      }),
    });
    expect(r).toMatchObject({ created: true });
  });

  test('does nothing when the account already exists', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 50, accountCode: '1013', accountType: 'ASSET' });

    const r = await run(ctrl.createMarketingAccount, {});

    expect(prisma.account.create).not.toHaveBeenCalled();
    expect(r).toMatchObject({ created: false });
  });
});

describe('getSummary', () => {
  const PETTY = acct(11, '1011', 'Petty Cash Fund');
  const BANK  = acct(20, '1020', 'Cash in Bank');
  const FUEL  = acct(30, '6520', 'Fuel', 'EXPENSE');
  const entry = (no, date, lines) => ({
    id: no, entryNo: no, entryDate: new Date(`${date}T00:00:00Z`), reference: 'R', description: 'd',
    lines: lines.map(([account, debit, credit]) => ({ accountId: account.id, account, debit, credit })),
  });

  test('revolving fund: reads posted entries touching the fund accounts up to the end date', async () => {
    prisma.account.findMany.mockResolvedValue([PETTY]);
    prisma.journalEntry.findMany.mockResolvedValue([
      entry('JE-1', '2026-10-02', [[PETTY, 3000, 0], [BANK, 0, 3000]]),
      entry('JE-2', '2026-10-05', [[FUEL, 700, 0], [PETTY, 0, 700]]),
    ]);

    const r = await run(ctrl.getSummary, { query: { fund: 'revolving', from: '2026-10-01', to: '2026-10-31' } });

    expect(prisma.account.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: 1, accountCode: { in: ['1011', '1012'] } },
    }));
    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        businessId: 1, status: 'POSTED', entryDate: { lte: new Date('2026-10-31T00:00:00Z') },
        lines: { some: { accountId: { in: [11] } } },
      },
    }));
    expect(r).toMatchObject({ fund: 'revolving', opening: 0, totalIn: 3000, totalOut: 700, closing: 2300 });
    expect(r.missingCodes).toEqual(['1012']);
  });

  test('marketing fund with no account yet returns an empty summary that says the account is missing', async () => {
    prisma.account.findMany.mockResolvedValue([]);

    const r = await run(ctrl.getSummary, { query: { fund: 'marketing', from: '2026-10-01', to: '2026-10-31' } });

    expect(prisma.journalEntry.findMany).not.toHaveBeenCalled();
    expect(r).toMatchObject({ fund: 'marketing', missingCodes: ['1013'], closing: 0, rows: [] });
  });

  test('needs a valid fund and dates', async () => {
    await expect(run(ctrl.getSummary, { query: { fund: 'other', from: '2026-10-01', to: '2026-10-31' } })).rejects.toThrow('fund');
    await expect(run(ctrl.getSummary, { query: { fund: 'revolving', from: 'x', to: '2026-10-31' } })).rejects.toThrow('from');
  });
});
