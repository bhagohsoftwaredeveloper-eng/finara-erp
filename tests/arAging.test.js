const {
  AR_BUCKETS, todayPH, daysBetween, bucketForDays, ageOf, paidAsOf, buildAging,
} = require('../lib/arAging');

describe('bucketForDays', () => {
  test.each([
    [0, 'Current'], [1, '1-30 days'], [30, '1-30 days'], [31, '31-60 days'],
    [60, '31-60 days'], [61, '61-90 days'], [90, '61-90 days'], [91, 'Over 90 days'],
  ])('%i days -> %s', (days, bucket) => {
    expect(bucketForDays(days)).toBe(bucket);
  });

  test('bucket list order is fixed', () => {
    expect(AR_BUCKETS).toEqual(['Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days']);
  });
});

describe('todayPH', () => {
  test('uses the Philippine date, which is ahead of UTC by 8 hours', () => {
    // 2026-01-31 17:00 UTC is already 2026-02-01 01:00 in Manila
    expect(todayPH(Date.UTC(2026, 0, 31, 17, 0))).toBe('2026-02-01');
    expect(todayPH(Date.UTC(2026, 0, 31, 15, 59))).toBe('2026-01-31');
  });
});

describe('daysBetween', () => {
  test('counts whole days and accepts Date objects', () => {
    expect(daysBetween('2026-01-10', '2026-02-09')).toBe(30);
    expect(daysBetween(new Date('2026-01-10T00:00:00Z'), '2026-01-09')).toBe(-1);
  });
});

describe('ageOf', () => {
  const inv = { invoiceDate: '2026-01-01', dueDate: '2026-01-10' };

  test('by due date: days past the due date', () => {
    expect(ageOf(inv, '2026-02-09', 'due')).toEqual({ days: 30, bucket: '1-30 days' });
  });

  test('by due date: not yet due is Current with 0 days (never negative)', () => {
    expect(ageOf(inv, '2026-01-05', 'due')).toEqual({ days: 0, bucket: 'Current' });
  });

  test('by invoice date: days since the invoice was issued', () => {
    expect(ageOf(inv, '2026-03-01', 'invoice')).toEqual({ days: 59, bucket: '31-60 days' });
  });

  test('defaults to the due-date basis', () => {
    expect(ageOf(inv, '2026-02-09')).toEqual(ageOf(inv, '2026-02-09', 'due'));
  });
});

describe('paidAsOf', () => {
  const inv = {
    paidAmount: 1000,
    payments: [
      { amount: 400, paymentDate: '2026-02-10', status: 'POSTED' },
      { amount: 100, paymentDate: '2026-03-05', status: 'POSTED' },
      { amount: 50,  paymentDate: '2026-03-06', status: 'REVERSED' },
      { amount: 70,  paymentDate: '2026-03-07', status: 'PENDING' },
    ],
  };

  test('takes back only the counted payments made after the as-of date', () => {
    expect(paidAsOf(inv, '2026-03-01')).toBe(900);
  });

  test('is the full paidAmount once every payment is on or before the as-of date', () => {
    expect(paidAsOf(inv, '2026-03-31')).toBe(1000);
  });

  test('works when payments were not loaded, and never goes below zero', () => {
    expect(paidAsOf({ paidAmount: 500 }, '2026-01-01')).toBe(500);
    expect(paidAsOf({ paidAmount: 50, payments: [{ amount: 80, paymentDate: '2026-05-01', status: 'POSTED' }] }, '2026-01-01')).toBe(0);
  });
});

describe('buildAging', () => {
  const base = { customerId: 1, notes: null, paymentTerms: 'Net 30', paidAmount: 0, payments: [] };
  const invoices = [
    { ...base, invoiceNo: 'INV-1', status: 'OPEN',    invoiceDate: '2026-01-01', dueDate: '2026-01-31', totalAmount: 1000 },
    { ...base, invoiceNo: 'INV-2', status: 'PARTIAL', invoiceDate: '2026-02-01', dueDate: '2026-03-03', totalAmount: 500, paidAmount: 200 },
    { ...base, invoiceNo: 'INV-3', status: 'PAID',    invoiceDate: '2026-01-05', dueDate: '2026-02-04', totalAmount: 300, paidAmount: 300 },
    { ...base, invoiceNo: 'INV-4', status: 'VOID',    invoiceDate: '2026-01-05', dueDate: '2026-02-04', totalAmount: 999 },
    { ...base, invoiceNo: 'INV-5', status: 'OPEN',    invoiceDate: '2026-04-01', dueDate: '2026-05-01', totalAmount: 700 },
  ];
  const names = { 1: 'ACME' };

  test('lists outstanding invoices of that date only, bucketed by days past due', () => {
    const r = buildAging(invoices, { asOf: '2026-03-02', customerNames: names });

    expect(r.items.map((i) => i.invoiceNo)).toEqual(['INV-1', 'INV-2']); // 3 paid, 4 void, 5 not issued yet
    expect(r.items[0]).toMatchObject({
      customer: 'ACME', paymentTerms: 'Net 30', total: 1000, paid: 0, outstanding: 1000,
      daysOverdue: 30, bucket: '1-30 days',
    });
    expect(r.items[1]).toMatchObject({ outstanding: 300, daysOverdue: 0, bucket: 'Current' });
    expect(r.summary).toEqual({ Current: 300, '1-30 days': 1000, '31-60 days': 0, '61-90 days': 0, 'Over 90 days': 0 });
    expect(r.total).toBe(1300);
  });

  test('a paid invoice reappears in an earlier as-of that predates its payment', () => {
    const paid = [{
      ...base, invoiceNo: 'INV-3', status: 'PAID', invoiceDate: '2026-01-05', dueDate: '2026-02-04',
      totalAmount: 300, paidAmount: 300,
      payments: [{ amount: 300, paymentDate: '2026-03-10', status: 'POSTED' }],
    }];

    expect(buildAging(paid, { asOf: '2026-03-01', customerNames: names }).items).toHaveLength(1);
    expect(buildAging(paid, { asOf: '2026-03-10', customerNames: names }).items).toHaveLength(0);
  });

  test('invoice-date basis ages from the issue date', () => {
    const r = buildAging(invoices.slice(0, 1), { asOf: '2026-03-02', basis: 'invoice', customerNames: names });
    expect(r.items[0]).toMatchObject({ daysOverdue: 60, bucket: '31-60 days' });
  });

  test('an unknown customer id does not crash the report', () => {
    const r = buildAging(invoices.slice(0, 1), { asOf: '2026-03-02', customerNames: {} });
    expect(r.items[0].customer).toBe('Unknown customer');
  });
});
