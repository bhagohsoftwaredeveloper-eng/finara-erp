jest.mock('../server/config/database', () => ({
  deliveryReceipt: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  invoice: { findFirst: jest.fn(), update: jest.fn() },
  customer: { findFirst: jest.fn() },
  inventoryItem: { findFirst: jest.fn(), update: jest.fn() },
  inventoryTransaction: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/deliveryReceiptController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, user: { id: 5 }, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const widget = { id: 7, sku: 'A-1', name: 'Widget', currentStock: '10', costPrice: '25.5', cogsAccountId: null, inventoryAccountId: null };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma)); // the mocked client doubles as tx
  prisma.deliveryReceipt.findFirst.mockResolvedValue(null);          // genDrNo: no DR yet
  prisma.inventoryTransaction.findFirst.mockResolvedValue({ id: 41 });
});

describe('create', () => {
  test('from an invoice: uses its customer, address and lines, and expands package contents', async () => {
    prisma.invoice.findFirst.mockResolvedValue({
      id: 3, status: 'OPEN', customerId: 9, shippingAddress: 'Cebu City',
      lines: [
        { description: 'Delivery fee', quantity: '1', packageId: null, packageComponents: null },
        { description: 'Starter kit', quantity: '2', packageId: 4,
          packageComponents: [{ description: 'Cable', quantity: 4, unit: 'pcs' }, { description: 'Router', quantity: 2, unit: 'pcs' }] },
      ],
    });
    prisma.customer.findFirst.mockResolvedValue({ id: 9, address: 'Main St' });
    prisma.deliveryReceipt.create.mockResolvedValue({ id: 1 });

    await run(ctrl.create, { body: { invoiceId: 3, drDate: '2026-02-03' } });

    expect(prisma.deliveryReceipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: 1, drNo: 'DR-000001', customerId: 9, invoiceId: 3,
        deliveryAddress: 'Cebu City',
        lines: { create: [
          { itemId: null, description: 'Delivery fee', quantity: 1, unit: null },
          { itemId: null, description: 'Cable', quantity: 4, unit: 'pcs' },
          { itemId: null, description: 'Router', quantity: 2, unit: 'pcs' },
        ] },
      }),
    }));
  });

  test('standalone needs a customer and at least one valid line', async () => {
    await expect(run(ctrl.create, { body: { drDate: '2026-02-03', lines: [] } })).rejects.toThrow('customerId or invoiceId');

    prisma.customer.findFirst.mockResolvedValue({ id: 9, address: null });
    await expect(run(ctrl.create, { body: { customerId: 9, drDate: '2026-02-03', lines: [] } })).rejects.toThrow('at least one line');
    await expect(run(ctrl.create, { body: { customerId: 9, drDate: '2026-02-03', lines: [{ description: ' ', quantity: 1 }] } }))
      .rejects.toThrow('description');
    await expect(run(ctrl.create, { body: { customerId: 9, drDate: '2026-02-03', lines: [{ description: 'X', quantity: 0 }] } }))
      .rejects.toThrow('quantity');
  });

  test('the same inventory item twice, or an item of another business, is rejected', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 9, address: null });
    prisma.inventoryItem.findFirst.mockResolvedValue({ id: 7 });
    const twice = [{ itemId: 7, description: 'Widget', quantity: 1 }, { itemId: 7, description: 'Widget', quantity: 2 }];
    await expect(run(ctrl.create, { body: { customerId: 9, drDate: '2026-02-03', lines: twice } })).rejects.toThrow('two lines');

    prisma.inventoryItem.findFirst.mockResolvedValue(null);
    await expect(run(ctrl.create, { body: { customerId: 9, drDate: '2026-02-03', lines: [twice[0]] } })).rejects.toThrow('not found');
    expect(prisma.deliveryReceipt.create).not.toHaveBeenCalled();
  });
});

describe('update', () => {
  test('only a draft can be edited', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValue({ id: 1, status: 'DELIVERED' });

    await expect(run(ctrl.update, { params: { id: '1' }, body: { lines: [{ description: 'X', quantity: 1 }] } }))
      .rejects.toThrow('Only draft');
  });
});

