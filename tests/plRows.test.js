const { flattenStatement } = require('../lib/plRows');

const sec = (key, label, accounts) => ({
  key, label,
  accounts: accounts.map(([code, name, values]) => ({ id: code, code, name, values, total: values.reduce((a, b) => a + b, 0) })),
  totals: { values: [0, 0], total: 0 },
});
const withTotals = (s) => ({
  ...s, totals: { values: s.accounts.length ? s.accounts[0].values.map((_, i) => s.accounts.reduce((t, a) => t + a.values[i], 0)) : [0, 0],
    total: s.accounts.reduce((t, a) => t + a.total, 0) },
});

const statement = {
  columns: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }],
  sections: [
    withTotals(sec('revenue', 'Revenue', [['4010', 'Service Revenue', [100, 200]]])),
    withTotals(sec('cogs', 'Cost of Sales', [])),
    withTotals(sec('opex', 'Operating Expenses', [['6240', 'Repairs', [10, 20]]])),
    withTotals(sec('otherIncome', 'Other Income', [])),
    withTotals(sec('otherExpense', 'Other Expenses', [])),
  ],
  summary: {
    grossProfit: { values: [100, 200], total: 300 },
    operatingIncome: { values: [90, 180], total: 270 },
    netIncome: { values: [90, 180], total: 270 },
  },
};

describe('flattenStatement', () => {
  test('lists non-empty sections with their accounts and totals, then net income', () => {
    const rows = flattenStatement(statement);

    expect(rows.map((r) => [r.type, r.label])).toEqual([
      ['header', 'Revenue'], ['account', '4010 · Service Revenue'], ['total', 'Total Revenue'],
      ['header', 'Operating Expenses'], ['account', '6240 · Repairs'], ['total', 'Total Operating Expenses'],
      ['summary', 'Net Income'],
    ]);
  });

  test('gross profit appears only with cost of sales, operating income only with other income or expense', () => {
    const full = {
      ...statement,
      sections: statement.sections.map((s) => (s.key === 'cogs' ? withTotals(sec('cogs', 'Cost of Sales', [['5010', 'COGS', [5, 5]]]))
        : s.key === 'otherExpense' ? withTotals(sec('otherExpense', 'Other Expenses', [['7010', 'Interest', [1, 1]]])) : s)),
    };

    const labels = flattenStatement(full).map((r) => r.label);

    expect(labels).toContain('Gross Profit');
    expect(labels).toContain('Operating Income');
    expect(labels.indexOf('Gross Profit')).toBeLessThan(labels.indexOf('Operating Expenses'));
    expect(labels[labels.length - 1]).toBe('Net Income');
  });

  test('rows carry values and totals; change only when asked for', () => {
    const withChange = {
      ...statement,
      sections: statement.sections.map((s) => ({ ...s, accounts: s.accounts.map((a) => ({ ...a, change: 5, changePct: 2.5 })), totals: { ...s.totals, change: 5, changePct: 2.5 } })),
      summary: { ...statement.summary, netIncome: { ...statement.summary.netIncome, change: 7, changePct: 1 } },
    };

    const rows = flattenStatement(withChange, { showChange: true });
    expect(rows[1]).toMatchObject({ type: 'account', values: [100, 200], total: 300, change: 5, changePct: 2.5 });
    expect(rows[rows.length - 1]).toMatchObject({ type: 'summary', change: 7 });

    expect(flattenStatement(withChange)[1]).not.toHaveProperty('change');
  });
});
