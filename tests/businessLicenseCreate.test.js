jest.mock('../server/config/database', () => ({
  business:     { create: jest.fn() },
  user:         { findMany: jest.fn() },
  userBusiness: { createMany: jest.fn() },
  licenseEvent: { create: jest.fn() },
}));
jest.mock('../server/utils/glPost', () => ({ clearBusinessCache: jest.fn() }));
jest.mock('../server/utils/cloneChartOfAccounts', () => ({ cloneChartOfAccounts: jest.fn().mockResolvedValue() }));
jest.mock('../prisma/seedDemo', () => ({ resetDemoBusiness: jest.fn() }));
jest.mock('../server/utils/mailer', () => ({ sendLicensePendingNotice: jest.fn().mockResolvedValue(true) }));

const prisma = require('../server/config/database');
const mailer = require('../server/utils/mailer');
const ctrl   = require('../server/controllers/businessController');

const run = (user, body) => new Promise((resolve, reject) => {
  ctrl.create({ user, body }, { status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.user.findMany.mockImplementation(({ where }) =>
    where.role === 'ADMIN'
      ? Promise.resolve([{ id: 1 }])
      : Promise.resolve([{ id: 9, email: 'super1@finara.ph' }, { id: 10, email: 'super2@finara.ph' }]));
});

describe('businessController.create license wiring', () => {
  test('creates the business as PENDING with the requesting user recorded', async () => {
    prisma.business.create.mockResolvedValue({ id: 3, name: 'New Client Co.', code: 'NCC' });

    await run({ id: 7, name: 'Juan Dela Cruz', email: 'juan@finara.ph' }, { code: 'ncc', name: 'New Client Co.' });

    expect(prisma.business.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ licenseStatus: 'PENDING', createdByUserId: 7 }),
    }));
  });

  test('logs a CREATED license event', async () => {
    prisma.business.create.mockResolvedValue({ id: 3, name: 'New Client Co.', code: 'NCC' });

    await run({ id: 7, name: 'Juan Dela Cruz' }, { code: 'ncc', name: 'New Client Co.' });

    expect(prisma.licenseEvent.create).toHaveBeenCalledWith({
      data: { businessId: 3, eventType: 'CREATED', actorUserId: 7 },
    });
  });

  test('notifies every SUPER_ADMIN', async () => {
    prisma.business.create.mockResolvedValue({ id: 3, name: 'New Client Co.', code: 'NCC' });
    const requester = { id: 7, name: 'Juan Dela Cruz' };

    await run(requester, { code: 'ncc', name: 'New Client Co.' });

    expect(mailer.sendLicensePendingNotice).toHaveBeenCalledWith(
      { id: 3, name: 'New Client Co.', code: 'NCC' },
      requester,
      ['super1@finara.ph', 'super2@finara.ph'],
    );
  });
});
