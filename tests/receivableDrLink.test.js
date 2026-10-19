jest.mock('../server/config/database', () => ({
  invoice: { findFirst: jest.fn(), create: jest.fn() },
  account: { findMany: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));
jest.mock('../server/controllers/deliveryReceiptController', () => ({
  prepareLink: jest.fn(), applyLink: jest.fn(),
}));

const prisma = require('../server/config/database');
const dr = require('../server/controllers/deliveryReceiptController');
const ctrl = require('../server/controllers/receivableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, user: { id: 1 }, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const body = (extra = {}) => ({
  customerId: 7, invoiceDate: '2026-02-01', dueDate: '2026-03-03',
  lines: [{ accountId: 5, description: 'Widget', quantity: 2, unitPrice: 100, vatCode: 'EXEMPT' }],
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.invoice.findFirst.mockResolvedValue(null);
  prisma.account.findMany.mockResolvedValue([{ id: 5, normalBalance: 'CREDIT' }]);
  prisma.invoice.create.mockImplementation(async ({ data }) => ({ id: 11, ...data, customer: { name: 'ACME' }, lines: [] }));
});

describe('createInvoice with a delivery receipt', () => {
  test('validates the DR first, then links it to the new invoice', async () => {
    const link = { id: 4 };
    dr.prepareLink.mockResolvedValue(link);

    await run(ctrl.createInvoice, { body: body({ deliveryReceiptId: 4 }) });

    expect(dr.prepareLink).toHaveBeenCalledWith(4, 7, 1);
    expect(dr.applyLink).toHaveBeenCalledWith(link, 11);
  });

  test('a bad DR stops the invoice from being created at all', async () => {
    dr.prepareLink.mockRejectedValue(new Error('That delivery receipt is cancelled'));

    await expect(run(ctrl.createInvoice, { body: body({ deliveryReceiptId: 4 }) })).rejects.toThrow('cancelled');
    expect(prisma.invoice.create).not.toHaveBeenCalled();
  });

  test('without a DR nothing is linked', async () => {
    await run(ctrl.createInvoice, { body: body() });

    expect(dr.prepareLink).not.toHaveBeenCalled();
    expect(dr.applyLink).not.toHaveBeenCalled();
  });

  test('a failure while linking does not fail the invoice that was already created', async () => {
    dr.prepareLink.mockResolvedValue({ id: 4 });
    dr.applyLink.mockRejectedValue(new Error('db down'));

    const inv = await run(ctrl.createInvoice, { body: body({ deliveryReceiptId: 4 }) });

    expect(inv.id).toBe(11);
  });
});
