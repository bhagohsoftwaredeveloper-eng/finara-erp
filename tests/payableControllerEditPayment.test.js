jest.mock('../server/config/database', () => ({
  bill: {
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  paymentAP: {
    update: jest.fn(),
  },
  journalEntry: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn() }));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const { recordAudit } = require('../server/utils/audit');
const ctrl = require('../server/controllers/payableController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation((ops) => Promise.all(ops));
});

const basePayment = {
  id: 55, billId: 7, paymentNo: 'PAP-000055', paymentDate: new Date('2026-08-01'),
  amount: 1120, paymentMethod: 'Cash', reference: null, notes: null,
};

const baseBill = {
  id: 7, businessId: 1, billNo: 'BILL-000007', status: 'PAID',
  paidAmount: 1120, totalAmount: 1120,
  vendor: { name: 'Triplekenn Supply' },
  payments: [basePayment],
};

const editBody = { paymentDate: '2026-08-02', amount: 200, paymentMethod: 'Bank Transfer', reference: 'REF-1', notes: 'Corrected' };

describe('editPayment — eligibility', () => {
  test('404s when the bill does not exist (or belongs to another business)', async () => {
    prisma.bill.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('only looks up the bill scoped to the current business', async () => {
    prisma.bill.findFirst.mockResolvedValue(null);

    await expect(run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody })).rejects.toBeDefined();

    expect(prisma.bill.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 7, businessId: 1 }) })
    );
  });

  test('404s when the paymentId does not belong to this bill', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, payments: [{ ...basePayment, id: 999 }] });

    await expect(run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('rejects editing a payment on a VOID bill', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'VOID' });

    await expect(run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });

  test('allows editing a payment on a PAID bill (the accidental-full-payment scenario)', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID' });
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 200 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody });

    expect(prisma.bill.update).toHaveBeenCalled();
  });

  test('rejects when the corrected amount would exceed the bill total', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID', paidAmount: 1120, totalAmount: 1120 });

    await expect(run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: { ...editBody, amount: 5000 } }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.bill.update).not.toHaveBeenCalled();
  });
});

describe('editPayment — recompute and status transitions', () => {
  test('drops a PAID bill back to PARTIAL when the corrected amount undershoots the total', async () => {
    // Single payment on the bill, corrected down from 1120 to 200 — remaining 920 > 0.01, so PARTIAL.
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID', paidAmount: 1120, totalAmount: 1120 });
    let billUpdateArgs;
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 200 });
    prisma.bill.update.mockImplementation((args) => {
      billUpdateArgs = args;
      return Promise.resolve({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: { ...editBody, amount: 200 } });

    expect(billUpdateArgs.data.paidAmount).toBeCloseTo(200, 2);
    expect(billUpdateArgs.data.status).toBe('PARTIAL');
  });

  test('recomputes to OPEN when the corrected amount is effectively removed (rounds to 0)', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID', paidAmount: 1120, totalAmount: 1120 });
    let billUpdateArgs;
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 0.01 });
    prisma.bill.update.mockImplementation((args) => {
      billUpdateArgs = args;
      return Promise.resolve({ ...baseBill, paidAmount: 0.01, status: 'OPEN' });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: { ...editBody, amount: 0.01 } });

    expect(billUpdateArgs.data.status).toBe('OPEN');
  });

  test('recomputes to PAID when a second payment plus the corrected amount exactly covers the total', async () => {
    const secondPayment = { id: 56, billId: 7, paymentNo: 'PAP-000056', paymentDate: new Date('2026-08-05'), amount: 400, paymentMethod: 'Cash', reference: null, notes: null };
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PARTIAL', paidAmount: 600, totalAmount: 1120, payments: [{ ...basePayment, amount: 200 }, secondPayment] });
    let billUpdateArgs;
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 720 });
    prisma.bill.update.mockImplementation((args) => {
      billUpdateArgs = args;
      return Promise.resolve({ ...baseBill, paidAmount: 1120, status: 'PAID' });
    });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    // otherPaid = 600 - 200 = 400 (the untouched second payment); newPaid = 400 + 720 = 1120 = totalAmount
    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: { ...editBody, amount: 720 } });

    expect(billUpdateArgs.data.paidAmount).toBeCloseTo(1120, 2);
    expect(billUpdateArgs.data.status).toBe('PAID');
  });
});

describe('editPayment — writes', () => {
  test('updates the PaymentAP row with all editable fields', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID' });
    let paymentUpdateArgs;
    prisma.paymentAP.update.mockImplementation((args) => {
      paymentUpdateArgs = args;
      return Promise.resolve({ ...basePayment, ...args.data });
    });
    prisma.bill.update.mockResolvedValue({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody });

    expect(paymentUpdateArgs.where).toEqual({ id: 55 });
    expect(paymentUpdateArgs.data).toMatchObject({
      amount: 200, paymentMethod: 'Bank Transfer', reference: 'REF-1', notes: 'Corrected',
    });
    expect(paymentUpdateArgs.data.paymentDate).toEqual(new Date('2026-08-02'));
  });
});

describe('editPayment — GL correction', () => {
  test('voids prior POSTED entries keyed on the payment\'s own paymentNo (not the bill\'s billNo) and posts one fresh entry', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID' });
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 200 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    prisma.journalEntry.findMany.mockResolvedValue([{ id: 200, entryNo: 'JE-1-000200' }]);
    prisma.journalEntry.update.mockResolvedValue({});
    glPost.safePost.mockResolvedValue({ id: 99 });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody });

    expect(prisma.journalEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ businessId: 1, reference: 'PAP-000055', status: 'POSTED' }) })
    );
    expect(prisma.journalEntry.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 200 }, data: { status: 'VOIDED' } }));

    expect(glPost.safePost).toHaveBeenCalledTimes(1);
    const call = glPost.safePost.mock.calls[0][0];
    expect(call.reference).toBe('PAP-000055');
    const apLine = call.lines.find((l) => l.accountCode === '2010');
    expect(apLine.debit).toBeCloseTo(200, 2);
    const cashLine = call.lines.find((l) => l.accountCode === '1020');
    expect(cashLine.credit).toBeCloseTo(200, 2);
  });

  test('records a GL_POST_FAILED audit entry when the GL correction is skipped rather than posted', async () => {
    prisma.bill.findFirst.mockResolvedValue({ ...baseBill, status: 'PAID' });
    prisma.paymentAP.update.mockResolvedValue({ ...basePayment, amount: 200 });
    prisma.bill.update.mockResolvedValue({ ...baseBill, paidAmount: 200, status: 'PARTIAL' });
    prisma.journalEntry.findMany.mockResolvedValue([]);
    glPost.safePost.mockResolvedValue({ skipped: 'PRE_CUTOVER' });

    await run(ctrl.editPayment, { params: { id: '7', paymentId: '55' }, body: editBody });

    expect(recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'GL_POST_FAILED',
      entity: 'JournalEntry',
      entityId: 'PAP-000055',
    }));
  });
});
