jest.mock('../server/config/database', () => ({
  inventoryItem: { findMany: jest.fn() },
  inventoryTransaction: { findMany: jest.fn() },
}));
const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/inventoryController');

const d = (s) => new Date(`${s}T00:00:00.000Z`);
const run = async (query) => {
  let body;
  await ctrl.stockOnHand({ query, businessId: 1 }, { json: (b) => { body = b; } }, (e) => { throw e; });
  return body.items[0];
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.inventoryItem.findMany.mockResolvedValue([
    { id: 1, sku: 'S1', name: 'Widget', unit: 'pcs', category: null, costPrice: 10, sellingPrice: 20, currentStock: 12, reorderLevel: 0 },
  ]);
  // +10 (Oct 1), -3 (Oct 5), +5 (Oct 10)  => 10, 7, 12
  prisma.inventoryTransaction.findMany.mockResolvedValue([
    { itemId: 1, txnDate: d('2026-10-01'), runningStock: 10 },
    { itemId: 1, txnDate: d('2026-10-05'), runningStock: 7 },
    { itemId: 1, txnDate: d('2026-10-10'), runningStock: 12 },
  ]);
});

describe('stockOnHand date range', () => {
  test('without dates it is the plain snapshot (no period fields, no ledger read)', async () => {
    const item = await run({});
    expect(item.currentStock).toBe(12);
    expect(item.qtyIn).toBeUndefined();
    expect(prisma.inventoryTransaction.findMany).not.toHaveBeenCalled();
  });

  test('range reports opening, in, out and the closing balance as of the to date', async () => {
    const item = await run({ from: '2026-10-04', to: '2026-10-06' });
    expect(item.openingStock).toBe(10); // after Oct 1
    expect(item.qtyIn).toBe(0);
    expect(item.qtyOut).toBe(3);        // Oct 5
    expect(item.currentStock).toBe(7);  // as of Oct 6, not today's 12
    expect(item.stockValue).toBe(70);
  });

  test('range that spans everything counts every movement from zero', async () => {
    const item = await run({ from: '2026-09-01', to: '2026-10-31' });
    expect(item.openingStock).toBe(0);
    expect(item.qtyIn).toBe(15);  // 10 + 5
    expect(item.qtyOut).toBe(3);
    expect(item.currentStock).toBe(12);
  });
});
