jest.mock('../server/config/database', () => ({
  expenseVoucher: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  expenseVoucherItem: { deleteMany: jest.fn(), createMany: jest.fn() },
  cashRequest: { findFirst: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn(), diff: jest.fn() }));
jest.mock('../server/utils/cashDenomination', () => ({
  resolveCount: jest.fn().mockResolvedValue(null), saveCount: jest.fn(),
}));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/expenseController');
const { buildLiquidationEntry } = require('../server/utils/cashAdvance');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, user: { id: 1 }, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const items = [
  { description: 'Brake pads', accountId: 50, amount: 1500, driverId: 3, vehicleId: '7' },
  { description: 'Oil', accountId: 50, amount: 500 },
];

beforeEach(() => {
  jest.clearAllMocks();
  prisma.expenseVoucher.findFirst.mockResolvedValue(null);
  prisma.expenseVoucher.create.mockResolvedValue({ id: 1, items: [] });
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
});

describe('tags on voucher items', () => {
  test('create stores a tag on the items that have one and leaves the others untouched', async () => {
    await run(ctrl.create, {
      body: { type: 'DIRECT_PAYMENT', date: '2026-10-01', payee: 'Shop', category: 'REPAIRS', purpose: 'Repair', items },
    });

    const created = prisma.expenseVoucher.create.mock.calls[0][0].data.items.create;
    expect(created[0]).toMatchObject({ description: 'Brake pads', driverId: 3, vehicleId: 7 });
    expect(Object.keys(created[1]).sort()).toEqual(['accountId', 'amount', 'description', 'receiptNo']);
  });

  test('update carries the tags when it rewrites the items', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue({ id: 5, status: 'DRAFT', totalAmount: 0, items: [] });
    prisma.expenseVoucher.update.mockResolvedValue({ id: 5, items: [] });

    await run(ctrl.update, { params: { id: '5' }, body: { items } });

    const rows = prisma.expenseVoucherItem.createMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({ voucherId: 5, driverId: 3, vehicleId: 7 });
    expect(rows[1]).not.toHaveProperty('driverId');
  });
});

describe('paying a voucher posts the tags to the expense lines', () => {
  const approved = {
    id: 9, businessId: 1, voucherNo: 'EV-000009', type: 'DIRECT_PAYMENT', status: 'APPROVED', category: 'REPAIRS',
    payee: 'Shop', purpose: 'Repair', totalAmount: 2000, cashRequestId: null,
    items: [
      { description: 'Brake pads', accountId: 50, amount: 1500, driverId: 3, vehicleId: 7 },
      { description: 'Oil', accountId: null, amount: 500, driverId: null, vehicleId: 8 },
    ],
  };

  test('both the account-based and the category-fallback lines keep their tags; the cash line has none', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue(approved);
    prisma.expenseVoucher.update.mockResolvedValue({ id: 9 });

    await run(ctrl.pay, { params: { id: '9' }, body: { paidDate: '2026-10-02' } });

    const lines = glPost.safePost.mock.calls[0][0].lines;
    expect(lines[0]).toMatchObject({ accountId: 50, debit: 1500, driverId: 3, vehicleId: 7 });
    expect(lines[1]).toMatchObject({ accountCode: '6240', debit: 500, vehicleId: 8 });
    expect(lines[1]).not.toHaveProperty('driverId');
    const cash = lines[lines.length - 1];
    expect(cash).toMatchObject({ credit: 2000 });
    expect(cash).not.toHaveProperty('driverId');
    expect(cash).not.toHaveProperty('vehicleId');
  });
});

describe('liquidation entries keep the tags', () => {
  test('buildLiquidationEntry passes driverId and vehicleId through to the expense lines', () => {
    const { lines } = buildLiquidationEntry({
      requestNo: 'CR-1', releasedAmount: 1000, cashAccountCode: '1010',
      lines: [
        { description: 'Tire', amount: 600, accountId: 50, driverId: 3, vehicleId: 7 },
        { description: 'Misc', amount: 400 },
      ],
    });

    expect(lines[0]).toMatchObject({ accountId: 50, debit: 600, driverId: 3, vehicleId: 7 });
    expect(lines[1]).not.toHaveProperty('driverId');
  });
});
