const { buildLedger } = require('../server/utils/arStatement');

const pay = (over = {}) => ({
  paymentNo: 'PAR-000001', paymentDate: '2026-01-20', amount: 400, paymentMethod: 'Cash', reference: null, status: 'POSTED', ...over,
});
const inv = (over = {}) => ({
  invoiceNo: 'INV-000001', status: 'OPEN', invoiceDate: '2026-01-10', totalAmount: 1000, paidAmount: 0,
  paymentTerms: 'Net 30', payments: [], ...over,
});

const inv1 = inv({ status: 'PARTIAL', paidAmount: 400, payments: [pay()] });
const inv2 = inv({ invoiceNo: 'INV-000002', invoiceDate: '2026-02-05', totalAmount: 500 });

describe('buildLedger', () => {
  test('invoices are debits, payments are credits, with a running balance', () => {
    const r = buildLedger([inv1, inv2], { from: '2026-01-01', to: '2026-01-31' });

    expect(r.openingBalance).toBe(0);
    expect(r.rows.map((x) => [x.type, x.reference, x.debit, x.credit, x.balance])).toEqual([
      ['INVOICE', 'INV-000001', 1000, 0, 1000],
      ['PAYMENT', 'PAR-000001', 0, 400, 600],
    ]);
    expect(r.totalDebits).toBe(1000);
    expect(r.totalCredits).toBe(400);
    expect(r.closingBalance).toBe(600);
  });

  test('everything before the start date rolls into the opening balance', () => {
    const r = buildLedger([inv1, inv2], { from: '2026-02-01', to: '2026-02-28' });

    expect(r.openingBalance).toBe(600);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ reference: 'INV-000002', debit: 500, balance: 1100 });
    expect(r.closingBalance).toBe(1100);
  });

  test('transactions after the end date are left out', () => {
    const r = buildLedger([inv1, inv2], { from: '2026-01-01', to: '2026-01-15' });

    expect(r.rows.map((x) => x.reference)).toEqual(['INV-000001']);
    expect(r.closingBalance).toBe(1000);
  });

  test('on the same day the invoice comes before its payment', () => {
    const same = inv({ paidAmount: 1000, payments: [pay({ paymentDate: '2026-01-10', amount: 1000 })] });
    const r = buildLedger([same], { from: '2026-01-01', to: '2026-01-31' });

    expect(r.rows.map((x) => x.type)).toEqual(['INVOICE', 'PAYMENT']);
    expect(r.closingBalance).toBe(0);
  });

  test('void invoices and pending or reversed payments are ignored', () => {
    const voided = inv({ invoiceNo: 'INV-000009', status: 'VOID', totalAmount: 999 });
    const withBad = inv({
      paidAmount: 0,
      payments: [pay({ status: 'REVERSED' }), pay({ paymentNo: 'PAR-000002', status: 'PENDING' })],
    });
    const r = buildLedger([voided, withBad], { from: '2026-01-01', to: '2026-12-31' });

    expect(r.rows.map((x) => x.reference)).toEqual(['INV-000001']);
    expect(r.closingBalance).toBe(1000);
  });

  test('money recorded on the invoice with no payment rows shows as one credit, so the ledger matches the invoice balance', () => {
    const legacy = inv({ status: 'PARTIAL', paidAmount: 300, payments: [] });
    const r = buildLedger([legacy], { from: '2026-01-01', to: '2026-12-31' });

    expect(r.rows).toHaveLength(2);
    expect(r.rows[1]).toMatchObject({ type: 'PAYMENT', credit: 300, balance: 700 });
    expect(r.rows[1].description).toMatch(/no payment detail/);
  });

  test('empty input gives a zero ledger', () => {
    expect(buildLedger([], { from: '2026-01-01', to: '2026-01-31' })).toEqual({
      openingBalance: 0, rows: [], totalDebits: 0, totalCredits: 0, closingBalance: 0,
    });
  });
});
