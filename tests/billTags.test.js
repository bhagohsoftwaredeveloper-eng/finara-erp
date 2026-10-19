jest.mock('../server/config/database', () => ({
  bill: { count: jest.fn(), findFirst: jest.fn(), create: jest.fn() },
  account: { findMany: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, user: { id: 1 }, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.account.findMany.mockResolvedValue([{ id: 1, normalBalance: 'DEBIT' }, { id: 2, normalBalance: 'DEBIT' }]);
  prisma.bill.count.mockResolvedValue(0);
  prisma.bill.findFirst.mockResolvedValue(null);
});

describe('tags on bill lines', () => {
  test('a tagged line is stored with its tags and its expense debit carries them to the GL', async () => {
    let data;
    prisma.bill.create.mockImplementation(async (args) => {
      data = args.data;
      return {
        id: 1, billNo: 'BILL-000001', vendor: { name: 'Repair Shop' }, ...args.data,
        lines: args.data.lines.create.map((l) => ({ ...l })),
      };
    });

    await run(ctrl.createBill, {
      body: {
        vendorId: 1, billDate: '2026-10-01', dueDate: '2026-10-31',
        lines: [
          { accountId: 1, description: 'Engine overhaul', quantity: 1, unitPrice: 1000, vatCode: 'EXEMPT', driverId: 3, vehicleId: '7' },
          { accountId: 2, description: 'Parts', quantity: 1, unitPrice: 500, vatCode: 'EXEMPT' },
        ],
      },
    });

    const [tagged, plain] = data.lines.create;
    expect(tagged).toMatchObject({ driverId: 3, vehicleId: 7 });
    expect(plain).not.toHaveProperty('driverId');
    expect(plain).not.toHaveProperty('vehicleId');

    const glLines = glPost.safePost.mock.calls[0][0].lines;
    expect(glLines[0]).toMatchObject({ accountId: 1, debit: 1000, driverId: 3, vehicleId: 7 });
    expect(glLines[1]).not.toHaveProperty('driverId');
    const ap = glLines[glLines.length - 1];
    expect(ap).toMatchObject({ accountCode: '2010', credit: 1500 });
    expect(ap).not.toHaveProperty('driverId');
  });
});
