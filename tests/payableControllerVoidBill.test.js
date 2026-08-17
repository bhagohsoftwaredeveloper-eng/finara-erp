jest.mock('../server/config/database', () => ({
  bill: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  journalEntry: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
}));

const prisma = require('../server/config/database');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

const baseBill = {
  id: 7, businessId: 1, billNo: 'BILL-000007', status: 'OPEN', paidAmount: 0, totalAmount: 5000,
};

describe('voidBill — GL correction', () => {
  test('rejects voiding a bill with payments', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, paidAmount: 1000 });

    await expect(run(ctrl.voidBill, { params: { id: '7' } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('voids the existing POSTED journal entry (scoped to businessId) when voiding a bill', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, status: 'VOID' });
    prisma.journalEntry.findFirst.mockResolvedValue({ id: 88, entryNo: 'JE-1-000088' });
    prisma.journalEntry.update.mockResolvedValue({});

    await run(ctrl.voidBill, { params: { id: '7' } });

    expect(prisma.journalEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 1, reference: 'BILL-000007', status: 'POSTED' }) })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 88 }, data: { status: 'VOIDED' } })
    );
  });

  test('proceeds without voiding anything when no prior POSTED entry is found', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, paidAmount: 0 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, status: 'VOID' });
    prisma.journalEntry.findFirst.mockResolvedValue(null);

    await run(ctrl.voidBill, { params: { id: '7' } });

    expect(prisma.journalEntry.update).not.toHaveBeenCalled();
  });
});
