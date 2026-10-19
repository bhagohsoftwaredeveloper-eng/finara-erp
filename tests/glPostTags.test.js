jest.mock('../server/config/database', () => ({
  business:      { findUnique: jest.fn() },
  account:       { findFirst:  jest.fn() },
  journalEntry:  { findFirst:  jest.fn(), create: jest.fn() },
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const { post, clearBusinessCache } = require('../server/utils/glPost');

beforeEach(() => {
  jest.clearAllMocks();
  clearBusinessCache();
  prisma.business.findUnique.mockResolvedValue({ booksStartDate: null });
  prisma.journalEntry.findFirst.mockResolvedValue(null);
  prisma.journalEntry.create.mockResolvedValue({ id: 1, lines: [] });
});

const createdLines = () => prisma.journalEntry.create.mock.calls[0][0].data.lines.create;

describe('glPost cost tags', () => {
  test('a line carrying a driver and a vehicle stores both', async () => {
    await post({
      entryDate: '2026-10-01', description: 'Repairs', businessId: 1,
      lines: [
        { accountId: 10, debit: 500, driverId: 3, vehicleId: '7' },
        { accountId: 20, credit: 500 },
      ],
    });

    const [dr, cr] = createdLines();
    expect(dr).toMatchObject({ accountId: 10, debit: 500, driverId: 3, vehicleId: 7 });
    expect(cr).not.toHaveProperty('driverId');
    expect(cr).not.toHaveProperty('vehicleId');
  });

  test('only one of the two tags can be set', async () => {
    await post({
      entryDate: '2026-10-01', description: 'Repairs', businessId: 1,
      lines: [{ accountId: 10, debit: 100, vehicleId: 7 }, { accountId: 20, credit: 100 }],
    });

    const [dr] = createdLines();
    expect(dr).toMatchObject({ vehicleId: 7 });
    expect(dr).not.toHaveProperty('driverId');
  });

  test('untagged lines look exactly as they did before tags existed', async () => {
    await post({
      entryDate: '2026-10-01', description: 'Plain', businessId: 1,
      lines: [{ accountId: 10, debit: 100 }, { accountId: 20, credit: 100 }],
    });

    for (const line of createdLines()) {
      expect(Object.keys(line).sort()).toEqual(['accountId', 'credit', 'debit', 'description', 'lineOrder']);
    }
  });
});
