const {
  normalizeDocs, periodStart, periodLabel, summarizeByPeriod, summarizeComparison,
} = require('../server/utils/salesSummary');

const acct = (code, name) => ({ accountCode: code, accountName: name });

const invoices = [
  { invoiceNo: 'INV-1', invoiceDate: new Date('2026-09-10T00:00:00Z'), status: 'PAID', subtotal: 1000, vatAmount: 120, totalAmount: 1120,
    customer: { name: 'ACME' },
    lines: [
      { description: 'Consulting', amount: 800, account: acct('4010', 'Service Revenue') },
      { description: 'Processing Fee', amount: 200, account: acct('4020', 'Fee Income') },
    ] },
  { invoiceNo: 'INV-2', invoiceDate: new Date('2026-10-05T00:00:00Z'), status: 'OPEN', subtotal: 1400, vatAmount: 168, totalAmount: 1568,
    customer: { name: 'ACME' },
    lines: [
      { description: 'consulting ', amount: 1500, account: acct('4010', 'Service Revenue') },
      { description: 'Sales Discount', amount: -100, account: acct('4090', 'Sales Discounts') },
    ] },
  { invoiceNo: 'INV-3', invoiceDate: new Date('2026-10-06T00:00:00Z'), status: 'VOID', subtotal: 999, vatAmount: 0, totalAmount: 999,
    customer: { name: 'Gone' }, lines: [{ description: 'x', amount: 999, account: acct('4010', 'Service Revenue') }] },
];
const cashSales = [
  { saleNo: 'CS-1', saleDate: new Date('2026-10-07T00:00:00Z'), status: 'ACTIVE', buyerName: null, subtotal: 300, vatAmount: 36, totalAmount: 336,
    account: acct('4000', 'Sales'), items: [{ description: 'Widget', amount: 300 }] },
  { saleNo: 'CS-2', saleDate: new Date('2026-10-08T00:00:00Z'), status: 'VOID', buyerName: 'Void Buyer', subtotal: 50, vatAmount: 0, totalAmount: 50,
    account: acct('4000', 'Sales'), items: [{ description: 'Widget', amount: 50 }] },
];

const docs = normalizeDocs(invoices, cashSales);

describe('normalizeDocs', () => {
  test('drops void documents and unifies invoices and cash sales', () => {
    expect(docs.map((d) => d.docNo)).toEqual(['INV-1', 'INV-2', 'CS-1']);
    expect(docs[0]).toMatchObject({
      source: 'Invoice', date: '2026-09-10', customer: 'ACME', subtotal: 1000, vatAmount: 120, total: 1120,
    });
    expect(docs[0].lines).toEqual([
      { account: '4010 · Service Revenue', description: 'Consulting', amount: 800 },
      { account: '4020 · Fee Income', description: 'Processing Fee', amount: 200 },
    ]);
  });

  test('a cash sale takes its account from the sale and calls an unnamed buyer Walk-in', () => {
    expect(docs[2]).toMatchObject({ source: 'Cash Sale', date: '2026-10-07', customer: 'Walk-in', subtotal: 300 });
    expect(docs[2].lines).toEqual([{ account: '4000 · Sales', description: 'Widget', amount: 300 }]);
  });
});

describe('periodStart / periodLabel', () => {
  test.each([
    ['2026-10-14', 'day',     '2026-10-14'],
    ['2026-10-14', 'week',    '2026-10-12'], // Tuesday -> that Monday
    ['2026-10-18', 'week',    '2026-10-12'], // Sunday stays in the same week
    ['2026-10-19', 'week',    '2026-10-19'], // Monday starts a week
    ['2026-10-14', 'month',   '2026-10-01'],
    ['2026-08-31', 'quarter', '2026-07-01'],
    ['2026-11-02', 'quarter', '2026-10-01'],
    ['2026-10-14', 'year',    '2026-01-01'],
  ])('%s by %s starts %s', (date, groupBy, start) => {
    expect(periodStart(date, groupBy)).toBe(start);
  });

  test('labels', () => {
    expect(periodLabel('2026-10-12', 'week')).toBe('2026-10-12 to 2026-10-18');
    expect(periodLabel('2026-10-01', 'month')).toBe('October 2026');
    expect(periodLabel('2026-10-01', 'quarter')).toBe('Q4 2026');
    expect(periodLabel('2026-01-01', 'year')).toBe('2026');
    expect(periodLabel('2026-10-14', 'day')).toBe('2026-10-14');
  });
});

