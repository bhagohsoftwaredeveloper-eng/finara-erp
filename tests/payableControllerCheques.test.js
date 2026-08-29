jest.mock('../server/config/database', () => ({
  paymentAP: {
    findMany: jest.fn(),
  },
  vendor: {
    findMany: jest.fn(),
  },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.vendor.findMany.mockResolvedValue([{ id: 3, name: 'Triplekenn Supply' }]);
});

const mkPayment = (overrides) => ({
  id: 1, paymentNo: 'PAP-000001', billId: 7, amount: 500, reference: 'CHK-001',
  paymentDate: new Date('2026-08-20'), checkDate: new Date('2026-09-05'),
  clearingStatus: 'OUTSTANDING', notes: null,
  bill: { billNo: 'BILL-000007', vendorId: 3 },
  ...overrides,
});

describe('listCheques', () => {
  test('scopes the query to the current business and paymentMethod Check', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([]);
    await run(ctrl.listCheques, {});
    expect(prisma.paymentAP.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ paymentMethod: 'Check', bill: { businessId: 1 } }),
      })
    );
  });

  test('applies an optional status filter from the query string', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([]);
    await run(ctrl.listCheques, { query: { status: 'CLEARED' } });
    expect(prisma.paymentAP.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ clearingStatus: 'CLEARED' }),
      })
    );
  });

  test('fetches vendor names via a separate query, not via include on the bill relation', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([mkPayment({})]);
    await run(ctrl.listCheques, {});
    const findManyArgs = prisma.paymentAP.findMany.mock.calls[0][0];
    expect(findManyArgs.include.bill.select.vendor).toBeUndefined();
    expect(findManyArgs.include.bill.select.vendorId).toBe(true);
    expect(prisma.vendor.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [3] } } })
    );
  });

  test('maps each row to the flat shape the frontend expects', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([mkPayment({})]);
    const result = await run(ctrl.listCheques, {});
    expect(result[0]).toMatchObject({
      id: 1, paymentNo: 'PAP-000001', billNo: 'BILL-000007', vendorName: 'Triplekenn Supply',
      amount: 500, checkNo: 'CHK-001', clearingStatus: 'OUTSTANDING',
    });
  });

  test('computes a bucket for an OUTSTANDING cheque, null for a settled one', async () => {
    const soon = new Date(); soon.setDate(soon.getDate() + 3);
    const cleared = mkPayment({ id: 2, clearingStatus: 'CLEARED', checkDate: soon });
    const outstanding = mkPayment({ id: 1, clearingStatus: 'OUTSTANDING', checkDate: soon });
    prisma.paymentAP.findMany.mockResolvedValue([outstanding, cleared]);

    const result = await run(ctrl.listCheques, {});

    expect(result.find((r) => r.id === 1).bucket).toBe('0-7 days');
    expect(result.find((r) => r.id === 2).bucket).toBeNull();
  });

  test('buckets an OUTSTANDING cheque whose checkDate has already passed as Past Due', async () => {
    const past = new Date(); past.setDate(past.getDate() - 5);
    prisma.paymentAP.findMany.mockResolvedValue([mkPayment({ checkDate: past })]);

    const result = await run(ctrl.listCheques, {});

    expect(result[0].bucket).toBe('Past Due');
  });

  test('buckets at the 8-14, 15-30, and 30+ day boundaries', async () => {
    const at = (days) => { const d = new Date(); d.setDate(d.getDate() + days); return d; };
    prisma.paymentAP.findMany.mockResolvedValue([
      mkPayment({ id: 1, checkDate: at(10) }),
      mkPayment({ id: 2, checkDate: at(20) }),
      mkPayment({ id: 3, checkDate: at(45) }),
    ]);

    const result = await run(ctrl.listCheques, {});

    expect(result.find((r) => r.id === 1).bucket).toBe('8-14 days');
    expect(result.find((r) => r.id === 2).bucket).toBe('15-30 days');
    expect(result.find((r) => r.id === 3).bucket).toBe('30+ days');
  });

  test('does not crash when the bill\'s vendor has been deleted (orphaned vendor)', async () => {
    prisma.paymentAP.findMany.mockResolvedValue([mkPayment({})]);
    prisma.vendor.findMany.mockResolvedValue([]); // vendor deleted — no matching row

    const result = await run(ctrl.listCheques, {});

    expect(result[0].vendorName).toBeUndefined();
  });
});
