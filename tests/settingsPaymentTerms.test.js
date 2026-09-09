jest.mock('../server/config/database', () => ({
  paymentTerm: {
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    delete: jest.fn(),
  },
}));

const prisma = require('../server/config/database');
const ctrl   = require('../server/controllers/settingsController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, body: {}, ...req },
     { status: (code) => ({ json: (body) => resolve({ statusCode: code, body }) }), json: (body) => resolve({ statusCode: 200, body }) },
     reject);
});

beforeEach(() => jest.clearAllMocks());

describe('settingsController — payment terms', () => {
  test('listPaymentTerms scopes by businessId and orders by sortOrder', async () => {
    prisma.paymentTerm.findMany.mockResolvedValue([{ id: 1, name: 'Net 30' }]);
    const { statusCode, body } = await run(ctrl.listPaymentTerms, {});
    expect(statusCode).toBe(200);
    expect(body).toEqual([{ id: 1, name: 'Net 30' }]);
    expect(prisma.paymentTerm.findMany).toHaveBeenCalledWith({
      where: { businessId: 1 },
      orderBy: { sortOrder: 'asc' },
    });
  });

  test('createPaymentTerm rejects a blank name', async () => {
    const { statusCode, body } = await run(ctrl.createPaymentTerm, { body: { name: '  ', days: 30 } });
    expect(statusCode).toBe(400);
    expect(body.error).toMatch(/name/i);
    expect(prisma.paymentTerm.create).not.toHaveBeenCalled();
  });

  test('createPaymentTerm rejects negative days', async () => {
    const { statusCode, body } = await run(ctrl.createPaymentTerm, { body: { name: 'Net 30', days: -5 } });
    expect(statusCode).toBe(400);
    expect(body.error).toMatch(/days/i);
    expect(prisma.paymentTerm.create).not.toHaveBeenCalled();
  });

  test('createPaymentTerm with isDefault clears isDefault on every other term first', async () => {
    prisma.paymentTerm.create.mockResolvedValue({ id: 2, name: 'Net 45', days: 45, isDefault: true });
    const { statusCode } = await run(ctrl.createPaymentTerm, { body: { name: 'Net 45', days: 45, isDefault: true } });
    expect(statusCode).toBe(201);
    expect(prisma.paymentTerm.updateMany).toHaveBeenCalledWith({
      where: { businessId: 1, isDefault: true },
      data: { isDefault: false },
    });
    expect(prisma.paymentTerm.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ businessId: 1, name: 'Net 45', days: 45, isDefault: true }),
    }));
  });

  test('createPaymentTerm surfaces a duplicate-name error as 400', async () => {
    prisma.paymentTerm.create.mockRejectedValue({ code: 'P2002' });
    const { statusCode, body } = await run(ctrl.createPaymentTerm, { body: { name: 'Net 30', days: 30 } });
    expect(statusCode).toBe(400);
    expect(body.error).toMatch(/already exists/i);
  });

  test('updatePaymentTerm with isDefault:true clears every other term first', async () => {
    prisma.paymentTerm.update.mockResolvedValue({ id: 3, isDefault: true });
    const { statusCode } = await run(ctrl.updatePaymentTerm, { params: { id: '3' }, body: { isDefault: true } });
    expect(statusCode).toBe(200);
    expect(prisma.paymentTerm.updateMany).toHaveBeenCalledWith({
      where: { businessId: 1, isDefault: true },
      data: { isDefault: false },
    });
    expect(prisma.paymentTerm.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { isDefault: true },
    });
  });

  test('updatePaymentTerm without isDefault only updates the given fields', async () => {
    prisma.paymentTerm.update.mockResolvedValue({ id: 3, isActive: false });
    await run(ctrl.updatePaymentTerm, { params: { id: '3' }, body: { isActive: false } });
    expect(prisma.paymentTerm.updateMany).not.toHaveBeenCalled();
    expect(prisma.paymentTerm.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { isActive: false },
    });
  });

  test('deletePaymentTerm deletes by id regardless of past usage', async () => {
    prisma.paymentTerm.delete.mockResolvedValue({});
    const { statusCode, body } = await run(ctrl.deletePaymentTerm, { params: { id: '7' } });
    expect(statusCode).toBe(200);
    expect(body.message).toMatch(/deleted/i);
    expect(prisma.paymentTerm.delete).toHaveBeenCalledWith({ where: { id: 7 } });
  });
});
