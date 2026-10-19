jest.mock('../server/config/database', () => ({
  invoice: { findFirst: jest.fn(), update: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));
jest.mock('../server/controllers/deliveryReceiptController', () => ({
  prepareLink: jest.fn(), applyLink: jest.fn(), createForShipment: jest.fn(),
}));

const prisma = require('../server/config/database');
const dr = require('../server/controllers/deliveryReceiptController');
const ctrl = require('../server/controllers/receivableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: { id: '3' }, query: {}, user: { id: 1 }, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const ship = { shippedDate: '2026-02-03', shippingAddress: 'Cebu', courier: 'LBC', trackingNumber: 'T1' };

beforeEach(() => {
  jest.clearAllMocks();
  prisma.invoice.findFirst.mockResolvedValue({ id: 3, status: 'PAID' });
  prisma.invoice.update.mockResolvedValue({ id: 3, deliveryStatus: 'SHIPPED' });
});

describe('markShipped creates the delivery receipt', () => {
  test('saves the shipping info, then makes a DR and returns it with the invoice', async () => {
    dr.createForShipment.mockResolvedValue({ id: 8, drNo: 'DR-000008' });

    const r = await run(ctrl.markShipped, { body: ship });

    expect(prisma.invoice.update).toHaveBeenCalled();
    expect(dr.createForShipment).toHaveBeenCalledWith(1, 3, ship);
    expect(r.deliveryReceipt).toEqual({ id: 8, drNo: 'DR-000008' });
    expect(r.deliveryStatus).toBe('SHIPPED');
  });

  test('createDr:false only updates the shipping info', async () => {
    const r = await run(ctrl.markShipped, { body: { ...ship, createDr: false } });

    expect(dr.createForShipment).not.toHaveBeenCalled();
    expect(r.deliveryReceipt).toBeNull();
  });

  test('a failure while making the DR does not fail the shipment', async () => {
    dr.createForShipment.mockRejectedValue(new Error('db down'));

    const r = await run(ctrl.markShipped, { body: ship });

    expect(r.deliveryStatus).toBe('SHIPPED');
    expect(r.deliveryReceipt).toBeNull();
  });
});
