const { monthsInRange } = require('../server/utils/feeMonths');

describe('monthsInRange', () => {
  test('June to March wraps the year: 10 months', () => {
    expect(monthsInRange(6, 3)).toBe(10);
  });

  test('June to April is 11, a same-year range counts both ends', () => {
    expect(monthsInRange(6, 4)).toBe(11);
    expect(monthsInRange(1, 12)).toBe(12);
    expect(monthsInRange(8, 8)).toBe(1);
  });

  test('accepts numeric strings from a form', () => {
    expect(monthsInRange('6', '3')).toBe(10);
  });

  test('returns null when the range is not set or invalid', () => {
    expect(monthsInRange(null, 3)).toBeNull();
    expect(monthsInRange(6, undefined)).toBeNull();
    expect(monthsInRange(0, 3)).toBeNull();
    expect(monthsInRange(6, 13)).toBeNull();
  });
});
