jest.mock('../server/config/database', () => ({
  invoice:  { findMany: jest.fn() },
  customer: { findFirst: jest.fn(), findMany: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/statementController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const cust = (id, name) => ({ id, customerCode: `CUS-00${id}`, name, tin: null, address: null, email: null, phone: null });
const inv = (over = {}) => ({
  invoiceNo: 'INV-000001', customerId: 4, status: 'OPEN', invoiceDate: new Date('2026-01-01T00:00:00Z'),
  dueDate: new Date('2026-01-31T00:00:00Z'), totalAmount: 1000, paidAmount: 0, paymentTerms: 'Net 30',
  notes: null, payments: [], ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('getStatements, open items', () => {
  test('one customer: scoped to the business and that customer', async () => {
    prisma.customer.findFirst.mockResolvedValue(cust(4, 'ACME'));
    prisma.invoice.findMany.mockResolvedValue([inv()]);

    const r = await run(ctrl.getStatements, { query: { customerId: '4', mode: 'open', asOf: '2026-03-02' } });

    expect(prisma.customer.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 4, businessId: 1 } }));
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ businessId: 1, customerId: 4, status: { not: 'VOID' } }),
    }));
    expect(r.mode).toBe('open');
    expect(r.asOf).toBe('2026-03-02');
    expect(r.statements).toHaveLength(1);
    expect(r.statements[0].customer.name).toBe('ACME');
    expect(r.statements[0].total).toBe(1000);
    expect(r.statements[0].items[0]).toMatchObject({ invoiceNo: 'INV-000001', paymentTerms: 'Net 30', bucket: '1-30 days' });
  });

  test('404 when the customer belongs to another business', async () => {
    prisma.customer.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.getStatements, { query: { customerId: '4', mode: 'open' } }))
      .rejects.toThrow('Customer not found');
    expect(prisma.invoice.findMany).not.toHaveBeenCalled();
  });

  test('all customers: only those with an open balance are returned', async () => {
    prisma.invoice.findMany.mockResolvedValue([
      inv({ invoiceNo: 'INV-000001', customerId: 4 }),
      inv({ invoiceNo: 'INV-000002', customerId: 5, status: 'PAID', paidAmount: 1000 }),
    ]);
    prisma.customer.findMany.mockResolvedValue([cust(4, 'ACME'), cust(5, 'Beta')]);

    const r = await run(ctrl.getStatements, { query: { customerId: 'all', mode: 'open', asOf: '2026-03-02' } });

    expect(prisma.customer.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: 1, id: { in: [4, 5] } },
    }));
    expect(r.statements.map((s) => s.customer.name)).toEqual(['ACME']);
  });

  test('requires a customerId (an id or "all") and a valid as-of date', async () => {
    await expect(run(ctrl.getStatements, { query: { mode: 'open' } })).rejects.toThrow('customerId');
    await expect(run(ctrl.getStatements, { query: { customerId: 'abc', mode: 'open' } })).rejects.toThrow('customerId');
    await expect(run(ctrl.getStatements, { query: { customerId: 'all', mode: 'open', asOf: 'nope' } })).rejects.toThrow('asOf');
  });
});

describe('getStatements, ledger', () => {
  test('returns opening balance, rows and closing balance for the range', async () => {
    prisma.customer.findFirst.mockResolvedValue(cust(4, 'ACME'));
    prisma.invoice.findMany.mockResolvedValue([inv({ invoiceDate: new Date('2026-02-05T00:00:00Z'), totalAmount: 500 })]);

    const r = await run(ctrl.getStatements, { query: { customerId: '4', mode: 'ledger', from: '2026-02-01', to: '2026-02-28' } });

    expect(r.from).toBe('2026-02-01');
    expect(r.to).toBe('2026-02-28');
    expect(r.statements[0]).toMatchObject({ openingBalance: 0, closingBalance: 500 });
    expect(r.statements[0].rows).toHaveLength(1);
    expect(prisma.invoice.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ invoiceDate: { lte: new Date('2026-02-28T00:00:00Z') } }),
    }));
  });

  test('requires from and to, with from not after to', async () => {
    await expect(run(ctrl.getStatements, { query: { customerId: 'all', mode: 'ledger', to: '2026-02-28' } }))
      .rejects.toThrow('from');
    await expect(run(ctrl.getStatements, { query: { customerId: 'all', mode: 'ledger', from: '2026-03-01', to: '2026-02-01' } }))
      .rejects.toThrow('from');
  });
});
