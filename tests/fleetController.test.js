jest.mock('../server/config/database', () => ({
  driver:  { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
  vehicle: { findMany: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/fleetController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('drivers', () => {
  test('list is scoped to the business, ordered by code, and can filter by active', async () => {
    prisma.driver.findMany.mockResolvedValue([]);

    await run(ctrl.listDrivers, { query: { active: 'true' } });

    expect(prisma.driver.findMany).toHaveBeenCalledWith({
      where: { businessId: 1, isActive: true }, orderBy: { code: 'asc' },
    });
  });

  test('list without a filter returns active and inactive drivers', async () => {
    prisma.driver.findMany.mockResolvedValue([]);

    await run(ctrl.listDrivers, {});

    expect(prisma.driver.findMany).toHaveBeenCalledWith({ where: { businessId: 1 }, orderBy: { code: 'asc' } });
  });

  test('create trims the code and name and scopes to the business', async () => {
    prisma.driver.create.mockResolvedValue({ id: 5 });

    await run(ctrl.createDriver, { body: { code: ' DRV-001 ', name: ' Juan Dela Cruz ' } });

    expect(prisma.driver.create).toHaveBeenCalledWith({
      data: { businessId: 1, code: 'DRV-001', name: 'Juan Dela Cruz' },
    });
  });

  test('create needs a code and a name', async () => {
    await expect(run(ctrl.createDriver, { body: { code: '', name: 'Juan' } })).rejects.toThrow('code');
    await expect(run(ctrl.createDriver, { body: { code: 'D1', name: '  ' } })).rejects.toThrow('name');
    expect(prisma.driver.create).not.toHaveBeenCalled();
  });

  test('a duplicate code becomes a friendly 409', async () => {
    prisma.driver.create.mockRejectedValue({ code: 'P2002' });

    await expect(run(ctrl.createDriver, { body: { code: 'D1', name: 'Juan' } })).rejects.toThrow('already exists');
  });

  test("update 404s for another business's driver", async () => {
    prisma.driver.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.updateDriver, { params: { id: '4' }, body: { name: 'X' } })).rejects.toThrow('not found');
    expect(prisma.driver.findFirst).toHaveBeenCalledWith({ where: { id: 4, businessId: 1 } });
    expect(prisma.driver.update).not.toHaveBeenCalled();
  });

  test('update changes only the fields that were sent (including deactivating)', async () => {
    prisma.driver.findFirst.mockResolvedValue({ id: 4 });
    prisma.driver.update.mockResolvedValue({ id: 4 });

    await run(ctrl.updateDriver, { params: { id: '4' }, body: { isActive: false } });

    expect(prisma.driver.update).toHaveBeenCalledWith({ where: { id: 4 }, data: { isActive: false } });
  });
});

describe('vehicles', () => {
  test('create takes a code and an optional description', async () => {
    prisma.vehicle.create.mockResolvedValue({ id: 2 });

    await run(ctrl.createVehicle, { body: { code: 'ABC 123', description: 'Isuzu Elf' } });
    await run(ctrl.createVehicle, { body: { code: 'XYZ 789' } });

    expect(prisma.vehicle.create).toHaveBeenNthCalledWith(1, { data: { businessId: 1, code: 'ABC 123', description: 'Isuzu Elf' } });
    expect(prisma.vehicle.create).toHaveBeenNthCalledWith(2, { data: { businessId: 1, code: 'XYZ 789', description: null } });
  });

  test('create needs a code', async () => {
    await expect(run(ctrl.createVehicle, { body: { code: ' ' } })).rejects.toThrow('code');
  });

  test('list and update are scoped like drivers', async () => {
    prisma.vehicle.findMany.mockResolvedValue([]);
    await run(ctrl.listVehicles, {});
    expect(prisma.vehicle.findMany).toHaveBeenCalledWith({ where: { businessId: 1 }, orderBy: { code: 'asc' } });

    prisma.vehicle.findFirst.mockResolvedValue(null);
    await expect(run(ctrl.updateVehicle, { params: { id: '9' }, body: { description: 'x' } })).rejects.toThrow('not found');
  });
});
