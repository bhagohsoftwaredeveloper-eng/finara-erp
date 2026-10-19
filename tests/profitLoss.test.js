const {
  sectionOf, buildStatement, assignByTag, assignByRange, withChange,
} = require('../server/utils/profitLoss');

const acct = (id, code, name, accountType) => ({ id, accountCode: code, accountName: name, accountType });
const REV   = acct(1, '4010', 'Service Revenue', 'REVENUE');
const DISC  = acct(2, '4090', 'Sales Discounts', 'REVENUE');
const INT   = acct(3, '4600', 'Interest Income', 'REVENUE');
const COGS  = acct(4, '5010', 'Cost of Sales', 'EXPENSE');
const REPR  = acct(5, '6240', 'Repairs & Maintenance', 'EXPENSE');
const IEXP  = acct(6, '7010', 'Interest Expense', 'EXPENSE');

const line = (account, debit, credit, extra = {}) => ({ accountId: account.id, account, debit, credit, ...extra });

describe('sectionOf', () => {
  test.each([
    [REV, 'revenue'], [DISC, 'revenue'], [INT, 'otherIncome'],
    [COGS, 'cogs'], [REPR, 'opex'], [IEXP, 'otherExpense'],
    [acct(9, '8100', 'Odd expense', 'EXPENSE'), 'opex'],
  ])('%j -> %s', (account, section) => {
    expect(sectionOf(account)).toBe(section);
  });
});

describe('buildStatement', () => {
  const columns = [{ key: 't1', label: 'DRV-001' }, { key: 't2', label: 'DRV-002' }, { key: 'untagged', label: 'Untagged' }];
  const lines = [
    line(REV, 0, 10000, { col: 'untagged' }),
    line(COGS, 2000, 0, { col: 'untagged' }),
    line(REPR, 1500, 0, { col: 't1' }),
    line(REPR, 500, 0, { col: 't2' }),
    line(REPR, 300, 0, { col: 'untagged' }),
  ];

  test('groups accounts into sections with a value per column and a row total', () => {
    const s = buildStatement(lines, columns);

    const bySection = Object.fromEntries(s.sections.map((x) => [x.key, x]));
    expect(bySection.revenue.accounts).toEqual([
      { id: 1, code: '4010', name: 'Service Revenue', values: [0, 0, 10000], total: 10000 },
    ]);
    expect(bySection.opex.accounts[0]).toMatchObject({ code: '6240', values: [1500, 500, 300], total: 2300 });
    expect(bySection.opex.totals).toEqual({ values: [1500, 500, 300], total: 2300 });
    expect(bySection.cogs.totals.total).toBe(2000);
  });

  test('gross profit, operating income and net income per column', () => {
    const s = buildStatement(lines, columns);

    expect(s.summary.grossProfit).toEqual({ values: [0, 0, 8000], total: 8000 });
    expect(s.summary.operatingIncome).toEqual({ values: [-1500, -500, 7700], total: 5700 });
    expect(s.summary.netIncome).toEqual({ values: [-1500, -500, 7700], total: 5700 });
  });

  test('other income and other expense only touch net income', () => {
    const s = buildStatement([
      line(REV, 0, 1000, { col: 'a' }), line(INT, 0, 50, { col: 'a' }), line(IEXP, 20, 0, { col: 'a' }),
    ], [{ key: 'a', label: 'A' }]);

    expect(s.summary.operatingIncome.total).toBe(1000);
    expect(s.summary.netIncome.total).toBe(1030);
  });

  test('a contra-revenue account (discounts) reduces revenue', () => {
    const s = buildStatement([line(REV, 0, 1000, { col: 'a' }), line(DISC, 100, 0, { col: 'a' })], [{ key: 'a', label: 'A' }]);

    expect(s.sections.find((x) => x.key === 'revenue').totals.total).toBe(900);
  });

  test('when no revenue account falls in 4000-4499 the revenue accounts are all treated as revenue', () => {
    const s = buildStatement([line(INT, 0, 700, { col: 'a' })], [{ key: 'a', label: 'A' }]);

    expect(s.sections.find((x) => x.key === 'revenue').totals.total).toBe(700);
    expect(s.sections.find((x) => x.key === 'otherIncome').accounts).toEqual([]);
  });

  test('lines with no column are ignored', () => {
    const s = buildStatement([line(REV, 0, 500, { col: null }), line(REV, 0, 100, { col: 'a' })], [{ key: 'a', label: 'A' }]);

    expect(s.summary.netIncome.total).toBe(100);
  });
});

