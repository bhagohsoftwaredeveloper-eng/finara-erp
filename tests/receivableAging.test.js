jest.mock('../server/config/database', () => ({
  invoice:  { findMany: jest.fn() },
  customer: { findMany: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/receivableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const inv = (over = {}) => ({
  invoiceNo: 'INV-1', customerId: 4, status: 'OPEN', invoiceDate: new Date('2026-01-01T00:00:00Z'),
  dueDate: new Date('2026-01-31T00:00:00Z'), totalAmount: 1000, paidAmount: 0, paymentTerms: 'Net 30',
  notes: null, payments: [], ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.customer.findMany.mockResolvedValue([{ id: 4, name: 'ACME' }]);
});

describe('agingReport', () => {
  test('loads this business’s non-void invoices dated on or before the as-of date, with payments', async () => {
    prisma.invoice.findMany.mockResolvedValue([inv()]);

    await run(ctrl.agingReport, { query: { asOf: '2026-03-02' } });

    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        businessId: 1,
        status: { not: 'VOID' },
        invoiceDate: { lte: new Date('2026-03-02T00:00:00Z') },
      },
      include: { payments: { select: { amount: true, paymentDate: true, status: true } } },
    }));
  });

  test('returns buckets, total, and echoes asOf and basis', async () => {
    prisma.invoice.findMany.mockResolvedValue([inv()]);

    const r = await run(ctrl.agingReport, { query: { asOf: '2026-03-02', basis: 'invoice' } });

    expect(r.asOf).toBe('2026-03-02');
    expect(r.basis).toBe('invoice');
    expect(r.total).toBe(1000);
    expect(r.items[0]).toMatchObject({ customer: 'ACME', paymentTerms: 'Net 30', bucket: '31-60 days' });
  });

  test('defaults to the due-date basis for any unknown basis value', async () => {
    prisma.invoice.findMany.mockResolvedValue([]);

    const r = await run(ctrl.agingReport, { query: { asOf: '2026-03-02', basis: 'bogus' } });

    expect(r.basis).toBe('due');
  });

  test('rejects a malformed as-of date', async () => {
    await expect(run(ctrl.agingReport, { query: { asOf: '03/02/2026' } })).rejects.toThrow('asOf');
    await expect(run(ctrl.agingReport, { query: { asOf: '2026-13-45' } })).rejects.toThrow('asOf');
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });
});
