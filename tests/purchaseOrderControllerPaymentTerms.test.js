jest.mock('../server/config/database', () => ({
  purchaseOrder: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), $transaction: jest.fn() },
  purchaseOrderLine: { deleteMany: jest.fn(), createMany: jest.fn() },
  bill: { create: jest.fn(), findFirst: jest.fn() },
  $transaction: jest.fn((arg) => (Array.isArray(arg) ? Promise.all(arg) : arg())),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/purchaseOrderController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, user: { id: 1 }, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('purchaseOrderController — paymentTerms snapshot and carry-forward', () => {
  test('create stores the submitted paymentTerms label', async () => {
    let created;
    prisma.purchaseOrder.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, poNumber: 'PO-1000', vendor: { name: 'Acme Supply' }, ...args.data, lines: [] });
    });

    await run(ctrl.create, {
      body: {
        vendorId: 1, orderDate: '2026-09-09', paymentTerms: 'Net 30',
        lines: [{ description: 'Item A', quantity: 1, unitPrice: 1000, accountId: 1 }],
      },
    });

    expect(created.paymentTerms).toBe('Net 30');
  });

  test('convertToBill stores the submitted paymentTerms on the new bill', async () => {
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: 1, poNumber: 'PO-1000', status: 'RECEIVED', vendorId: 1,
      vendor: { name: 'Acme Supply' },
      lines: [{ accountId: 1, description: 'Item A', quantity: 1, unitPrice: 1000, amount: 1000 }],
      subtotal: 1000, taxAmount: 0, total: 1000,
    });
    let created;
    prisma.bill.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, billNo: 'BILL-000001', vendor: { name: 'Acme Supply' }, ...args.data, lines: [] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.convertToBill, {
      params: { id: '1' },
      body: { billDate: '2026-09-09', dueDate: '2026-10-09', paymentTerms: 'Net 30' },
    });

    expect(created.paymentTerms).toBe('Net 30');
  });
});
