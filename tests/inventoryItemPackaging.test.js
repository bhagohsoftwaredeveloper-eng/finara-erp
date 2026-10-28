jest.mock('../server/config/database', () => ({
  inventoryItem: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/inventoryController');

const call = async (handler, req) => {
  const res = {
    statusCode: 200, body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const next = jest.fn();
  await handler(req, res, next);
  return { res, next };
};

beforeEach(() => jest.clearAllMocks());

describe('createItem packaging', () => {
  test('stores the parsed packaging fields', async () => {
    prisma.inventoryItem.create.mockResolvedValue({ id: 1 });
    const { res } = await call(ctrl.createItem, {
      businessId: 9,
      body: { sku: 'F-1', name: 'Fries', weightPerPackKg: '1.5', packsPerCase: '10', pcsPerPack: '' },
    });
    expect(res.statusCode).toBe(201);
    expect(prisma.inventoryItem.create.mock.calls[0][0].data)
      .toMatchObject({ businessId: 9, weightPerPackKg: 1.5, packsPerCase: 10, pcsPerPack: null });
  });

  test('rejects a fractional Packs / Case without writing', async () => {
    const { res } = await call(ctrl.createItem, { businessId: 9, body: { name: 'Fries', packsPerCase: '2.5' } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Packs / Case is not a whole number');
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });

  test('rejects a negative weight without writing', async () => {
    const { res } = await call(ctrl.createItem, { businessId: 9, body: { name: 'Fries', weightPerPackKg: '-1' } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Weight / Pack (kg) cannot be negative');
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });
});

describe('updateItem packaging', () => {
  test('touches only the packaging fields that were sent; empty clears', async () => {
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: 3 });
    prisma.inventoryItem.update.mockResolvedValue({ id: 3 });
    await call(ctrl.updateItem, { businessId: 9, params: { id: '3' }, body: { packsPerCase: '12', pcsPerPack: '' } });
    const data = prisma.inventoryItem.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ packsPerCase: 12, pcsPerPack: null });
    expect(data).not.toHaveProperty('weightPerPackKg');
  });

  test('rejects bad packaging before looking the item up', async () => {
    const { res } = await call(ctrl.updateItem, { businessId: 9, params: { id: '3' }, body: { pcsPerPack: 'lots' } });
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Pcs / Pack is not a whole number');
    expect(prisma.inventoryItem.findFirst).not.toHaveBeenCalled();
  });
});