describe('deliver', () => {
  const draft = (over = {}) => ({
    id: 1, businessId: 1, drNo: 'DR-000001', status: 'DRAFT', drDate: new Date('2026-02-03'), invoiceId: 3,
    deductStock: true, lines: [{ quantity: '2', item: widget }, { quantity: '1', item: null }], ...over,
  });

  test('takes stocked lines out of inventory, posts COGS, marks the invoice shipped', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(draft());
    prisma.invoice.findFirst.mockResolvedValue({ id: 3, deliveryStatus: 'PENDING' });
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1, status: 'DELIVERED' });

    await run(ctrl.deliver, { params: { id: '1' } });

    expect(prisma.inventoryItem.update).toHaveBeenCalledTimes(1); // the unstocked line moves nothing
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { currentStock: 8 } });
    expect(prisma.deliveryReceipt.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 1 }, data: expect.objectContaining({ status: 'DELIVERED' }),
    }));
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 3 }, data: expect.objectContaining({ deliveryStatus: 'SHIPPED' }),
    });
    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      reference: 'DR-000001', businessId: 1,
      lines: [
        { accountCode: '5010', debit: 51, description: 'COGS — A-1 ×2' },
        { accountCode: '1210', credit: 51, description: 'Inventory out — Widget' },
      ],
    }));
  });

  test('without "deduct stock" no inventory moves and no journal is posted', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(draft({ deductStock: false, invoiceId: null }));
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1 });

    await run(ctrl.deliver, { params: { id: '1' } });

    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    expect(glPost.safePost).not.toHaveBeenCalled();
    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('only a draft can be delivered', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(draft({ status: 'DELIVERED' }));

    await expect(run(ctrl.deliver, { params: { id: '1' } })).rejects.toThrow('draft');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('cancel', () => {
  const delivered = (over = {}) => ({
    id: 1, businessId: 1, drNo: 'DR-000001', status: 'DELIVERED', invoiceId: 3, deductStock: true, lines: [], ...over,
  });

  test('a delivered DR puts the stock back, reverses the journal and un-ships a DR-only invoice', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(delivered());
    prisma.inventoryTransaction.findMany.mockResolvedValue([{ itemId: 7, quantity: '2', unitCost: '25.5', totalCost: '51' }]);
    prisma.inventoryItem.findFirst.mockResolvedValue({ ...widget, currentStock: '8' });
    prisma.deliveryReceipt.count.mockResolvedValue(0);
    prisma.invoice.findFirst.mockResolvedValue({ id: 3, courier: null, trackingNumber: null });
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1, status: 'CANCELLED' });

    await run(ctrl.cancel, { params: { id: '1' }, body: { reason: 'Wrong address' } });

    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { currentStock: 10 } });
    expect(prisma.deliveryReceipt.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'CANCELLED', cancelReason: 'Wrong address' }),
    }));
    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { deliveryStatus: 'PENDING', shippedDate: null } });
    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      lines: [
        { accountCode: '1210', debit: 51, description: 'Inventory in — Widget (cancelled)' },
        { accountCode: '5010', credit: 51, description: 'COGS reversal — A-1 (cancelled)' },
      ],
    }));
  });

  test('keeps the invoice shipped when it was shipped by hand (has a courier)', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(delivered({ deductStock: false }));
    prisma.deliveryReceipt.count.mockResolvedValue(0);
    prisma.invoice.findFirst.mockResolvedValue({ id: 3, courier: 'LBC', trackingNumber: null });
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1 });

    await run(ctrl.cancel, { params: { id: '1' }, body: {} });

    expect(prisma.invoice.update).not.toHaveBeenCalled();
  });

  test('a draft is simply cancelled; a cancelled DR cannot be cancelled again', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(delivered({ status: 'DRAFT', invoiceId: null, deductStock: false }));
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1 });
    await run(ctrl.cancel, { params: { id: '1' }, body: {} });
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    expect(glPost.safePost).not.toHaveBeenCalled();

    prisma.deliveryReceipt.findFirst.mockResolvedValueOnce(delivered({ status: 'CANCELLED' }));
    await expect(run(ctrl.cancel, { params: { id: '1' }, body: {} })).rejects.toThrow('already cancelled');
  });
});

