jest.mock('../server/config/database', () => ({
  customer: { create: jest.fn(), findMany: jest.fn(), update: jest.fn() },
  paymentTerm: { findFirst: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/receivableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, user: { id: 1 }, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

describe('customer default payment term', () => {
  test('createCustomer saves a default term of this business', async () => {
    prisma.paymentTerm.findFirst.mockResolvedValue({ id: 3 });
    prisma.customer.create.mockResolvedValue({ id: 1 });

    await run(ctrl.createCustomer, { body: { customerCode: 'CUS-100', name: 'ACME', defaultTermId: '3' } });

    expect(prisma.paymentTerm.findFirst).toHaveBeenCalledWith({ where: { id: 3, businessId: 1 } });
    expect(prisma.customer.create).toHaveBeenCalledWith({ data: expect.objectContaining({ defaultTermId: 3 }) });
  });

  test("createCustomer rejects another business's term and creates nothing", async () => {
    prisma.paymentTerm.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.createCustomer, { body: { customerCode: 'CUS-100', name: 'ACME', defaultTermId: 99 } }))
      .rejects.toThrow('Payment term not found');
    expect(prisma.customer.create).not.toHaveBeenCalled();
  });

  test('createCustomer without a term leaves defaultTermId out', async () => {
    prisma.customer.create.mockResolvedValue({ id: 1 });

    await run(ctrl.createCustomer, { body: { customerCode: 'CUS-100', name: 'ACME' } });

    expect(prisma.customer.create.mock.calls[0][0].data).not.toHaveProperty('defaultTermId');
  });

  test('updateCustomer can set, and clear, the default term', async () => {
    prisma.customer.update.mockResolvedValue({ id: 1 });
    prisma.paymentTerm.findFirst.mockResolvedValue({ id: 4 });

    await run(ctrl.updateCustomer, { params: { id: '1' }, body: { name: 'ACME', defaultTermId: 4 } });
    expect(prisma.customer.update.mock.calls[0][0].data).toMatchObject({ defaultTermId: 4 });

    await run(ctrl.updateCustomer, { params: { id: '1' }, body: { name: 'ACME', defaultTermId: null } });
    expect(prisma.customer.update.mock.calls[1][0].data).toMatchObject({ defaultTermId: null });
  });

  test('updateCustomer leaves the term alone when the field is not sent', async () => {
    prisma.customer.update.mockResolvedValue({ id: 1 });

    await run(ctrl.updateCustomer, { params: { id: '1' }, body: { name: 'ACME' } });

    expect(prisma.customer.update.mock.calls[0][0].data).not.toHaveProperty('defaultTermId');
  });
});
