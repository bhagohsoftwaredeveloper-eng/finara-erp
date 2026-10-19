const { summarizeExpenses } = require('../server/utils/expensesSummary');

const acct = (id, code, name) => ({ id, accountCode: code, accountName: name, accountType: 'EXPENSE' });
const REPR = acct(5, '6240', 'Repairs & Maintenance');
const FUEL = acct(6, '6520', 'Fuel');
const line = (account, debit, credit, extra = {}) => ({ accountId: account.id, account, debit, credit, entryDate: '2026-10-05', ...extra });

const lines = [
  line(REPR, 1500, 0, { driverId: 1, vehicleId: 7 }),
  line(REPR, 500, 0, { driverId: 2 }),
  line(REPR, 300, 0),
  line(REPR, 0, 100, { driverId: 1 }),           // a refund nets against the account
  line(FUEL, 700, 0, { entryDate: '2026-09-20', vehicleId: 7 }),
];

describe('summarizeExpenses', () => {
  test('by account: net amount, line count and share of the total, biggest first', () => {
    const r = summarizeExpenses(lines, { groupBy: 'account' });

    expect(r.rows).toEqual([
      { key: '5', label: '6240 · Repairs & Maintenance', amount: 2200, count: 4, pct: 75.9 },
      { key: '6', label: '6520 · Fuel', amount: 700, count: 1, pct: 24.1 },
    ]);
    expect(r.total).toBe(2900);
  });

  test('by driver: uses the driver labels and puts untagged spending in its own row', () => {
    const labels = new Map([[1, 'DRV-001 · Juan'], [2, 'DRV-002 · Pedro']]);

    const r = summarizeExpenses(lines, { groupBy: 'driver', labels });

    expect(r.rows.map((x) => [x.label, x.amount])).toEqual([
      ['Untagged', 1000], ['DRV-001 · Juan', 1400], ['DRV-002 · Pedro', 500],
    ].sort((a, b) => b[1] - a[1]));
    expect(r.total).toBe(2900);
  });

  test('by vehicle', () => {
    const r = summarizeExpenses(lines, { groupBy: 'vehicle', labels: new Map([[7, 'ABC 123']]) });

    expect(r.rows.find((x) => x.label === 'ABC 123').amount).toBe(2200);
    expect(r.rows.find((x) => x.label === 'Untagged').amount).toBe(700);
  });

  test('by month, oldest first', () => {
    const r = summarizeExpenses(lines, { groupBy: 'month' });

    expect(r.rows.map((x) => [x.key, x.label, x.amount])).toEqual([
      ['2026-09', 'September 2026', 700], ['2026-10', 'October 2026', 2200],
    ]);
  });

  test('no lines gives an empty summary', () => {
    expect(summarizeExpenses([], { groupBy: 'account' })).toEqual({ rows: [], total: 0 });
  });

  test('an unknown groupBy is an error', () => {
    expect(() => summarizeExpenses(lines, { groupBy: 'colour' })).toThrow('groupBy');
  });
});
