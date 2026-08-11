jest.mock('../server/config/database', () => ({
  cashSale: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    count: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  account: { findFirst: jest.fn() },
  inventoryItem: { findFirst: jest.fn(), update: jest.fn() },
  inventoryTransaction: { findFirst: jest.fn(), create: jest.fn() },
  journalEntry: { update: jest.fn() },
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

describe('cash sale item picker — stock deduction on create', () => {
  test('create with itemId deducts stock and links an OUT inventory transaction via saleNo reference', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.cashSale.findFirst.mockResolvedValue(null); // genSaleNo: no prior sale
    prisma.inventoryItem.findFirst.mockResolvedValue({
      id: 9, businessId: 1, isActive: true, name: 'Widget', sku: 'SKU-0001', unit: 'pcs',
      currentStock: 10, costPrice: 50, sellingPrice: 100, cogsAccountId: null, inventoryAccountId: null,
    });
    prisma.inventoryTransaction.findFirst.mockResolvedValue(null); // nextTxnNo: no prior txn
    let savedSale, savedItemUpdate, savedTxn;
    prisma.cashSale.create.mockImplementation(({ data }) => {
      savedSale = { id: 1, saleDate: new Date('2026-08-11'), ...data };
      return Promise.resolve(savedSale);
    });
    prisma.inventoryItem.update.mockImplementation(({ data }) => { savedItemUpdate = data; return Promise.resolve({}); });
    prisma.inventoryTransaction.create.mockImplementation(({ data }) => { savedTxn = data; return Promise.resolve({ id: 1, ...data }); });
    prisma.$transaction.mockImplementation((ops) => Promise.all(ops));
    glPost.safePost.mockResolvedValue({ id: 99 });
    prisma.cashSale.update.mockResolvedValue({});

    await run(ctrl.create, {
      body: {
        saleDate: '2026-08-11', description: 'Widget x2', accountId: 1, vatCode: 'VAT',
        amount: 224, paymentMethod: 'Cash', itemId: 9, quantity: 2,
      },
    });

    expect(savedItemUpdate.currentStock).toBe(8); // 10 - 2
    expect(savedTxn).toMatchObject({ itemId: 9, type: 'OUT', quantity: 2, reference: savedSale.saleNo });
    expect(glPost.safePost).toHaveBeenCalledTimes(2); // cash-sale entry + COGS entry

    const cogsCall = glPost.safePost.mock.calls.find((c) => c[0].description.includes('Inventory OUT'));
    expect(cogsCall).toBeTruthy();
    const lines = cogsCall[0].lines;
    expect(lines.find((l) => l.accountCode === '5010').debit).toBeCloseTo(100, 2);  // 2 * costPrice 50
    expect(lines.find((l) => l.accountCode === '1210').credit).toBeCloseTo(100, 2);
  });

  test('create rejects when quantity exceeds current stock, without creating anything', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.inventoryItem.findFirst.mockResolvedValue({
      id: 9, isActive: true, currentStock: 1, unit: 'pcs', name: 'Widget', sku: 'SKU-0001', costPrice: 50, sellingPrice: 100,
    });

    await expect(run(ctrl.create, {
      body: { saleDate: '2026-08-11', description: 'Widget x5', accountId: 1, amount: 560, paymentMethod: 'Cash', itemId: 9, quantity: 5 },
    })).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.cashSale.create).not.toHaveBeenCalled();
  });

  test('create without itemId does not touch inventory at all', async () => {
    prisma.account.findFirst.mockResolvedValue({ id: 1, accountType: 'REVENUE', isActive: true });
    prisma.cashSale.findFirst.mockResolvedValue(null);
    prisma.cashSale.create.mockResolvedValue({ id: 1, saleDate: new Date('2026-08-11'), saleNo: 'CS-000001' });
    glPost.safePost.mockResolvedValue({ id: 99 });
    prisma.cashSale.update.mockResolvedValue({});

    await run(ctrl.create, {
      body: { saleDate: '2026-08-11', description: 'Service fee', accountId: 1, amount: 100, paymentMethod: 'Cash' },
    });

    expect(prisma.inventoryItem.findFirst).not.toHaveBeenCalled();
    expect(prisma.inventoryTransaction.create).not.toHaveBeenCalled();
    expect(glPost.safePost).toHaveBeenCalledTimes(1);
  });
});
