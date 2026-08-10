jest.mock('../server/config/database', () => ({
  cashSale: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  account: { findFirst: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/cashSaleController');
const glPost = require('../server/utils/glPost');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('cashSaleController tenant isolation', () => {
  test('getOne only looks up a sale scoped to the current business', async () => {
    prisma.cashSale.findFirst.mockResolvedValue({ id: 5, businessId: 1, saleNo: 'CS-000005' });

    await run(ctrl.getOne, { params: { id: '5' } });

    expect(prisma.cashSale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 5, businessId: 1 }) })
    );
  });

  test('getOne 404s (not a leaked existence signal) when the sale belongs to another business', async () => {
    prisma.cashSale.findFirst.mockResolvedValue(null); // findFirst scoped to businessId:1 finds nothing for a Business-2-owned id

    await expect(run(ctrl.getOne, { params: { id: '5' } })).rejects.toMatchObject({ statusCode: 404 });
  });

  test('voidSale only looks up a sale scoped to the current business', async () => {
    prisma.cashSale.findFirst.mockResolvedValue({ id: 5, businessId: 1, status: 'ACTIVE', journalEntryId: null, saleNo: 'CS-000005' });
    prisma.cashSale.update = jest.fn().mockResolvedValue({});
    prisma.$transaction = jest.fn().mockResolvedValue([{}]);

    await run(ctrl.voidSale, { params: { id: '5' }, body: { reason: 'test reason' } });

    expect(prisma.cashSale.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 5, businessId: 1 }) })
    );
  });

  test('voidSale 404s when the sale belongs to another business', async () => {
    prisma.cashSale.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.voidSale, { params: { id: '5' }, body: { reason: 'test reason' } })).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('cash sale VAT split always sums back to the total', () => {
  test.each([1.26, 24.50, 101.50, 500.22, 1000.50])('amount %s produces subtotal + vatAmount === totalAmount', async (amount) => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.cashSale.findFirst.mockResolvedValue(null); // genSaleNo: no prior sale
    let created;
    prisma.cashSale.create.mockImplementation(({ data }) => { created = data; return Promise.resolve({ id: 1, ...data }); });
    glPost.safePost.mockResolvedValue({ id: 99 });
    prisma.cashSale.update.mockResolvedValue({});

    await run(ctrl.create, {
      body: { saleDate: '2026-08-10', description: 'test', accountId: 1, vatCode: 'VAT', amount, paymentMethod: 'Cash' },
    });

    expect(Number(created.subtotal) + Number(created.vatAmount)).toBeCloseTo(Number(created.totalAmount), 2);
  });
});
