jest.mock('../server/config/database', () => ({
  bill: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  account: { findMany: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('payableController — paymentTerms snapshot', () => {
  test('createBill stores the submitted paymentTerms label', async () => {
    prisma.account.findMany.mockResolvedValue([{ id: 1, normalBalance: 'DEBIT' }]);
    prisma.bill.count.mockResolvedValue(0);
    let created;
    prisma.bill.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, billNo: 'BILL-000001', vendor: { name: 'Acme Supply' }, ...args.data, lines: [] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createBill, {
      body: {
        vendorId: 1, billDate: '2026-08-28', dueDate: '2026-09-27', paymentTerms: 'Net 30',
        lines: [{ accountId: 1, description: 'Item A', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(created.paymentTerms).toBe('Net 30');
  });

  test('createBill stores null when no paymentTerms is submitted', async () => {
    prisma.account.findMany.mockResolvedValue([{ id: 1, normalBalance: 'DEBIT' }]);
    prisma.bill.count.mockResolvedValue(0);
    let created;
    prisma.bill.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, billNo: 'BILL-000001', vendor: { name: 'Acme Supply' }, ...args.data, lines: [] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createBill, {
      body: {
        vendorId: 1, billDate: '2026-08-28', dueDate: '2026-09-27',
        lines: [{ accountId: 1, description: 'Item A', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(created.paymentTerms).toBeNull();
  });
});
