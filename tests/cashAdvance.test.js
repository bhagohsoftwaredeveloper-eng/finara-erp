const { buildReleaseEntry, buildLiquidationEntry, cashSourceKind } = require('../server/utils/cashAdvance');
const { isBalanced } = require('../server/utils/finance');

const sum = (lines, side) => lines.reduce((s, l) => s + Number(l[side] || 0), 0);

describe('buildReleaseEntry', () => {
  test('debits 1104 and credits the chosen cash account', () => {
    const { lines } = buildReleaseEntry({ requestNo: 'CR-000001', amount: 5000, cashAccountCode: '1010', sourceKind: 'CASH' });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: '1104', debit: 5000 });
    expect(lines[1]).toMatchObject({ accountCode: '1010', credit: 5000, description: 'Cash released — CR-000001' });
    expect(sum(lines, 'debit')).toBeCloseTo(sum(lines, 'credit'), 2);
  });

  test("owner source: DR 1104 / CR the owner's account, labelled as owner funded", () => {
    const { lines } = buildReleaseEntry({ requestNo: 'CR-000003', amount: 15000, cashAccountCode: '2540', sourceKind: 'OWNER' });
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: '1104', debit: 15000 });
    expect(lines[1]).toMatchObject({ accountCode: '2540', credit: 15000, description: 'Owner funded cash — CR-000003' });
    expect(sum(lines, 'debit')).toBeCloseTo(sum(lines, 'credit'), 2);
  });

  test('rejects a non-positive amount', () => {
    expect(() => buildReleaseEntry({ requestNo: 'CR-1', amount: 0, cashAccountCode: '1010' }))
      .toThrow(/greater than zero/i);
    expect(() => buildReleaseEntry({ requestNo: 'CR-1', amount: -1, cashAccountCode: '1010' }))
      .toThrow(/greater than zero/i);
  });

  test('rejects a missing cash account', () => {
    expect(() => buildReleaseEntry({ requestNo: 'CR-1', amount: 100 }))
      .toThrow(/cash account/i);
  });
});

describe('buildLiquidationEntry', () => {
  const spent = [
    { accountId: 41, amount: 2400, description: 'Plywood 3/4 — 4 pcs' },
    { accountId: 42, amount: 1800, description: 'Paint — 2 gal' },
  ]; // 4,200 total

  test('RETURN: spent less than released, sukli comes back', () => {
    const r = buildLiquidationEntry({ requestNo: 'CR-000001', releasedAmount: 5000, lines: spent, cashAccountCode: '1010' });
    expect(r.mode).toBe('RETURN');
    expect(r.variance).toBeCloseTo(-800, 2);
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1010', debit: 800 }));
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1104', credit: 5000 }));
    expect(sum(r.lines, 'debit')).toBeCloseTo(sum(r.lines, 'credit'), 2);
    expect(isBalanced(r.lines)).toBe(true);
  });

  test('REIMBURSE: spent more than released, company pays the difference', () => {
    const over = [{ accountId: 41, amount: 5300, description: 'Materials' }];
    const r = buildLiquidationEntry({ requestNo: 'CR-000001', releasedAmount: 5000, lines: over, cashAccountCode: '1010' });
    expect(r.mode).toBe('REIMBURSE');
    expect(r.variance).toBeCloseTo(300, 2);
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1010', credit: 300 }));
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1104', credit: 5000 }));
    expect(sum(r.lines, 'debit')).toBeCloseTo(sum(r.lines, 'credit'), 2);
    expect(isBalanced(r.lines)).toBe(true);
  });

  test('EXACT: no cash line at all', () => {
    const exact = [{ accountId: 41, amount: 5000, description: 'Materials' }];
    const r = buildLiquidationEntry({ requestNo: 'CR-000001', releasedAmount: 5000, lines: exact, cashAccountCode: '1010' });
    expect(r.mode).toBe('EXACT');
    expect(r.variance).toBeCloseTo(0, 2);
    expect(r.lines.filter(l => l.accountCode === '1010')).toHaveLength(0);
    expect(isBalanced(r.lines)).toBe(true);
  });

  test('honours per-line accountId and falls back to a code when absent', () => {
    const mixed = [
      { accountId: 41, amount: 1000, description: 'With account' },
      { amount: 500, description: 'No account' },
    ];
    const r = buildLiquidationEntry({ requestNo: 'CR-1', releasedAmount: 1500, lines: mixed, cashAccountCode: '1010', fallbackAccountCode: '6390' });
    expect(r.lines).toContainEqual(expect.objectContaining({ accountId: 41, debit: 1000 }));
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '6390', debit: 500 }));
  });

  test('rejects an empty or zero-amount line set', () => {
    expect(() => buildLiquidationEntry({ requestNo: 'CR-1', releasedAmount: 100, lines: [], cashAccountCode: '1010' }))
      .toThrow(/at least one/i);
    expect(() => buildLiquidationEntry({ requestNo: 'CR-1', releasedAmount: 100, lines: [{ amount: 0, description: 'x' }], cashAccountCode: '1010' }))
      .toThrow(/greater than zero/i);
  });

  test('rejects a non-positive released amount', () => {
    expect(() => buildLiquidationEntry({ requestNo: 'CR-1', releasedAmount: 0, lines: spent, cashAccountCode: '1010' }))
      .toThrow(/released/i);
  });

  test("owner source: sukli goes back to the owner's account", () => {
    const r = buildLiquidationEntry({
      requestNo: 'CR-000003', releasedAmount: 15000, cashAccountCode: '2540',
      lines: [{ accountId: 61, amount: 14000, description: 'Salaries' }],
    });
    expect(r.mode).toBe('RETURN');
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '2540', debit: 1000 }));
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '1104', credit: 15000 }));
    expect(isBalanced(r.lines)).toBe(true);
  });

  test('owner source: overspending is owed to the owner', () => {
    const r = buildLiquidationEntry({
      requestNo: 'CR-000003', releasedAmount: 15000, cashAccountCode: '2540',
      lines: [{ accountId: 61, amount: 15500, description: 'Salaries' }],
    });
    expect(r.mode).toBe('REIMBURSE');
    expect(r.lines).toContainEqual(expect.objectContaining({ accountCode: '2540', credit: 500 }));
    expect(isBalanced(r.lines)).toBe(true);
  });

  test("the client's entry: exactly ₱15,000 of salaries clears 1104 with no owner line", () => {
    const r = buildLiquidationEntry({
      requestNo: 'CR-000003', releasedAmount: 15000, cashAccountCode: '2540',
      lines: [{ accountId: 61, amount: 15000, description: 'Salaries' }],
    });
    expect(r.mode).toBe('EXACT');
    expect(r.lines).toEqual([
      expect.objectContaining({ accountId: 61, debit: 15000 }),
      expect.objectContaining({ accountCode: '1104', credit: 15000 }),
    ]);
  });
});