describe('summarizeByPeriod', () => {
  test('monthly rows include empty months and a grand total', () => {
    const r = summarizeByPeriod(docs, { from: '2026-08-01', to: '2026-10-31', groupBy: 'month' });

    expect(r.rows).toEqual([
      { key: '2026-08-01', label: 'August 2026',    count: 0, net: 0,    vat: 0,   total: 0 },
      { key: '2026-09-01', label: 'September 2026', count: 1, net: 1000, vat: 120, total: 1120 },
      { key: '2026-10-01', label: 'October 2026',   count: 2, net: 1700, vat: 204, total: 1904 },
    ]);
    expect(r.totals).toEqual({ count: 3, net: 2700, vat: 324, total: 3024 });
  });

  test('only documents inside the range count', () => {
    const r = summarizeByPeriod(docs, { from: '2026-10-06', to: '2026-10-31', groupBy: 'month' });

    expect(r.totals).toEqual({ count: 1, net: 300, vat: 36, total: 336 });
  });

  test('weekly rows start on Monday', () => {
    const r = summarizeByPeriod(docs, { from: '2026-10-01', to: '2026-10-11', groupBy: 'week' });

    expect(r.rows.map((x) => x.key)).toEqual(['2026-09-28', '2026-10-05']);
    expect(r.rows[1]).toMatchObject({ count: 2, net: 1700 });
  });

  test('daily rows', () => {
    const r = summarizeByPeriod(docs, { from: '2026-10-05', to: '2026-10-07', groupBy: 'day' });

    expect(r.rows.map((x) => [x.key, x.count])).toEqual([['2026-10-05', 1], ['2026-10-06', 0], ['2026-10-07', 1]]);
  });
});

describe('summarizeComparison', () => {
  const ranges = [
    { from: '2026-09-01', to: '2026-09-30', label: 'Sep 2026' },
    { from: '2026-10-01', to: '2026-10-31', label: 'Oct 2026' },
  ];

  test('by revenue account: one column per range, totals, and change vs the previous range', () => {
    const r = summarizeComparison(docs, { dimension: 'account', ranges });

    expect(r.ranges).toEqual(ranges);
    expect(r.rows).toEqual([
      { key: '4010 · Service Revenue', label: '4010 · Service Revenue', values: [800, 1500], total: 2300, change: 700, changePct: 87.5 },
      { key: '4000 · Sales',           label: '4000 · Sales',           values: [0, 300],    total: 300,  change: 300, changePct: null },
      { key: '4020 · Fee Income',      label: '4020 · Fee Income',      values: [200, 0],    total: 200,  change: -200, changePct: -100 },
      { key: '4090 · Sales Discounts', label: '4090 · Sales Discounts', values: [0, -100],   total: -100, change: -100, changePct: null },
    ]);
    expect(r.totals).toEqual({ values: [1000, 1700], total: 2700, change: 700, changePct: 70 });
  });

  test('by customer uses document subtotals; unnamed cash buyers are Walk-in', () => {
    const r = summarizeComparison(docs, { dimension: 'customer', ranges });

    expect(r.rows.map((x) => [x.label, x.values])).toEqual([['ACME', [1000, 1400]], ['Walk-in', [0, 300]]]);
    expect(r.totals.values).toEqual([1000, 1700]);
  });

  test('by item groups descriptions ignoring case and spacing', () => {
    const r = summarizeComparison(docs, { dimension: 'item', ranges });

    const consulting = r.rows.find((x) => x.label === 'Consulting');
    expect(consulting.values).toEqual([800, 1500]);
    expect(r.rows.map((x) => x.label)).not.toContain('consulting ');
  });

  test('every view totals to the same net sales', () => {
    const totals = ['account', 'customer', 'item'].map((dimension) => summarizeComparison(docs, { dimension, ranges }).totals.values);

    expect(totals[1]).toEqual(totals[0]);
    expect(totals[2]).toEqual(totals[0]);
  });

  test('a single range has no change', () => {
    const r = summarizeComparison(docs, { dimension: 'customer', ranges: [ranges[1]] });

    expect(r.rows[0]).toMatchObject({ values: [1400], total: 1400, change: null, changePct: null });
    expect(r.totals.change).toBeNull();
  });

  test('three ranges compare the newest with the one before it', () => {
    const three = [{ from: '2026-08-01', to: '2026-08-31', label: 'Aug' }, ...ranges];
    const r = summarizeComparison(docs, { dimension: 'customer', ranges: three });

    expect(r.rows[0].values).toEqual([0, 1000, 1400]);
    expect(r.rows[0]).toMatchObject({ change: 400, changePct: 40 });
  });
});
