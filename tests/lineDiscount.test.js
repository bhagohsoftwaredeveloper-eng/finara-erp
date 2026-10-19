const { resolveLineDiscount } = require('../server/utils/lineDiscount');

describe('resolveLineDiscount', () => {
  test('no type or NONE means no discount', () => {
    expect(resolveLineDiscount(1000)).toEqual({ discountType: null, discountValue: 0, discount: 0 });
    expect(resolveLineDiscount(1000, 'NONE', 50).discount).toBe(0);
  });

  test('percent discount is taken off the gross', () => {
    expect(resolveLineDiscount(1000, 'PERCENT', 10)).toEqual({ discountType: 'PERCENT', discountValue: 10, discount: 100 });
    expect(resolveLineDiscount(333.33, 'percent', 15).discount).toBe(50);
  });

  test('amount discount is a flat peso value', () => {
    expect(resolveLineDiscount(1000, 'AMOUNT', 250.5)).toEqual({ discountType: 'AMOUNT', discountValue: 250.5, discount: 250.5 });
  });

  test('a zero value is treated as no discount', () => {
    expect(resolveLineDiscount(1000, 'PERCENT', 0).discountType).toBeNull();
  });

  test('rejects over-100 percent, over-gross amount, negatives and unknown types', () => {
    expect(() => resolveLineDiscount(1000, 'PERCENT', 101)).toThrow(/100%/);
    expect(() => resolveLineDiscount(1000, 'AMOUNT', 1000.01)).toThrow(/exceed the line amount/);
    expect(() => resolveLineDiscount(1000, 'AMOUNT', -5)).toThrow(/0 or more/);
    expect(() => resolveLineDiscount(1000, 'BOGO', 5)).toThrow(/Invalid discount type/);
  });

  test('a full amount discount is allowed (line nets to zero)', () => {
    expect(resolveLineDiscount(1000, 'AMOUNT', 1000).discount).toBe(1000);
  });
});