describe('invoice linking helpers', () => {
  test('prepareLink accepts a free DR of the same customer', async () => {
    const dr = { id: 1, status: 'DRAFT', invoiceId: null, customerId: 9 };
    prisma.deliveryReceipt.findFirst.mockResolvedValue(dr);

    expect(await ctrl.prepareLink(1, 9, 1)).toBe(dr);
    expect(prisma.deliveryReceipt.findFirst).toHaveBeenCalledWith({ where: { id: 1, businessId: 1 } });
  });

  test.each([
    [null, 'not found'],
    [{ id: 1, status: 'CANCELLED', invoiceId: null, customerId: 9 }, 'cancelled'],
    [{ id: 1, status: 'DRAFT', invoiceId: 2, customerId: 9 }, 'already linked'],
    [{ id: 1, status: 'DRAFT', invoiceId: null, customerId: 10 }, 'different customer'],
  ])('prepareLink rejects %j', async (dr, msg) => {
    prisma.deliveryReceipt.findFirst.mockResolvedValue(dr);

    await expect(ctrl.prepareLink(1, 9, 1)).rejects.toThrow(msg);
  });

  test('applyLink links the DR and ships the invoice only when the DR was already delivered', async () => {
    await ctrl.applyLink({ id: 1, status: 'DRAFT' }, 3);
    expect(prisma.deliveryReceipt.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { invoiceId: 3 } });
    expect(prisma.invoice.update).not.toHaveBeenCalled();

    await ctrl.applyLink({ id: 2, status: 'DELIVERED', deliveredAt: new Date('2026-02-04') }, 3);
    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 3 }, data: { deliveryStatus: 'SHIPPED', shippedDate: new Date('2026-02-04') },
    });
  });
});

describe('link / unlink an existing invoice', () => {
  const free = (over = {}) => ({ id: 1, status: 'DRAFT', invoiceId: null, customerId: 9, drDate: new Date('2026-02-03'), ...over });

  test('links a DR to an unpaid or paid invoice of the same customer', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValue(free());
    prisma.invoice.findFirst.mockResolvedValue({ id: 3, customerId: 9, status: 'PAID' });
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1 });

    await run(ctrl.link, { params: { id: '1' }, body: { invoiceId: '3' } });

    expect(prisma.invoice.findFirst).toHaveBeenCalledWith({ where: { id: 3, businessId: 1 } });
    expect(prisma.deliveryReceipt.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { invoiceId: 3 } });
  });

  test('a delivered DR also marks the invoice shipped when linked', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValue(free({ status: 'DELIVERED', deliveredAt: new Date('2026-02-04') }));
    prisma.invoice.findFirst.mockResolvedValue({ id: 3, customerId: 9, status: 'PAID' });
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1 });

    await run(ctrl.link, { params: { id: '1' }, body: { invoiceId: 3 } });

    expect(prisma.invoice.update).toHaveBeenCalledWith({
      where: { id: 3 }, data: { deliveryStatus: 'SHIPPED', shippedDate: new Date('2026-02-04') },
    });
  });

  test.each([
    [free({ status: 'CANCELLED' }), { id: 3, customerId: 9, status: 'OPEN' }, 'cancelled'],
    [free({ invoiceId: 2 }),        { id: 3, customerId: 9, status: 'OPEN' }, 'already linked'],
    [free(),                        null,                                     'Invoice not found'],
    [free(),                        { id: 3, customerId: 9, status: 'VOID' }, 'voided'],
    [free(),                        { id: 3, customerId: 10, status: 'OPEN' }, 'different customer'],
  ])('link rejects %#', async (dr, invoice, msg) => {
    prisma.deliveryReceipt.findFirst.mockResolvedValue(dr);
    prisma.invoice.findFirst.mockResolvedValue(invoice);

    await expect(run(ctrl.link, { params: { id: '1' }, body: { invoiceId: 3 } })).rejects.toThrow(msg);
    expect(prisma.deliveryReceipt.update).not.toHaveBeenCalled();
  });

  test('unlink clears the invoice and un-ships a DR-only invoice', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValue(free({ status: 'DELIVERED', invoiceId: 3 }));
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1 });
    prisma.deliveryReceipt.count.mockResolvedValue(0);
    prisma.invoice.findFirst.mockResolvedValue({ id: 3, courier: null, trackingNumber: null });

    await run(ctrl.unlink, { params: { id: '1' } });

    expect(prisma.deliveryReceipt.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 1 }, data: { invoiceId: null } }));
    expect(prisma.invoice.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { deliveryStatus: 'PENDING', shippedDate: null } });
  });

  test('unlink of a DR that is not linked is rejected', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValue(free());

    await expect(run(ctrl.unlink, { params: { id: '1' } })).rejects.toThrow('not linked');
  });
});

