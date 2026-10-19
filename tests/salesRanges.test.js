const { monthRanges, previousRange, rangeLabel, addDays } = require('../lib/salesRanges');

describe('addDays', () => {
  test('moves a date string by whole days, across month and year ends', () => {
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('monthRanges', () => {
  test('the selected month and the ones before it, oldest first', () => {
    expect(monthRanges('2026-10', 3)).toEqual([
      { from: '2026-08-01', to: '2026-08-31', label: 'Aug 2026' },
      { from: '2026-09-01', to: '2026-09-30', label: 'Sep 2026' },
      { from: '2026-10-01', to: '2026-10-31', label: 'Oct 2026' },
    ]);
  });

  test('crosses the year end and handles leap February', () => {
    expect(monthRanges('2026-01', 3).map((r) => [r.from, r.to])).toEqual([
      ['2025-11-01', '2025-11-30'], ['2025-12-01', '2025-12-31'], ['2026-01-01', '2026-01-31'],
    ]);
    expect(monthRanges('2028-02', 1)).toEqual([{ from: '2028-02-01', to: '2028-02-29', label: 'Feb 2028' }]);
  });

  test('one or two months work too', () => {
    expect(monthRanges('2026-10', 1)).toHaveLength(1);
    expect(monthRanges('2026-10', 2).map((r) => r.label)).toEqual(['Sep 2026', 'Oct 2026']);
  });
});

describe('previousRange', () => {
  test('is the same number of days immediately before the range', () => {
    expect(previousRange('2026-10-01', '2026-10-15')).toEqual({ from: '2026-09-16', to: '2026-09-30' });
    expect(previousRange('2026-03-01', '2026-03-31')).toEqual({ from: '2026-01-29', to: '2026-02-28' });
  });

  test('a single day', () => {
    expect(previousRange('2026-10-19', '2026-10-19')).toEqual({ from: '2026-10-18', to: '2026-10-18' });
  });
});

describe('rangeLabel', () => {
  test('a whole calendar month reads as the month', () => {
    expect(rangeLabel('2026-10-01', '2026-10-31')).toBe('Oct 2026');
  });

  test('any other range shows both dates', () => {
    expect(rangeLabel('2026-10-01', '2026-10-15')).toBe('Oct 1 – Oct 15, 2026');
    expect(rangeLabel('2026-09-16', '2026-10-15')).toBe('Sep 16 – Oct 15, 2026');
    expect(rangeLabel('2025-12-20', '2026-01-05')).toBe('Dec 20, 2025 – Jan 5, 2026');
  });
});
