jest.mock('../server/config/database', () => ({
  journalLine: { findMany: jest.fn() },
  driver:  { findMany: jest.fn() },
  vehicle: { findMany: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/profitLossController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const acct = (id, code, name, accountType) => ({ id, accountCode: code, accountName: name, accountType });
const REV  = acct(1, '4010', 'Service Revenue', 'REVENUE');
const REPR = acct(5, '6240', 'Repairs & Maintenance', 'EXPENSE');
const gl = (account, debit, credit, date, extra = {}) => ({
  accountId: account.id, account, debit, credit, entry: { entryDate: new Date(`${date}T00:00:00Z`) }, ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.driver.findMany.mockResolvedValue([{ id: 1, code: 'DRV-001', name: 'Juan' }]);
  prisma.vehicle.findMany.mockResolvedValue([{ id: 7, code: 'ABC 123', description: 'Isuzu Elf' }]);
  prisma.journalLine.findMany.mockResolvedValue([
    gl(REV, 0, 10000, '2026-10-02'),
    gl(REPR, 1500, 0, '2026-10-05', { driverId: 1, vehicleId: 7 }),
    gl(REPR, 300, 0, '2026-09-20'),
  ]);
});

describe('getProfitLoss, by driver', () => {
  const q = (extra = {}) => ({ mode: 'tag', dimension: 'driver', from: '2026-10-01', to: '2026-10-31', ...extra });

  test('reads POSTED revenue and expense lines of this business for the period', async () => {
    await run(ctrl.getProfitLoss, { query: q() });

    expect(prisma.journalLine.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        entry: { businessId: 1, status: 'POSTED', entryDate: { gte: new Date('2026-10-01T00:00:00Z'), lte: new Date('2026-10-31T00:00:00Z') } },
        account: { accountType: { in: ['REVENUE', 'EXPENSE'] } },
      },
    }));
  });

  test('columns are the drivers in use plus Untagged, with a net income per column', async () => {
    const r = await run(ctrl.getProfitLoss, { query: q() });

    expect(r.mode).toBe('tag');
    expect(r.columns.map((c) => c.label)).toEqual(['DRV-001 · Juan', 'Untagged']);
    const opex = r.sections.find((s) => s.key === 'opex');
    expect(opex.accounts[0].values).toEqual([1500, 300]);
    expect(r.summary.netIncome.values).toEqual([-1500, 9700]);
  });

  test('can be limited to one driver or one vehicle', async () => {
    await run(ctrl.getProfitLoss, { query: q({ driverId: '1' }) });
    expect(prisma.journalLine.findMany.mock.calls[0][0].where).toMatchObject({ driverId: 1 });

    await run(ctrl.getProfitLoss, { query: q({ dimension: 'vehicle', vehicleId: '7' }) });
    expect(prisma.journalLine.findMany.mock.calls[1][0].where).toMatchObject({ vehicleId: 7 });
  });

  test('rejects a bad dimension or dates', async () => {
    await expect(run(ctrl.getProfitLoss, { query: q({ dimension: 'colour' }) })).rejects.toThrow('dimension');
    await expect(run(ctrl.getProfitLoss, { query: q({ from: 'x' }) })).rejects.toThrow('from');
    await expect(run(ctrl.getProfitLoss, { query: { mode: 'weird' } })).rejects.toThrow('mode');
  });
});

describe('getProfitLoss, comparative', () => {
  test('one column per range, change between the last two, one query spanning every range', async () => {
    const r = await run(ctrl.getProfitLoss, {
      query: { mode: 'compare', ranges: '2026-09-01:2026-09-30,2026-10-01:2026-10-31' },
    });

    expect(prisma.journalLine.findMany.mock.calls[0][0].where.entry.entryDate).toEqual({
      gte: new Date('2026-09-01T00:00:00Z'), lte: new Date('2026-10-31T00:00:00Z'),
    });
    expect(r.columns.map((c) => c.label)).toEqual(['Sep 2026', 'Oct 2026']);
    expect(r.summary.netIncome).toMatchObject({ values: [-300, 8500], change: 8800 });
  });

  test('needs 1 to 3 valid ranges', async () => {
    await expect(run(ctrl.getProfitLoss, { query: { mode: 'compare', ranges: '' } })).rejects.toThrow('ranges');
  });
});

describe('getExpensesSummary', () => {
  const q = (extra = {}) => ({ from: '2026-09-01', to: '2026-10-31', groupBy: 'account', ...extra });

  test('reads only POSTED expense lines and groups them', async () => {
    prisma.journalLine.findMany.mockResolvedValue([
      gl(REPR, 1500, 0, '2026-10-05', { driverId: 1 }), gl(REPR, 300, 0, '2026-09-20'),
    ]);

    const r = await run(ctrl.getExpensesSummary, { query: q() });

    expect(prisma.journalLine.findMany.mock.calls[0][0].where).toMatchObject({
      entry: { businessId: 1, status: 'POSTED' }, account: { accountType: 'EXPENSE' },
    });
    expect(r.rows).toEqual([{ key: '5', label: '6240 · Repairs & Maintenance', amount: 1800, count: 2, pct: 100 }]);
    expect(r.total).toBe(1800);
  });

  test('can be limited to one account and grouped by driver with the driver labels', async () => {
    prisma.journalLine.findMany.mockResolvedValue([gl(REPR, 1500, 0, '2026-10-05', { driverId: 1 })]);

    const r = await run(ctrl.getExpensesSummary, { query: q({ groupBy: 'driver', accountId: '5' }) });

    expect(prisma.journalLine.findMany.mock.calls[0][0].where).toMatchObject({ accountId: 5 });
    expect(r.rows[0].label).toBe('DRV-001 · Juan');
  });

  test('rejects a bad groupBy or dates', async () => {
    await expect(run(ctrl.getExpensesSummary, { query: q({ groupBy: 'colour' }) })).rejects.toThrow('groupBy');
    await expect(run(ctrl.getExpensesSummary, { query: q({ to: '2026-08-01' }) })).rejects.toThrow('from');
  });
});
