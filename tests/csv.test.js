const { parseCsv } = require('../lib/csv');

describe('parseCsv', () => {
  test('quoted commas and escaped quotes stay in one cell', () => {
    expect(parseCsv('name,address\r\n"Dela Cruz, Juan","123 ""A"" St., Tagum"\r\n'))
      .toEqual([['name', 'address'], ['Dela Cruz, Juan', '123 "A" St., Tagum']]);
  });

  test("drops blank lines and Excel's leading byte-order mark", () => {
    expect(parseCsv('﻿a,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
});