describe('assignByTag', () => {
  const labels = new Map([[1, 'DRV-001 · Juan'], [2, 'DRV-002 · Pedro']]);

  test('one column per tag in use, sorted by label, with Untagged last', () => {
    const lines = [
      { driverId: 2, account: REPR, debit: 1, credit: 0 },
      { driverId: 1, account: REPR, debit: 1, credit: 0 },
      { driverId: null, account: REPR, debit: 1, credit: 0 },
    ];

    const r = assignByTag(lines, 'driver', labels);

    expect(r.columns).toEqual([
      { key: 't1', label: 'DRV-001 · Juan' }, { key: 't2', label: 'DRV-002 · Pedro' }, { key: 'untagged', label: 'Untagged' },
    ]);
    expect(r.lines.map((l) => l.col)).toEqual(['t2', 't1', 'untagged']);
  });

  test('no Untagged column when everything is tagged; vehicles use vehicleId', () => {
    const r = assignByTag([{ vehicleId: 7, account: REPR, debit: 1, credit: 0 }], 'vehicle', new Map([[7, 'ABC 123']]));

    expect(r.columns).toEqual([{ key: 't7', label: 'ABC 123' }]);
  });

  test('a tag id that is not in the list still gets a column', () => {
    const r = assignByTag([{ driverId: 9, account: REPR, debit: 1, credit: 0 }], 'driver', new Map());

    expect(r.columns).toEqual([{ key: 't9', label: 'Driver #9' }]);
  });
});

describe('assignByRange and withChange', () => {
  const ranges = [
    { from: '2026-09-01', to: '2026-09-30', label: 'Sep 2026' },
    { from: '2026-10-01', to: '2026-10-31', label: 'Oct 2026' },
  ];
  const lines = [
    line(REV, 0, 1000, { entryDate: '2026-09-10' }),
    line(REV, 0, 1500, { entryDate: '2026-10-05' }),
    line(REPR, 200, 0, { entryDate: '2026-10-06' }),
    line(REV, 0, 999, { entryDate: '2026-08-31' }), // outside every range
  ];

  test('each line lands in the range that contains its date', () => {
    const r = assignByRange(lines, ranges);

    expect(r.columns).toEqual([{ key: 'r0', label: 'Sep 2026' }, { key: 'r1', label: 'Oct 2026' }]);
    expect(r.lines.map((l) => l.col)).toEqual(['r0', 'r1', 'r1', null]);
  });

  test('change compares the newest column with the one before it', () => {
    const { columns, lines: assigned } = assignByRange(lines, ranges);
    const s = withChange(buildStatement(assigned, columns));

    const revenue = s.sections.find((x) => x.key === 'revenue');
    expect(revenue.accounts[0]).toMatchObject({ values: [1000, 1500], change: 500, changePct: 50 });
    expect(revenue.totals).toMatchObject({ change: 500, changePct: 50 });
    expect(s.summary.netIncome).toMatchObject({ values: [1000, 1300], change: 300, changePct: 30 });
  });

  test('a single column has no change, and a zero previous value has no percentage', () => {
    const one = withChange(buildStatement([line(REV, 0, 10, { col: 'a' })], [{ key: 'a', label: 'A' }]));
    expect(one.summary.netIncome.change).toBeNull();

    const zeroPrev = withChange(buildStatement([line(REV, 0, 10, { col: 'b' })], [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }]));
    expect(zeroPrev.summary.netIncome).toMatchObject({ change: 10, changePct: null });
  });
});
