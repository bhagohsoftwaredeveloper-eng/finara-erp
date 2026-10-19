jest.mock('../server/config/database', () => ({
  account: { updateMany: jest.fn() },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/accountsController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.account.updateMany.mockResolvedValue({ count: 3 });
});

describe('setActive', () => {
  test('switches the listed accounts of this business on or off in one go', async () => {
    const r = await run(ctrl.setActive, { body: { ids: [5, '6', 7], isActive: false } });

    expect(prisma.account.updateMany).toHaveBeenCalledWith({
      where: { businessId: 1, id: { in: [5, 6, 7] } },
      data: { isActive: false },
    });
    expect(r).toEqual({ updated: 3 });
  });

  test('turning accounts back on works the same way', async () => {
    await run(ctrl.setActive, { body: { ids: [5], isActive: true } });

    expect(prisma.account.updateMany.mock.calls[0][0].data).toEqual({ isActive: true });
  });

  test('needs a list of account ids and a true/false value', async () => {
    await expect(run(ctrl.setActive, { body: { ids: [], isActive: true } })).rejects.toThrow('ids');
    await expect(run(ctrl.setActive, { body: { ids: 'x', isActive: true } })).rejects.toThrow('ids');
    await expect(run(ctrl.setActive, { body: { ids: ['a'], isActive: true } })).rejects.toThrow('ids');
    await expect(run(ctrl.setActive, { body: { ids: [5] } })).rejects.toThrow('isActive');
    expect(prisma.account.updateMany).not.toHaveBeenCalled();
  });

  test('caps how many accounts one call can change', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => i + 1);

    await expect(run(ctrl.setActive, { body: { ids, isActive: false } })).rejects.toThrow('ids');
  });
});
