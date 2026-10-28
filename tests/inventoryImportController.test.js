jest.mock('../server/config/database', () => ({
  inventoryItem: { findMany: jest.fn(), createMany: jest.fn(), updateMany: jest.fn() },
  inventoryCategory: { findMany: jest.fn(), create: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const { recordAudit } = require('../server/utils/audit');
const ctrl = require('../server/controllers/inventoryController');

const CLIENT_SHEET = [
  ['PRODUCT CODE', 'PRODUCTS', 'CATEGORY', 'WEIGHT / PACK', 'PACKS / CASE', 'KG / CASE', 'PCS / PACK'],
  ['1000012713', 'MAESTRO SHOESTRING FRIES', 'FRIES', '1kg', '10 packs', '10 kg', 'N/A'],
  ['J000073-2', 'MAESTRO HUNGARIAN SAUSAGE', 'SAUSAGE, HUNGARIAN', '1kg', '10 packs', '10 kg', '11 pcs'],
];

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
const importReq = (body, businessId = 9) => ({ businessId, body, query: {}, user: { id: 1 } });

beforeEach(() => {
  jest.clearAllMocks();
  prisma.inventoryItem.findMany.mockResolvedValue([]);
  prisma.inventoryCategory.findMany.mockResolvedValue([]);
  prisma.inventoryCategory.create.mockImplementation(async ({ data }) => ({ id: data.name === 'FRIES' ? 101 : 102, ...data }));
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
});

describe('importItems', () => {
  test('check (dry run) returns the plan and writes nothing', async () => {
    const { res } = await call(ctrl.importItems, importReq({ grid: CLIENT_SHEET, dryRun: true }));
    expect(res.statusCode).toBe(200);
    expect(res.body.summary).toEqual({ create: 2, update: 0, unchanged: 0, errors: 0, warnings: 0 });
    expect(res.body.mapping).toEqual(['sku', 'name', 'category', 'weightPerPackKg', 'packsPerCase', 'kgPerCase', 'pcsPerPack']);
    expect(res.body.newCategories).toEqual(['FRIES', 'SAUSAGE, HUNGARIAN']);
    expect(res.body.fields[0]).toEqual({ key: 'sku', label: 'Product Code' });
    expect(res.body).not.toHaveProperty('creates');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('reads only this business', async () => {
    await call(ctrl.importItems, importReq({ grid: CLIENT_SHEET, dryRun: true }, 4));
    expect(prisma.inventoryItem.findMany.mock.calls[0][0].where).toEqual({ businessId: 4 });
    expect(prisma.inventoryCategory.findMany.mock.calls[0][0].where).toEqual({ businessId: 4, isActive: true });
  });

  test('import creates categories and items in one transaction, scoped to the business', async () => {
    const { res } = await call(ctrl.importItems, importReq({ grid: CLIENT_SHEET }));
    expect(res.body).toEqual({ created: 2, updated: 0, unchanged: 0, categoriesCreated: 2 });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryCategory.create).toHaveBeenCalledWith({ data: { businessId: 9, name: 'FRIES', type: 'PRODUCT' } });
    const created = prisma.inventoryItem.createMany.mock.calls[0][0].data;
    expect(created[0]).toMatchObject({
      businessId: 9, sku: '1000012713', categoryId: 101, weightPerPackKg: 1, packsPerCase: 10, pcsPerPack: null,
    });
    expect(created[0]).not.toHaveProperty('category');
    expect(created[1]).toMatchObject({ sku: 'J000073-2', categoryId: 102 });
    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'IMPORT', entity: 'InventoryItem',
      summary: 'Imported inventory items: 2 created, 0 updated, 2 categories added',
    }));
  });

  test('updates go through updateMany with the business in the where clause', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([{
      id: 7, sku: '1000012713', name: 'MAESTRO SHOESTRING FRIES', isActive: true, unit: 'pcs', description: null,
      costPrice: '0', sellingPrice: '0', reorderLevel: '0', warehouseLocation: null,
      weightPerPackKg: null, packsPerCase: null, pcsPerPack: null, category: null,
    }]);
    prisma.inventoryCategory.findMany.mockResolvedValue([{ id: 101, name: 'FRIES' }]);

    await call(ctrl.importItems, importReq({ grid: CLIENT_SHEET.slice(0, 2) }));

    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: 7, businessId: 9 },
      data: { weightPerPackKg: 1, packsPerCase: 10, categoryId: 101 },
    });
    expect(prisma.inventoryItem.createMany).not.toHaveBeenCalled();
    expect(prisma.inventoryCategory.create).not.toHaveBeenCalled();
  });

  test('a file with errors returns 422 and writes nothing', async () => {
    const grid = [['Product Code', 'Item Name', 'Packs / Case'], ['A1', 'Fries', 'ten']];
    const { res } = await call(ctrl.importItems, importReq({ grid }));
    expect(res.statusCode).toBe(422);
    expect(res.body.error).toBe('1 row has errors. Nothing was imported.');
    expect(res.body.rows[0].errors).toEqual(['Packs / Case "ten" is not a whole number.']);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('a file without a header row is rejected', async () => {
    const { res } = await call(ctrl.importItems, importReq({ grid: [['hello', 'world']], dryRun: true }));
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe("Couldn't find the header row. The file needs column names such as Product Code and Item Name.");
  });

  test('a chosen mapping overrides the guess and is validated', async () => {
    const grid = [['PRODUCT CODE', 'PRODUCTS', 'NOTES'], ['A1', 'Fries', 'Crinkle cut']];
    const ok = await call(ctrl.importItems, importReq({ grid, mapping: ['sku', 'name', 'description'], dryRun: true }));
    expect(ok.res.body.mapping).toEqual(['sku', 'name', 'description']);
    expect(ok.res.body.ignoredHeaders).toEqual([]);

    const bad = await call(ctrl.importItems, importReq({ grid, mapping: ['sku', 'name', 'name'], dryRun: true }));
    expect(bad.res.statusCode).toBe(400);
    expect(bad.res.body.error).toBe('Item Name is chosen for more than one column.');
  });

  test('a SKU clash during the write becomes a 409 and is not audited', async () => {
    prisma.inventoryItem.createMany.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }));
    const { res } = await call(ctrl.importItems, importReq({ grid: CLIENT_SHEET }));
    expect(res.statusCode).toBe(409);
    expect(res.body.error).toBe('Items changed while importing. Check the file again.');
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe('exportItems', () => {
  test('active items of this business, with Kg / Case calculated', async () => {
    prisma.inventoryItem.findMany.mockResolvedValue([{
      id: 1, sku: 'S1', name: 'Fries', isActive: true, unit: 'pack', description: null,
      costPrice: '200.00', sellingPrice: '285.00', reorderLevel: '5.000', warehouseLocation: null,
      weightPerPackKg: '1.000', packsPerCase: 10, pcsPerPack: 11, category: { name: 'FRIES' },
    }]);
    const { res } = await call(ctrl.exportItems, { businessId: 9, query: {} });
    expect(prisma.inventoryItem.findMany.mock.calls[0][0].where).toEqual({ businessId: 9, isActive: true });
    expect(res.body.columns[0]).toEqual({ key: 'sku', label: 'Product Code' });
    expect(res.body.rows[0]).toMatchObject({ sku: 'S1', category: 'FRIES', costPrice: 200, kgPerCase: 10, pcsPerPack: 11 });
  });

  test('template=1 returns one example row without reading items', async () => {
    const { res } = await call(ctrl.exportItems, { businessId: 9, query: { template: '1' } });
    expect(res.body.rows).toHaveLength(1);
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });
});
