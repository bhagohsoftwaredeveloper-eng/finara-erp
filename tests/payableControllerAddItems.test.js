jest.mock('../server/config/database', () => ({
  bill: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => jest.clearAllMocks());

const baseBill = {
  id: 7, businessId: 1, billNo: 'BILL-000007', status: 'OPEN', paidAmount: 0, totalAmount: 5000,
  vendor: { name: 'Triplekenn Supply' },
};

describe('addBillItems', () => {
  test('rejects adding items to a bill owned by a different business', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, businessId: 2 });

    await expect(run(ctrl.addBillItems, {
      params: { id: '7' },
      body: { editDate: '2026-08-28', lines: [{ accountId: 1, description: 'Extra item', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' }] },
    })).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('rejects adding items to a fully paid bill', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, status: 'PAID' });

    await expect(run(ctrl.addBillItems, {
      params: { id: '7' },
      body: { editDate: '2026-08-28', lines: [{ accountId: 1, description: 'Extra item', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' }] },
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('rejects adding items to a voided bill', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, status: 'VOID' });

    await expect(run(ctrl.addBillItems, {
      params: { id: '7' },
      body: { editDate: '2026-08-28', lines: [{ accountId: 1, description: 'Extra item', quantity: 1, unitPrice: 100, vatCode: 'EXEMPT' }] },
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('increments bill totals, sets lastEditedAt, and posts an incremental GL entry', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, status: 'PARTIAL' });
    prisma.bill.update.mockResolvedValue({ ...baseBill, status: 'PARTIAL', totalAmount: 5560 });
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.addBillItems, {
      params: { id: '7' },
      body: {
        editDate: '2026-08-28',
        lines: [{ accountId: 3, description: 'Extra item', quantity: 2, unitPrice: 250, vatCode: 'VAT' }],
      },
    });

    expect(prisma.bill.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 7 },
      data: expect.objectContaining({
        subtotal:    { increment: 500 },
        vatAmount:   { increment: 60 },
        totalAmount: { increment: 560 },
        lastEditedAt: new Date('2026-08-28'),
        lines: { create: [expect.objectContaining({ accountId: 3, description: 'Extra item', quantity: 2, unitPrice: 250, amount: 500, vatCode: 'VAT' })] },
      }),
    }));

    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      entryDate: '2026-08-28',
      reference: 'BILL-000007',
      lines: [
        { accountId: 3, debit: 500, description: 'Extra item' },
        { accountCode: '1330', debit: 60, description: 'Input VAT' },
        { accountCode: '2010', credit: 560, description: 'AP — Triplekenn Supply (BILL-000007) — item added' },
      ],
    }));
  });

  test('VAT-exempt items post no Input VAT line', async () => {
    prisma.bill.findUnique.mockResolvedValue({ ...baseBill, status: 'OPEN' });
    prisma.bill.update.mockResolvedValue({ ...baseBill });
    glPost.safePost.mockResolvedValue({ id: 100 });

    await run(ctrl.addBillItems, {
      params: { id: '7' },
      body: {
        editDate: '2026-08-28',
        lines: [{ accountId: 5, description: 'Exempt item', quantity: 1, unitPrice: 200, vatCode: 'EXEMPT' }],
      },
    });

    expect(glPost.safePost).toHaveBeenCalledWith(expect.objectContaining({
      lines: [
        { accountId: 5, debit: 200, description: 'Exempt item' },
        { accountCode: '2010', credit: 200, description: 'AP — Triplekenn Supply (BILL-000007) — item added' },
      ],
    }));
  });
});
