jest.mock('../server/config/database', () => ({
  systemSetting: { findUnique: jest.fn(), upsert: jest.fn() },
  account: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  journalEntry: { findMany: jest.fn(), findFirst: jest.fn() },
  journalLine: { findMany: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ post: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
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

describe('marketing allocation', () => {
  const REV  = acct(1, '4010', 'Service Revenue', 'REVENUE');
  const REPR = acct(5, '6240', 'Repairs', 'EXPENSE');
  const gl = (account, debit, credit, date) => ({ accountId: account.id, account, debit, credit, entry: { entryDate: new Date(`${date}T00:00:00Z`) } });
  const enabled = JSON.stringify({ marketing: { enabled: true, percent: 10 } });
  const query = { month: '2026-10' };

  beforeEach(() => {
    prisma.systemSetting.findUnique.mockResolvedValue({ value: enabled });
    prisma.journalLine.findMany.mockResolvedValue([gl(REV, 0, 10000, '2026-10-02'), gl(REPR, 2000, 0, '2026-10-05')]);
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    prisma.account.findMany.mockResolvedValue([acct(70, '1013', 'Marketing Fund'), acct(20, '1020', 'Cash in Bank')]);
    glPost.post.mockResolvedValue({ id: 99, entryNo: 'JE-1-000099' });
  });

  test('preview: the percent of that month’s net income, and whether it was already allocated', async () => {
    const r = await run(ctrl.getAllocation, { query });

    expect(r).toMatchObject({
      month: '2026-10', from: '2026-10-01', to: '2026-10-31', netIncome: 8000, percent: 10, amount: 800,
      enabled: true, alreadyAllocated: null, accountsMissing: [],
    });
    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: 1, reference: 'MKT-ALLOC-2026-10', status: 'POSTED' },
    }));
  });

  test('preview: a loss or zero month allocates nothing, and a missing account is listed', async () => {
    prisma.journalLine.findMany.mockResolvedValue([gl(REV, 0, 1000, '2026-10-02'), gl(REPR, 3000, 0, '2026-10-05')]);
    prisma.account.findMany.mockResolvedValue([acct(20, '1020', 'Cash in Bank')]);

    const r = await run(ctrl.getAllocation, { query });

    expect(r).toMatchObject({ netIncome: -2000, amount: 0, accountsMissing: ['1013'] });
  });

  test('posting books DR marketing fund / CR source cash on the last day of the month', async () => {
    const r = await run(ctrl.postAllocation, { user: { id: 3 }, body: query });

    expect(glPost.post).toHaveBeenCalledWith(expect.objectContaining({
      entryDate: '2026-10-31', reference: 'MKT-ALLOC-2026-10', businessId: 1, userId: 3,
      lines: [
        { accountCode: '1013', debit: 800, description: expect.stringContaining('10%') },
        { accountCode: '1020', credit: 800, description: expect.stringContaining('2026-10') },
      ],
    }));
    expect(r).toMatchObject({ amount: 800, entryNo: 'JE-1-000099' });
  });

  test.each([
    ['the fund is switched off', () => prisma.systemSetting.findUnique.mockResolvedValue(null), 'switched on'],
    ['already allocated', () => prisma.journalEntry.findFirst.mockResolvedValue({ entryNo: 'JE-7' }), 'already'],
    ['no net income', () => prisma.journalLine.findMany.mockResolvedValue([gl(REV, 0, 100, '2026-10-02'), gl(REPR, 200, 0, '2026-10-03')]), 'net income'],
    ['an account is missing', () => prisma.account.findMany.mockResolvedValue([]), 'account'],
  ])('posting is refused when %s', async (_name, arrange, msg) => {
    arrange();

    await expect(run(ctrl.postAllocation, { body: query })).rejects.toThrow(msg);
    expect(glPost.post).not.toHaveBeenCalled();
  });

  test('a month before the books start is refused', async () => {
    glPost.post.mockResolvedValue({ skipped: 'PRE_CUTOVER' });

    await expect(run(ctrl.postAllocation, { body: query })).rejects.toThrow('books');
  });

  test('the month must look like YYYY-MM', async () => {
    await expect(run(ctrl.getAllocation, { query: { month: 'October' } })).rejects.toThrow('month');
    await expect(run(ctrl.postAllocation, { body: { month: '2026-13' } })).rejects.toThrow('month');
  });
});
