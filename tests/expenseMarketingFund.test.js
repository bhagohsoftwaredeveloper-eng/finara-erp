jest.mock('../server/config/database', () => ({
  expenseVoucher: { findUnique: jest.fn(), update: jest.fn() },
  cashRequest: { findFirst: jest.fn() },
  systemSetting: { findUnique: jest.fn() },
  account: { findFirst: jest.fn() },
  $transaction: jest.fn(),
}));
jest.mock('../server/utils/glPost', () => ({ safePost: jest.fn() }));
jest.mock('../server/utils/audit', () => ({ recordAudit: jest.fn(), diff: jest.fn() }));
jest.mock('../server/utils/cashDenomination', () => ({
  resolveCount: jest.fn().mockResolvedValue(null), saveCount: jest.fn(),
}));

const prisma = require('../server/config/database');
const glPost = require('../server/utils/glPost');
const ctrl = require('../server/controllers/expenseController');

const run = (fn, req) => new Promise((resolve, reject) => {
  fn({ businessId: 1, params: {}, query: {}, user: { id: 1 }, body: {}, ...req }, { json: resolve, status: () => ({ json: resolve }) }, reject);
});

const voucher = (over = {}) => ({
  id: 9, businessId: 1, voucherNo: 'EV-000009', type: 'DIRECT_PAYMENT', status: 'APPROVED', category: 'ADVERTISING',
  payee: 'Print shop', purpose: 'Flyers', totalAmount: 2000, cashRequestId: null,
  items: [{ description: 'Flyers', accountId: 60, amount: 2000 }], ...over,
});

const settings = (marketing) => ({ value: JSON.stringify({ marketing }) });
const on = { enabled: true, categories: ['ADVERTISING'], accountCode: '1013' };

const paid = async (body = {}) => {
  await run(ctrl.pay, { params: { id: '9' }, body: { paidDate: '2026-10-02', ...body } });
  const lines = glPost.safePost.mock.calls[0][0].lines;
  return { cash: lines[lines.length - 1], stored: prisma.expenseVoucher.update.mock.calls[0][0].data.paymentAccountCode };
};

beforeEach(() => {
  jest.clearAllMocks();
  prisma.$transaction.mockImplementation(async (fn) => fn(prisma));
  prisma.expenseVoucher.findUnique.mockResolvedValue(voucher());
  prisma.expenseVoucher.update.mockResolvedValue({ id: 9 });
  prisma.systemSetting.findUnique.mockResolvedValue(settings(on));
  prisma.account.findFirst.mockResolvedValue({ id: 70, accountCode: '1013' });
});

describe('marketing expenses are paid from the Marketing Fund', () => {
  test('a marketing-category voucher credits the fund account instead of cash', async () => {
    const { cash, stored } = await paid();

    expect(cash).toMatchObject({ accountCode: '1013', credit: 2000 });
    expect(stored).toBe('1013');
    expect(prisma.account.findFirst).toHaveBeenCalledWith({ where: { businessId: 1, accountCode: '1013' } });
  });

  test('an account the user picked explicitly wins', async () => {
    const { cash } = await paid({ paymentAccountCode: '1020' });

    expect(cash).toMatchObject({ accountCode: '1020' });
  });

  test('other categories keep paying from cash as before', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue(voucher({ category: 'MEALS' }));

    expect((await paid()).cash).toMatchObject({ accountCode: '1020' });
  });

  test('petty cash vouchers outside the marketing categories still default to petty cash', async () => {
    prisma.expenseVoucher.findUnique.mockResolvedValue(voucher({ type: 'PETTY_CASH', category: 'MEALS' }));

    expect((await paid()).cash).toMatchObject({ accountCode: '1011' });
  });

  test('when the fund is switched off nothing changes', async () => {
    prisma.systemSetting.findUnique.mockResolvedValue(settings({ ...on, enabled: false }));

    expect((await paid()).cash).toMatchObject({ accountCode: '1020' });
  });

  test('when the fund account is not in the chart the voucher falls back to cash, so the entry still posts', async () => {
    prisma.account.findFirst.mockResolvedValue(null);

    expect((await paid()).cash).toMatchObject({ accountCode: '1020' });
  });

  test('a problem reading the settings never stops a payment', async () => {
    prisma.systemSetting.findUnique.mockRejectedValue(new Error('db'));

    expect((await paid()).cash).toMatchObject({ accountCode: '1020' });
  });
});