describe('cashSourceKind', () => {
  const acct = (accountCode, accountType, accountName, isActive = true) =>
    ({ accountCode, accountType, accountName, isActive });

  test('company cash: active ASSET accounts coded 1010 to 1099', () => {
    expect(cashSourceKind(acct('1010', 'ASSET', 'Cash on Hand'))).toBe('CASH');
    expect(cashSourceKind(acct('1099', 'ASSET', 'Cash in Bank — BPI'))).toBe('CASH');
    expect(cashSourceKind(acct('1000', 'ASSET', 'Current Assets'))).toBeNull();
    expect(cashSourceKind(acct('1100', 'ASSET', 'Accounts Receivable'))).toBeNull();
    expect(cashSourceKind(acct('1104', 'ASSET', 'Advances to Officers & Employees'))).toBeNull();
  });

  test("owner's funds: active LIABILITY accounts named for an owner", () => {
    expect(cashSourceKind(acct('2540', 'LIABILITY', 'Due To Owner'))).toBe('OWNER');
    expect(cashSourceKind(acct('2541', 'LIABILITY', 'Due to Stockholders'))).toBe('OWNER');
    expect(cashSourceKind(acct('2542', 'LIABILITY', 'Loans from Shareholders'))).toBe('OWNER');
    expect(cashSourceKind(acct('2543', 'LIABILITY', 'Due to Proprietor'))).toBe('OWNER');
    expect(cashSourceKind(acct('2544', 'LIABILITY', 'Due to Partners'))).toBe('OWNER');
  });

  test('look-alikes are not cash sources', () => {
    expect(cashSourceKind(acct('2050', 'LIABILITY', "Homeowners' Dues Payable"))).toBeNull();
    expect(cashSourceKind(acct('2010', 'LIABILITY', 'Accounts Payable'))).toBeNull();
    expect(cashSourceKind(acct('1250', 'ASSET', 'Due from Owner'))).toBeNull();
    expect(cashSourceKind(acct('3010', 'EQUITY', "Share Capital / Owner's Capital"))).toBeNull();
  });

  test('inactive accounts never qualify', () => {
    expect(cashSourceKind(acct('1010', 'ASSET', 'Cash on Hand', false))).toBeNull();
    expect(cashSourceKind(acct('2540', 'LIABILITY', 'Due To Owner', false))).toBeNull();
    expect(cashSourceKind(null)).toBeNull();
  });
});
