jest.mock('../server/config/database', () => ({
  invoice:  { findMany: jest.fn() },
  cashSale: { findMany: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/salesSummaryController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const acct = { accountCode: '4010', accountName: 'Service Revenue' };
const invoice = {
  invoiceNo: 'INV-1', invoiceDate: new Date('2026-10-05T00:00:00Z'), status: 'OPEN',
  subtotal: 1000, vatAmount: 120, totalAmount: 1120, customer: { name: 'ACME' },
  lines: [{ description: 'Consulting', amount: 1000, account: acct }],
};
const cashSale = {
  saleNo: 'CS-1', saleDate: new Date('2026-10-07T00:00:00Z'), status: 'ACTIVE', buyerName: null,
  subtotal: 300, vatAmount: 36, totalAmount: 336, account: { accountCode: '4000', accountName: 'Sales' },
  items: [{ description: 'Widget', amount: 300 }],
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.invoice.findMany.mockResolvedValue([invoice]);
  prisma.cashSale.findMany.mockResolvedValue([cashSale]);
});

describe('getSummary, by period', () => {
  test('loads this business’s non-void invoices and cash sales for the range', async () => {
    await run(ctrl.getSummary, { query: { mode: 'period', from: '2026-10-01', to: '2026-10-31', groupBy: 'month' } });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: 1, status: { not: 'VOID' }, invoiceDate: { gte: new Date('2026-10-01T00:00:00Z'), lte: new Date('2026-10-31T00:00:00Z') } },
    }));
    expect(prisma.cashSale.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: 1, status: { not: 'VOID' }, saleDate: { gte: new Date('2026-10-01T00:00:00Z'), lte: new Date('2026-10-31T00:00:00Z') } },
    }));
  });

  test('returns one monthly row with both sources combined', async () => {
    const r = await run(ctrl.getSummary, { query: { mode: 'period', from: '2026-10-01', to: '2026-10-31', groupBy: 'month' } });

    expect(r.mode).toBe('period');
    expect(r.groupBy).toBe('month');
    expect(r.rows).toEqual([
      { key: '2026-10-01', label: 'October 2026', count: 2, net: 1300, vat: 156, total: 1456 },
    ]);
    expect(r.totals).toEqual({ count: 2, net: 1300, vat: 156, total: 1456 });
  });

  test('rejects bad dates, from after to, and an unknown groupBy', async () => {
    await expect(run(ctrl.getSummary, { query: { mode: 'period', from: 'x', to: '2026-10-31', groupBy: 'month' } })).rejects.toThrow('from');
    await expect(run(ctrl.getSummary, { query: { mode: 'period', from: '2026-11-01', to: '2026-10-31', groupBy: 'month' } })).rejects.toThrow('from');
    await expect(run(ctrl.getSummary, { query: { mode: 'period', from: '2026-10-01', to: '2026-10-31', groupBy: 'decade' } })).rejects.toThrow('groupBy');
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  test('rejects a range that would produce an absurd number of rows', async () => {
    await expect(run(ctrl.getSummary, { query: { mode: 'period', from: '2000-01-01', to: '2026-10-31', groupBy: 'day' } }))
      .rejects.toThrow('too many');
  });
});

describe('getSummary, comparative', () => {
  const q = (extra = {}) => ({
    mode: 'compare', dimension: 'account', ranges: '2026-09-01:2026-09-30,2026-10-01:2026-10-31', ...extra,
  });

  test('loads one span covering every range and returns a column per range', async () => {
    const r = await run(ctrl.getSummary, { query: q() });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ invoiceDate: { gte: new Date('2026-09-01T00:00:00Z'), lte: new Date('2026-10-31T00:00:00Z') } }),
    }));
    expect(r.dimension).toBe('account');
    expect(r.ranges.map((x) => x.label)).toEqual(['Sep 2026', 'Oct 2026']);
    expect(r.rows[0]).toMatchObject({ label: '4010 · Service Revenue', values: [0, 1000] });
    expect(r.totals.values).toEqual([0, 1300]);
  });

  test('uses the range labels the caller sends when there are any', async () => {
    const r = await run(ctrl.getSummary, { query: q({ ranges: '2026-10-01:2026-10-15,2026-10-16:2026-10-31', labels: 'First half,Second half' }) });

    expect(r.ranges.map((x) => x.label)).toEqual(['First half', 'Second half']);
  });

  test('requires a valid dimension and 1 to 3 valid ranges', async () => {
    await expect(run(ctrl.getSummary, { query: q({ dimension: 'colour' }) })).rejects.toThrow('dimension');
    await expect(run(ctrl.getSummary, { query: q({ ranges: '' }) })).rejects.toThrow('ranges');
    await expect(run(ctrl.getSummary, { query: q({ ranges: '2026-10-01:2026-09-01' }) })).rejects.toThrow('ranges');
    await expect(run(ctrl.getSummary, { query: q({ ranges: 'a:b' }) })).rejects.toThrow('ranges');
    await expect(run(ctrl.getSummary, {
      query: q({ ranges: '2026-07-01:2026-07-31,2026-08-01:2026-08-31,2026-09-01:2026-09-30,2026-10-01:2026-10-31' }),
    })).rejects.toThrow('ranges');
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });
});

describe('getSummary, mode', () => {
  test('an unknown mode is rejected', async () => {
    await expect(run(ctrl.getSummary, { query: { mode: 'weird' } })).rejects.toThrow('mode');
  });
});
