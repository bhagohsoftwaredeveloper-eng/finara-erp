jest.mock('../server/config/database', () => ({
  invoice:              { findMany: jest.fn() },
  paymentAR:            { findMany: jest.fn() },
  bill:                 { findMany: jest.fn() },
  paymentAP:            { findMany: jest.fn() },
  inventoryTransaction: { findMany: jest.fn() },
  expenseVoucher:       { findMany: jest.fn() },
  journalLine:          { aggregate: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));

const prisma = require('../server/config/database');
const daily  = require('../server/controllers/dailyRemittanceController');
const { buildCashbook, round2 } = require('../server/utils/cashbook');

// One shared GL fixture for account 1011, keyed by date. BOTH reports are
// driven from this — that is what makes the comparison meaningful rather than
// a literal checked against another literal.
const GL_1011 = {
  '2026-08-03': { in: 0,    out: 30 },
  '2026-08-04': { in: 0,    out: 0 },
  '2026-08-05': { in: 7830, out: 7890 },
  '2026-08-06': { in: 0,    out: 0 },
};

// Run the real daily remittance controller for one date against the fixture.
const runDaily = (date) => {
  jest.clearAllMocks();
  for (const m of ['invoice', 'paymentAR', 'bill', 'paymentAP', 'inventoryTransaction', 'expenseVoucher']) {
    prisma[m].findMany.mockResolvedValue([]);
  }
  const day = GL_1011[date];
  prisma.journalLine.aggregate
    .mockResolvedValueOnce({ _sum: { debit: day.in, credit: day.out } })  // 1011
    .mockResolvedValueOnce({ _sum: { debit: 0,      credit: 0 } })        // 1012
    .mockResolvedValueOnce({ _sum: { debit: 0,      credit: 0 } });       // 1010
  return new Promise((resolve, reject) => {
    daily.calculate({ query: { date }, businessId: 1 }, { json: resolve }, reject);
  });
};

// The same fixture, in the shape the Cash Position report consumes.
const cashbook = buildCashbook(0, Object.entries(GL_1011)
  .filter(([, m]) => m.in || m.out)
  .map(([date, m]) => ({ date, ...m })));
const byDate = Object.fromEntries(cashbook.rows.map((r) => [r.date, r]));

describe('the two cash reports agree', () => {
  test.each(Object.keys(GL_1011))(
    'the daily report and the cashbook report the same outflow for %s',
    async (date) => {
      const r = await runDaily(date);
      expect(r.pettyCashOut).toBe(byDate[date]?.out ?? 0);
    },
  );

  test('the daily figures sum to the cashbook total', async () => {
    let summed = 0;
    for (const date of Object.keys(GL_1011)) {
      summed = round2(summed + (await runDaily(date)).pettyCashOut);
    }
    expect(summed).toBe(cashbook.totalOut);
  });

  test('opening plus net movement equals closing', () => {
    const net = Object.values(GL_1011).reduce((s, m) => s + m.in - m.out, 0);
    expect(cashbook.closing).toBe(round2(cashbook.opening + net));
  });

  test('a day the daily report calls zero produces no cashbook row', async () => {
    expect((await runDaily('2026-08-04')).pettyCashOut).toBe(0);
    expect(byDate['2026-08-04']).toBeUndefined();
  });
});
