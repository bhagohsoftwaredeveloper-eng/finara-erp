jest.mock('../server/config/database', () => ({
  quotation: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  account: { findFirst: jest.fn(), findMany: jest.fn() },
  invoice: { create: jest.fn(), count: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/quotationController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('quotationController — paymentTerms snapshot and carry-forward', () => {
  test('create stores the submitted paymentTerms label', async () => {
    let created;
    prisma.quotation.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, quotationNo: 'QTN-1000', customer: { name: 'Acme' }, ...args.data, lines: [] });
    });

    await run(ctrl.create, {
      body: {
        customerId: 1, quotationDate: '2026-09-09', validUntil: '2026-10-09', paymentTerms: 'Net 30',
        lines: [{ description: 'Service', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(created.paymentTerms).toBe('Net 30');
  });

  test('convertPreview returns the quotation\'s paymentTerms and quotationDate', async () => {
    prisma.quotation.findFirst.mockResolvedValue({
      id: 5, quotationNo: 'QTN-1005', status: 'SENT', totalAmount: 1000,
      paymentTerms: 'Net 45', quotationDate: new Date('2026-09-01'),
      customer: { name: 'Acme' }, lines: [],
    });
    prisma.account.findFirst.mockResolvedValue({ id: 10 });

    const result = await run(ctrl.convertPreview, { params: { id: '5' } });

    expect(result.paymentTerms).toBe('Net 45');
    expect(result.quotationDate).toEqual(new Date('2026-09-01'));
  });

  test('convert stores the submitted paymentTerms on the new invoice', async () => {
    prisma.quotation.findUnique.mockResolvedValue({
      id: 5, quotationNo: 'QTN-1005', status: 'SENT', businessId: 1, customerId: 1,
      description: '', lines: [{ id: 1, accountId: 10, itemName: '', description: 'Service', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
    });
    prisma.account.findMany.mockResolvedValue([{ id: 10, normalBalance: 'CREDIT' }]);
    prisma.invoice.count.mockResolvedValue(999);
    let created;
    prisma.invoice.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, invoiceNo: 'INV-1000', customer: { name: 'Acme' }, ...args.data, lines: [] });
    });
    prisma.quotation.update.mockResolvedValue({});
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.convert, {
      params: { id: '5' },
      body: { dueDate: '2026-10-24', paymentTerms: 'Net 45', accounts: [{ lineId: 1, accountId: 10 }] },
    });

    expect(created.paymentTerms).toBe('Net 45');
  });
});