describe('createForShipment (Mark as Shipped makes the DR)', () => {
  const invoice = { id: 3, customerId: 9, status: 'OPEN', shippingAddress: null,
    lines: [{ description: 'Widget', quantity: '2', packageId: null, packageComponents: null }] };

  test('creates an already-delivered DR from the invoice using the shipping details', async () => {
    prisma.deliveryReceipt.count.mockResolvedValue(0);
    prisma.invoice.findFirst.mockResolvedValue(invoice);
    prisma.customer.findFirst.mockResolvedValue({ id: 9, address: 'Main St' });
    prisma.deliveryReceipt.create.mockResolvedValue({ id: 1, drNo: 'DR-000001' });

    const dr = await ctrl.createForShipment(1, 3, {
      shippedDate: '2026-02-03', shippingAddress: 'Cebu City', courier: 'LBC', trackingNumber: 'T123',
    });

    expect(prisma.deliveryReceipt.count).toHaveBeenCalledWith({
      where: { businessId: 1, invoiceId: 3, status: { not: 'CANCELLED' } },
    });
    expect(prisma.deliveryReceipt.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: 1, drNo: 'DR-000001', customerId: 9, invoiceId: 3, status: 'DELIVERED', deductStock: false,
        deliveryAddress: 'Cebu City', driverName: 'LBC', notes: 'Tracking: T123', drDate: new Date('2026-02-03'),
        lines: { create: [{ itemId: null, description: 'Widget', quantity: 2, unit: null }] },
      }),
    }));
    expect(dr).toEqual({ id: 1, drNo: 'DR-000001' });
  });

  test('falls back to the customer address and leaves driver/notes empty', async () => {
    prisma.deliveryReceipt.count.mockResolvedValue(0);
    prisma.invoice.findFirst.mockResolvedValue(invoice);
    prisma.customer.findFirst.mockResolvedValue({ id: 9, address: 'Main St' });
    prisma.deliveryReceipt.create.mockResolvedValue({ id: 1 });

    await ctrl.createForShipment(1, 3, { shippedDate: '2026-02-03' });

    expect(prisma.deliveryReceipt.create.mock.calls[0][0].data).toMatchObject({
      deliveryAddress: 'Main St', driverName: null, notes: null,
    });
  });

  test('does nothing when the invoice already has an active delivery receipt', async () => {
    prisma.deliveryReceipt.count.mockResolvedValue(1);

    expect(await ctrl.createForShipment(1, 3, { shippedDate: '2026-02-03' })).toBeNull();
    expect(prisma.deliveryReceipt.create).not.toHaveBeenCalled();
  });
});

describe('assigning a driver and a vehicle', () => {
  test('create stores the chosen driver and vehicle alongside the printed names', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 9, address: null });
    prisma.deliveryReceipt.create.mockResolvedValue({ id: 1 });

    await run(ctrl.create, {
      body: { customerId: 9, drDate: '2026-02-03', driverName: 'DRV-001 · Juan', vehicleNo: 'ABC 123', driverId: '3', vehicleId: 7,
        lines: [{ description: 'Box', quantity: 1 }] },
    });

    expect(prisma.deliveryReceipt.create.mock.calls[0][0].data).toMatchObject({
      driverName: 'DRV-001 · Juan', vehicleNo: 'ABC 123', driverId: 3, vehicleId: 7,
    });
  });

  test('without a choice no driver or vehicle keys are written', async () => {
    prisma.customer.findFirst.mockResolvedValue({ id: 9, address: null });
    prisma.deliveryReceipt.create.mockResolvedValue({ id: 1 });

    await run(ctrl.create, { body: { customerId: 9, drDate: '2026-02-03', driverName: 'LBC', lines: [{ description: 'Box', quantity: 1 }] } });

    const data = prisma.deliveryReceipt.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('driverId');
    expect(data).not.toHaveProperty('vehicleId');
  });

  test('update can change or clear the driver, and leaves it alone when the field is not sent', async () => {
    prisma.deliveryReceipt.findFirst.mockResolvedValue({ id: 1, status: 'DRAFT' });
    prisma.deliveryReceipt.update.mockResolvedValue({ id: 1 });
    const lines = [{ description: 'Box', quantity: 1 }];

    await run(ctrl.update, { params: { id: '1' }, body: { driverId: 4, vehicleId: null, lines } });
    expect(prisma.deliveryReceipt.update.mock.calls[0][0].data).toMatchObject({ driverId: 4, vehicleId: null });

    await run(ctrl.update, { params: { id: '1' }, body: { lines } });
    const data = prisma.deliveryReceipt.update.mock.calls[1][0].data;
    expect(data).not.toHaveProperty('driverId');
    expect(data).not.toHaveProperty('vehicleId');
  });
});
