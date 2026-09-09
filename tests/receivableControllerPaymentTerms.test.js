jest.mock('../server/config/database', () => ({
  invoice: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  account: { findMany: jest.fn() },
  journalEntry: { findFirst: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/receivableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.account.findMany.mockResolvedValue([{ id: 1, normalBalance: 'CREDIT' }]);
  prisma.invoice.count.mockResolvedValue(999);
});

describe('receivableController — paymentTerms snapshot', () => {
  test('createInvoice stores the submitted paymentTerms label', async () => {
    let created;
    prisma.invoice.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, invoiceNo: 'INV-1000', customer: { name: 'Acme' }, ...args.data, lines: [] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createInvoice, {
      body: {
        customerId: 1, invoiceDate: '2026-09-09', dueDate: '2026-10-09', paymentTerms: 'Net 30',
        lines: [{ accountId: 1, description: 'Service', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(created.paymentTerms).toBe('Net 30');
  });

  test('createInvoice stores null when no paymentTerms is submitted', async () => {
    let created;
    prisma.invoice.create.mockImplementation((args) => {
      created = args.data;
      return Promise.resolve({ id: 1, invoiceNo: 'INV-1000', customer: { name: 'Acme' }, ...args.data, lines: [] });
    });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.createInvoice, {
      body: {
        customerId: 1, invoiceDate: '2026-09-09', dueDate: '2026-10-09',
        lines: [{ accountId: 1, description: 'Service', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(created.paymentTerms).toBeNull();
  });

  test('updateInvoice stores an updated paymentTerms label', async () => {
    prisma.invoice.findFirst.mockResolvedValue({ id: 1, status: 'OPEN', paidAmount: 0, invoiceNo: 'INV-1000' });
    let updatedData;
    prisma.invoice.update.mockImplementation((args) => {
      updatedData = args.data;
      return Promise.resolve({ id: 1, invoiceNo: 'INV-1000', customer: { name: 'Acme' }, ...args.data, lines: [], payments: [] });
    });
    prisma.journalEntry.findFirst.mockResolvedValue(null);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.updateInvoice, {
      params: { id: '1' },
      body: {
        customerId: 1, invoiceDate: '2026-09-09', dueDate: '2026-10-24', paymentTerms: 'Net 45',
        lines: [{ accountId: 1, description: 'Service', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT' }],
      },
    });

    expect(updatedData.paymentTerms).toBe('Net 45');
  });
});
