jest.mock('../server/config/database', () => ({
  account:     { findMany: jest.fn() },
  journalLine: { aggregate: jest.fn(), findMany: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/cashPositionController');

const call = (query) => new Promise((resolve, reject) => {
  ctrl.report({ query, businessId: 1 }, { json: resolve }, (err) => reject(err));
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.account.findMany.mockResolvedValue([
    { id: 3, accountCode: '1011', accountName: 'Petty Cash Fund', children: [] },
  ]);
  prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: null, credit: null } });
  prisma.journalLine.findMany.mockResolvedValue([]);
});

// A GL line as the controller selects it.
const line = (date, debit, credit) => ({
  debit, credit, entry: { entryDate: new Date(`${date}T00:00:00.000Z`) },
});

describe('GET /reports/cash-position', () => {
  test('rejects a missing date range', async () => {
    await expect(call({ from: '2026-08-01' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects from later than to', async () => {
    await expect(call({ from: '2026-08-09', to: '2026-08-01' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('rejects a range wider than 366 days', async () => {
    await expect(call({ from: '2025-01-01', to: '2026-06-01' })).rejects.toMatchObject({ statusCode: 400 });
  });

  test('excludes header accounts such as 1000 Current Assets', async () => {
    await call({ from: '2026-08-01', to: '2026-08-06' });
    const where = prisma.account.findMany.mock.calls[0][0].where;
    expect(where.accountType).toBe('ASSET');
    expect(where.accountCode.startsWith).toBe('10');
    expect(where.children).toEqual({ none: {} });
  });

  test('a non-cash asset account cannot be requested', async () => {
    prisma.account.findMany.mockResolvedValue([]);
    await expect(call({ from: '2026-08-01', to: '2026-08-06', accountCode: '1104' }))
      .rejects.toMatchObject({ statusCode: 400 });
  });

  test('the 10xx prefix still applies when a code is requested', async () => {
    await call({ from: '2026-08-01', to: '2026-08-06', accountCode: '1011' });
    const where = prisma.account.findMany.mock.calls[0][0].where;
    expect(where.accountCode).toEqual({ startsWith: '10', equals: '1011' });
  });

  test('counts only POSTED entries', async () => {
    await call({ from: '2026-08-01', to: '2026-08-06' });
    expect(prisma.journalLine.aggregate.mock.calls[0][0].where.entry.status).toBe('POSTED');
  });

  test('builds a chained cashbook from GL movement', async () => {
    prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: 0, credit: 0 } });
    // Aug 5 arrives as several lines and must collapse into one day bucket.
    prisma.journalLine.findMany.mockResolvedValue([
      line('2026-08-03', 0,    30),
      line('2026-08-05', 7830, 0),
      line('2026-08-05', 0,    7890),
    ]);
    const r = await call({ from: '2026-08-01', to: '2026-08-06' });
    const acct = r.accounts[0];
    expect(acct.accountCode).toBe('1011');
    expect(acct.opening).toBe(0);
    expect(acct.closing).toBe(-90);
    expect(acct.totalIn).toBe(7830);
    expect(acct.totalOut).toBe(7920);
    expect(acct.rows).toHaveLength(2);
    expect(acct.rows[1].begin).toBe(-30);
  });

  test('returns an empty accounts array when the business has no cash accounts', async () => {
    prisma.account.findMany.mockResolvedValue([]);
    const r = await call({ from: '2026-08-01', to: '2026-08-06' });
    expect(r.accounts).toEqual([]);
  });

  test('a range with no movement opens and closes the same', async () => {
    prisma.journalLine.aggregate.mockResolvedValue({ _sum: { debit: 100, credit: 40 } });
    const r = await call({ from: '2026-08-01', to: '2026-08-06' });
    expect(r.accounts[0].opening).toBe(60);
    expect(r.accounts[0].closing).toBe(60);
    expect(r.accounts[0].rows).toEqual([]);
  });
});
