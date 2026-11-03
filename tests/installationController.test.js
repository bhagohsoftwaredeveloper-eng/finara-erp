jest.mock('../server/config/database', () => ({
  business: { findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  licenseEvent: { create: jest.fn() },
}));
jest.mock('../server/utils/licenseSchedule', () => ({ isDue: jest.fn(() => false), applyDueSuspension: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/installationController');

const MID = `${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(32)}`;
const OTHER = `${'1'.repeat(32)}.${'2'.repeat(32)}.${'3'.repeat(32)}`;
const run = (fn, body, key = 'secret') => new Promise((resolve, reject) => {
  fn({ headers: { 'x-api-key': key }, body }, { json: resolve }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  process.env.INSTALL_API_KEY = 'secret';
});

describe('installations — register', () => {
  test('rejects a wrong or missing API key', async () => {
    await expect(run(ctrl.register, { code: 'BIZ-0A7622', name: 'X', machineId: MID }, 'nope')).rejects.toMatchObject({ statusCode: 401 });
    delete process.env.INSTALL_API_KEY;
    await expect(run(ctrl.register, { code: 'BIZ-0A7622', name: 'X', machineId: MID })).rejects.toMatchObject({ statusCode: 503 });
  });

  test('creates a PENDING business carrying the Machine ID', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    prisma.business.create.mockImplementation(({ data }) => Promise.resolve({ id: 9, ...data }));
    const res = await run(ctrl.register, { code: 'biz-0a7622', name: 'Tindang Juan', machineId: MID, email: 'a@b.com' });
    expect(prisma.business.create.mock.calls[0][0].data).toMatchObject({ code: 'BIZ-0A7622', machineId: MID, licenseStatus: 'PENDING', email: 'a@b.com' });
    expect(prisma.licenseEvent.create).toHaveBeenCalled();
    expect(res).toMatchObject({ registered: true, valid: false, reason: 'PENDING' });
  });

  test('is idempotent on the same PC and refuses the same code on another PC', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 9, code: 'BIZ-0A7622', machineId: MID, licenseStatus: 'ACTIVE', paidUntil: null });
    const again = await run(ctrl.register, { code: 'BIZ-0A7622', name: 'X', machineId: MID });
    expect(again).toMatchObject({ valid: true });
    expect(prisma.business.create).not.toHaveBeenCalled();
    await expect(run(ctrl.register, { code: 'BIZ-0A7622', name: 'X', machineId: OTHER })).rejects.toMatchObject({ statusCode: 409 });
  });

  test('rejects a malformed code or Machine ID', async () => {
    await expect(run(ctrl.register, { code: '!', name: 'X', machineId: MID })).rejects.toMatchObject({ statusCode: 400 });
    await expect(run(ctrl.register, { code: 'BIZ-0A7622', name: 'X', machineId: 'abc' })).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('installations — status', () => {
  test('ACTIVE is valid; PENDING and SUSPENDED are not', async () => {
    prisma.business.findUnique.mockResolvedValue({ code: 'BIZ-1', machineId: MID, licenseStatus: 'ACTIVE', paidUntil: null });
    expect(await run(ctrl.status, { code: 'BIZ-1', machineId: MID })).toMatchObject({ valid: true, licenseId: 'BIZ-1' });
    prisma.business.findUnique.mockResolvedValue({ code: 'BIZ-1', machineId: MID, licenseStatus: 'PENDING' });
    expect(await run(ctrl.status, { code: 'BIZ-1', machineId: MID })).toMatchObject({ valid: false, reason: 'PENDING' });
    prisma.business.findUnique.mockResolvedValue({ code: 'BIZ-1', machineId: MID, licenseStatus: 'SUSPENDED' });
    expect(await run(ctrl.status, { code: 'BIZ-1', machineId: MID })).toMatchObject({ valid: false, reason: 'SUSPENDED' });
  });

  test('unknown code is NOT_FOUND and another PC is MACHINE_MISMATCH', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    expect(await run(ctrl.status, { code: 'BIZ-1', machineId: MID })).toMatchObject({ valid: false, reason: 'NOT_FOUND' });
    prisma.business.findUnique.mockResolvedValue({ code: 'BIZ-1', machineId: OTHER, licenseStatus: 'ACTIVE' });
    expect(await run(ctrl.status, { code: 'BIZ-1', machineId: MID })).toMatchObject({ valid: false, reason: 'MACHINE_MISMATCH' });
  });
});
