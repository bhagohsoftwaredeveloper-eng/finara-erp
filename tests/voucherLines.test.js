const { normalizeVoucherItems, totalDebit } = require('../server/utils/voucherLines');

describe('normalizeVoucherItems', () => {
  test('debit-only vouchers keep the original single-sided behaviour', () => {
    const rows = normalizeVoucherItems([
      { description: 'Fuel', amount: '500', accountId: 5 },
      { description: 'Parking', amount: 50 },
    ]);
    expect(rows).toEqual([
      { description: 'Fuel', accountId: 5, amount: 500, creditAmount: 0, receiptNo: null },
      { description: 'Parking', accountId: null, amount: 50, creditAmount: 0, receiptNo: null },
    ]);
    expect(totalDebit(rows)).toBe(550);
  });

  test('balanced debit and credit lines are accepted', () => {
    const rows = normalizeVoucherItems([
      { description: 'Rent', amount: 1000, accountId: 1 },
      { description: 'Cash', creditAmount: 1000, accountId: 2 },
    ]);
    expect(totalDebit(rows)).toBe(1000);
    expect(rows[1].creditAmount).toBe(1000);
  });

  test('unbalanced lines are rejected with both totals', () => {
    expect.assertions(2);
    try {
      normalizeVoucherItems([
        { description: 'Rent', amount: 1000, accountId: 1 },
        { description: 'Cash', creditAmount: 900, accountId: 2 },
      ]);
    } catch (e) {
      expect(e.status || e.statusCode).toBe(400);
      expect(e.message).toMatch(/1,000\.00.*900\.00.*must balance/);
    }
  });

  test('floating point noise does not unbalance a voucher', () => {
    expect(() => normalizeVoucherItems([
      { description: 'A', amount: 0.1, accountId: 1 },
      { description: 'B', amount: 0.2, accountId: 1 },
      { description: 'Cash', creditAmount: 0.3, accountId: 2 },
    ])).not.toThrow();
  });

  test('a line cannot carry both a debit and a credit', () => {
    expect(() => normalizeVoucherItems([
      { description: 'X', amount: 10, creditAmount: 10, accountId: 1 },
    ])).toThrow(/both a debit and a credit/);
  });

  test('a credit line needs an account', () => {
    expect(() => normalizeVoucherItems([
      { description: 'Rent', amount: 100, accountId: 1 },
      { description: 'Cash', creditAmount: 100 },
    ])).toThrow(/needs an account/);
  });

  test('liquidation vouchers reject credit lines', () => {
    expect(() => normalizeVoucherItems(
      [{ description: 'A', amount: 1, accountId: 1 }, { description: 'B', creditAmount: 1, accountId: 2 }],
      { type: 'LIQUIDATION' },
    )).toThrow(/Liquidation/);
  });
});

describe('normalizeVoucherItems keeps the driver / vehicle tags', () => {
  const { normalizeVoucherItems } = require('../server/utils/voucherLines');

  test('a tagged line carries its tags; an untagged line gets no tag keys', () => {
    const rows = normalizeVoucherItems([
      { description: 'Brake pads', accountId: 5, amount: 1500, driverId: '3', vehicleId: 7 },
      { description: 'Oil', accountId: 5, amount: 500 },
    ]);

    expect(rows[0]).toMatchObject({ driverId: 3, vehicleId: 7 });
    expect(rows[1]).not.toHaveProperty('driverId');
    expect(rows[1]).not.toHaveProperty('vehicleId');
  });
});
