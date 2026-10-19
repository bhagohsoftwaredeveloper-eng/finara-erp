const { buildFundSummary } = require('../server/utils/fundLedger');

const acct = (id, code, name, accountType = 'ASSET') => ({ id, accountCode: code, accountName: name, accountType });
const PETTY = acct(11, '1011', 'Petty Cash Fund');
const GCASH = acct(12, '1012', 'Cash — GCash');
const BANK  = acct(20, '1020', 'Cash in Bank');
const FUEL  = acct(30, '6520', 'Fuel', 'EXPENSE');
const REPR  = acct(31, '6240', 'Repairs & Maintenance', 'EXPENSE');
const SUPP  = acct(32, '6320', 'Office Supplies', 'EXPENSE');

const entry = (entryNo, date, reference, lines, description = 'x') => ({
  id: entryNo, entryNo, entryDate: new Date(`${date}T00:00:00Z`), reference, description,
  lines: lines.map(([account, debit, credit]) => ({ accountId: account.id, account, debit, credit })),
});

const entries = [
  entry('JE-1', '2026-09-15', 'REPL-0', [[PETTY, 5000, 0], [BANK, 0, 5000]], 'Replenish'),            // before the range
  entry('JE-2', '2026-10-02', 'REPL-1', [[PETTY, 3000, 0], [BANK, 0, 3000]], 'Replenish'),
  entry('JE-3', '2026-10-05', 'EV-000001', [[FUEL, 700, 0], [PETTY, 0, 700]], 'Fuel'),
  entry('JE-4', '2026-10-06', 'EV-000002', [[REPR, 1200, 0], [SUPP, 300, 0], [PETTY, 0, 1500]], 'Repairs and supplies'),
  entry('JE-5', '2026-10-07', 'EV-000003', [[FUEL, 200, 0], [GCASH, 0, 200]], 'GCash fuel'),
  entry('JE-6', '2026-11-03', 'EV-000009', [[FUEL, 50, 0], [PETTY, 0, 50]], 'After the range'),
];

const summary = () => buildFundSummary(entries, { fundAccounts: [PETTY, GCASH], from: '2026-10-01', to: '2026-10-31' });

describe('buildFundSummary', () => {
  test('opening balance, money in, money out and closing balance', () => {
    const s = summary();

    expect(s.opening).toBe(5000);
    expect(s.totalIn).toBe(3000);
    expect(s.totalOut).toBe(2400);
    expect(s.closing).toBe(5600);
  });

  test('one block per fund account', () => {
    const s = summary();

    expect(s.accounts).toEqual([
      { id: 11, code: '1011', name: 'Petty Cash Fund', opening: 5000, in: 3000, out: 2200, closing: 5800 },
      { id: 12, code: '1012', name: 'Cash — GCash',    opening: 0,    in: 0,    out: 200,  closing: -200 },
    ]);
  });

  test('the ledger lists the entries in the range with a running balance', () => {
    const s = summary();

    expect(s.rows.map((r) => [r.entryNo, r.in, r.out, r.balance])).toEqual([
      ['JE-2', 3000, 0, 8000],
      ['JE-3', 0, 700, 7300],
      ['JE-4', 0, 1500, 5800],
      ['JE-5', 0, 200, 5600],
    ]);
    expect(s.rows[1]).toMatchObject({ date: '2026-10-05', reference: 'EV-000003'.replace('3', '1'), description: 'Fuel' });
  });

  test('disbursements are broken down by the accounts the money was spent on', () => {
    const s = summary();

    expect(s.disbursements).toEqual([
      { label: '6240 · Repairs & Maintenance', amount: 1200 },
      { label: '6520 · Fuel', amount: 900 },
      { label: '6320 · Office Supplies', amount: 300 },
    ]);
    expect(s.disbursements.reduce((t, d) => t + d.amount, 0)).toBe(s.totalOut);
  });

  test('replenishments are broken down by where the money came from', () => {
    expect(summary().replenishments).toEqual([{ label: '1020 · Cash in Bank', amount: 3000 }]);
  });

  test('a withdrawal with no other debit line is reported as unclassified', () => {
    const s = buildFundSummary(
      [entry('JE-7', '2026-10-09', 'X', [[PETTY, 0, 100]])],
      { fundAccounts: [PETTY], from: '2026-10-01', to: '2026-10-31' },
    );

    expect(s.disbursements).toEqual([{ label: 'Unclassified', amount: 100 }]);
  });

  test('a transfer between two fund accounts is neither in nor out of the combined fund', () => {
    const s = buildFundSummary(
      [entry('JE-8', '2026-10-09', 'T', [[GCASH, 400, 0], [PETTY, 0, 400]], 'Move to GCash')],
      { fundAccounts: [PETTY, GCASH], from: '2026-10-01', to: '2026-10-31' },
    );

    expect(s.totalIn).toBe(0);
    expect(s.totalOut).toBe(0);
    expect(s.accounts.map((a) => [a.in, a.out])).toEqual([[0, 400], [400, 0]]);
  });

  test('no entries gives an empty zero summary', () => {
    const s = buildFundSummary([], { fundAccounts: [PETTY], from: '2026-10-01', to: '2026-10-31' });

    expect(s).toMatchObject({ opening: 0, totalIn: 0, totalOut: 0, closing: 0, rows: [], disbursements: [], replenishments: [] });
    expect(s.accounts).toEqual([{ id: 11, code: '1011', name: 'Petty Cash Fund', opening: 0, in: 0, out: 0, closing: 0 }]);
  });
});
