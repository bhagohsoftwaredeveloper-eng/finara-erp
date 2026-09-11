const crypto = require('crypto');

jest.mock('../server/config/database', () => ({
  business:     { findUnique: jest.fn(), update: jest.fn() },
  user:         { findUnique: jest.fn() },
  licenseEvent: { create: jest.fn() },
  $transaction: jest.fn((ops) => Promise.all(ops)),
}));
jest.mock('../server/utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
jest.mock('../server/utils/mailer', () => ({ sendLicenseActivatedNotice: jest.fn().mockResolvedValue(true) }));

const prisma = require('../server/config/database');
const mailer = require('../server/utils/mailer');
const ctrl = require('../server/controllers/webhookController');

const WEBHOOK_SECRET = 'whsec_test123';
process.env.PAYMONGO_WEBHOOK_SECRET = WEBHOOK_SECRET;

function signedRequest(payload) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const t = '1700000000';
  const te = crypto.createHmac('sha256', WEBHOOK_SECRET).update(`${t}.`).update(rawBody).digest('hex');
  return { headers: { 'paymongo-signature': `t=${t},te=${te},li=` }, body: rawBody };
}

function linkPaymentPaidPayload({ businessId, amount = 1500000 }) {
  return {
    data: {
      id: 'evt_1', type: 'event',
      attributes: {
        type: 'link.payment.paid',
        data: {
          id: 'pay_1', type: 'payment',
          attributes: { amount, currency: 'PHP', status: 'paid', origin: 'links', metadata: { businessId: String(businessId) } },
        },
      },
    },
  };
}

const run = (req) => new Promise((resolve) => {
  const res = { statusCode: null, sendStatus(code) { this.statusCode = code; resolve(this); } };
  ctrl.paymongo(req, res);
});

beforeEach(() => jest.clearAllMocks());

describe('webhookController.paymongo', () => {
  test('rejects an invalid signature with 401 and makes no DB writes', async () => {
    const req = { headers: { 'paymongo-signature': 't=123,te=bogus,li=' }, body: Buffer.from('{}') };
    const res = await run(req);
    expect(res.statusCode).toBe(401);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });

  test('activates a PENDING business on a valid link.payment.paid event', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING', createdByUserId: 7 });
    prisma.user.findUnique.mockResolvedValue({ id: 7, email: 'juan@finara.ph' });

    const req = signedRequest(linkPaymentPaidPayload({ businessId: 3 }));
    const res = await run(req);

    expect(res.statusCode).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();
    const ops = prisma.$transaction.mock.calls[0][0];
    expect(ops).toHaveLength(3);
    expect(mailer.sendLicenseActivatedNotice).toHaveBeenCalledWith(
      { id: 3, name: 'NCC', licenseStatus: 'PENDING', createdByUserId: 7 },
      { id: 7, email: 'juan@finara.ph' },
    );
  });

  test('is a no-op (200, no writes) when the business is already ACTIVE', async () => {
    prisma.business.findUnique.mockResolvedValue({ id: 3, licenseStatus: 'ACTIVE' });
    const req = signedRequest(linkPaymentPaidPayload({ businessId: 3 }));
    const res = await run(req);
    expect(res.statusCode).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('is a no-op (200) when the businessId in metadata does not match any business', async () => {
    prisma.business.findUnique.mockResolvedValue(null);
    const req = signedRequest(linkPaymentPaidPayload({ businessId: 999 }));
    const res = await run(req);
    expect(res.statusCode).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('is a no-op (200) for an unrelated event type', async () => {
    const req = signedRequest({ data: { attributes: { type: 'source.chargeable', data: {} } } });
    const res = await run(req);
    expect(res.statusCode).toBe(200);
    expect(prisma.business.findUnique).not.toHaveBeenCalled();
  });
});
