jest.mock('../server/config/database', () => ({
  journalEntry: { findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn() },
  journalLine: { deleteMany: jest.fn(), createMany: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/journalController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, user: { id: 1 }, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const lines = [
  { accountId: 10, debit: 800, driverId: 3, vehicleId: '7', description: 'Repair' },
  { accountId: 20, credit: 800 },
];

beforeEach(() => {
  jest.clearAllMocks();
  prisma.journalEntry.findFirst.mockResolvedValue(null);
  prisma.journalEntry.create.mockResolvedValue({ id: 1, entryNo: 'JE-1-000001', lines: [] });
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
});

describe('tags on manual journal lines', () => {
  test('create stores the tags on the lines that have them only', async () => {
    await run(ctrl.create, { body: { entryDate: '2026-10-01', description: 'Adjust', lines } });

    const created = prisma.journalEntry.create.mock.calls[0][0].data.lines.create;
    expect(created[0]).toMatchObject({ accountId: 10, debit: 800, driverId: 3, vehicleId: 7 });
    expect(Object.keys(created[1]).sort()).toEqual(['accountId', 'credit', 'debit', 'description', 'lineOrder']);
  });

  test('update keeps the tags when it rewrites the lines of a draft', async () => {
    prisma.journalEntry.findUnique.mockResolvedValue({ id: 4, entryNo: 'JE-1-000004', status: 'DRAFT' });
    prisma.journalEntry.update.mockResolvedValue({ id: 4, lines: [] });

    await run(ctrl.update, { params: { id: '4' }, body: { lines } });

    const rows = prisma.journalLine.createMany.mock.calls[0][0].data;
    expect(rows[0]).toMatchObject({ entryId: 4, driverId: 3, vehicleId: 7 });
    expect(rows[1]).not.toHaveProperty('driverId');
  });
});
