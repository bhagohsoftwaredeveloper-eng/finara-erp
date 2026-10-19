const crypto = require('crypto');

jest.mock('../server/config/database', () => {
  const mockPrisma = {
    business:     { findFirst: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
    user:         { findUnique: jest.fn() },
    licenseEvent: { create: jest.fn() },
  };
  // Support both the interactive form ($transaction(async (tx) => …), used by the
  // webhook controller) and the legacy array form used elsewhere.
  mockPrisma.$transaction = jest.fn((fnOrArray) =>
    typeof fnOrArray === 'function' ? fnOrArray(mockPrisma) : Promise.all(fnOrArray)
  );
  return mockPrisma;
});
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

// Mirrors PayMongo's real link.payment.paid shape (verified live against the
// sandbox API): `data` is the Link resource, not the payment, and neither the
// link nor its nested payment carries our request-time metadata — only an
// auto-generated pm_reference_number. The link `id` is the only reliable way
// back to the business (matched against Business.paymentLinkId).
function linkPaymentPaidPayload({ linkId, amount = 1500000, paymentId = 'pay_1' }) {
  return {
    data: {
      id: 'evt_1', type: 'event',
      attributes: {
        type: 'link.payment.paid',
        data: {
          id: linkId, type: 'link',
          attributes: {
            amount, currency: 'PHP', status: 'paid',
            payments: [{ data: { id: paymentId, type: 'payment', attributes: { amount, status: 'paid', origin: 'links', metadata: { pm_reference_number: 'WhGO70c' } } } }],
          },
        },
      },
    },
  };
}

// Rejects (rather than hanging) if the controller throws synchronously or its
// promise rejects — a crash regression must fail the test, not time it out.
const run = (req) => new Promise((resolve, reject) => {
  const res = { statusCode: null, sendStatus(code) { this.statusCode = code; resolve(this); } };
  Promise.resolve(ctrl.paymongo(req, res)).catch(reject);
});

beforeEach(() => {
  jest.clearAllMocks();
  prisma.business.updateMany.mockResolvedValue({ count: 1 });
  prisma.licenseEvent.create.mockResolvedValue({});
});

describe('webhookController.paymongo', () => {
  test('rejects an invalid signature with 401 and makes no DB writes', async () => {
    const req = { headers: { 'paymongo-signature': 't=123,te=bogus,li=' }, body: Buffer.from('{}') };
    const res = await run(req);
    expect(res.statusCode).toBe(401);
    expect(prisma.business.findFirst).not.toHaveBeenCalled();
  });

  test('activates a PENDING business on checkout_session.payment.paid, matched by session id', async () => {
    prisma.business.findFirst.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING', createdByUserId: 7, paymentLinkId: 'cs_abc' });
    prisma.user.findUnique.mockResolvedValue({ id: 7, email: 'juan@finara.ph' });

    // A checkout session lists the payment itself (a link wraps it in {data}).
    const payload = {
      data: { id: 'evt_2', type: 'event', attributes: { type: 'checkout_session.payment.paid', data: {
        id: 'cs_abc', type: 'checkout_session',
        attributes: { payments: [{ id: 'pay_9', type: 'payment', attributes: { amount: 500, status: 'paid' } }] },
      } } },
    };
    const res = await run(signedRequest(payload));

    expect(prisma.business.findFirst).toHaveBeenCalledWith({ where: { paymentLinkId: 'cs_abc' } });
    expect(res.statusCode).toBe(200);
    expect(prisma.licenseEvent.create).toHaveBeenNthCalledWith(1, {
      data: { businessId: 3, eventType: 'PAYMENT_RECEIVED', amount: 5, note: 'PayMongo payment pay_9', actorUserId: null },
    });
  });

  test('activates a PENDING business on a valid link.payment.paid event, matched by payment link id', async () => {
    prisma.business.findFirst.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING', createdByUserId: 7, paymentLinkId: 'link_abc' });
    prisma.user.findUnique.mockResolvedValue({ id: 7, email: 'juan@finara.ph' });

    const req = signedRequest(linkPaymentPaidPayload({ linkId: 'link_abc' }));
    const res = await run(req);

    expect(prisma.business.findFirst).toHaveBeenCalledWith({ where: { paymentLinkId: 'link_abc' } });
    expect(res.statusCode).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.business.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 3, licenseStatus: { not: 'ACTIVE' } },
      data: expect.objectContaining({ licenseStatus: 'ACTIVE', licenseActivatedBy: null }),
    }));
    expect(prisma.licenseEvent.create).toHaveBeenCalledTimes(2);
    expect(prisma.licenseEvent.create).toHaveBeenNthCalledWith(1, {
      data: { businessId: 3, eventType: 'PAYMENT_RECEIVED', amount: 15000, note: 'PayMongo payment pay_1', actorUserId: null },
    });
    expect(prisma.licenseEvent.create).toHaveBeenNthCalledWith(2, {
      data: { businessId: 3, eventType: 'ACTIVATED', actorUserId: null },
    });
    expect(mailer.sendLicenseActivatedNotice).toHaveBeenCalledWith(
      { id: 3, name: 'NCC', licenseStatus: 'ACTIVE', createdByUserId: 7, paymentLinkId: 'link_abc' },
      { id: 7, email: 'juan@finara.ph' },
    );
  });

  test('logs REACTIVATED (not ACTIVATED) when the business was SUSPENDED', async () => {
    prisma.business.findFirst.mockResolvedValue({ id: 4, name: 'NCC', licenseStatus: 'SUSPENDED', createdByUserId: null, paymentLinkId: 'link_xyz' });

    const res = await run(signedRequest(linkPaymentPaidPayload({ linkId: 'link_xyz' })));

    expect(res.statusCode).toBe(200);
    expect(prisma.licenseEvent.create).toHaveBeenNthCalledWith(2, {
      data: { businessId: 4, eventType: 'REACTIVATED', actorUserId: null },
    });
  });

  test('returns 401 without throwing when req.body is a plain object, not a Buffer', async () => {
    // express.raw() hands the controller {} for a body-less or wrong-content-type request.
    const req = { headers: { 'paymongo-signature': 't=123,te=bogus,li=' }, body: {} };
    const res = await run(req);
    expect(res.statusCode).toBe(401);
    expect(prisma.business.findFirst).not.toHaveBeenCalled();
  });

  test('is idempotent — a redelivered event writes no second set of license events', async () => {
    prisma.business.findFirst.mockResolvedValue({ id: 3, name: 'NCC', licenseStatus: 'PENDING', createdByUserId: null, paymentLinkId: 'link_abc' });
    prisma.business.updateMany
      .mockResolvedValueOnce({ count: 1 })   // first delivery wins the race
      .mockResolvedValueOnce({ count: 0 });  // retry finds it already ACTIVE

    const first = await run(signedRequest(linkPaymentPaidPayload({ linkId: 'link_abc' })));
    expect(first.statusCode).toBe(200);
    expect(prisma.licenseEvent.create).toHaveBeenCalledTimes(2);

    const second = await run(signedRequest(linkPaymentPaidPayload({ linkId: 'link_abc' })));
    expect(second.statusCode).toBe(200);
    expect(prisma.licenseEvent.create).toHaveBeenCalledTimes(2); // unchanged
    expect(mailer.sendLicenseActivatedNotice).toHaveBeenCalledTimes(1);
  });

  test('is a no-op (200, no writes) when the business is already ACTIVE', async () => {
    prisma.business.findFirst.mockResolvedValue({ id: 3, licenseStatus: 'ACTIVE', paymentLinkId: 'link_abc' });
    const req = signedRequest(linkPaymentPaidPayload({ linkId: 'link_abc' }));
    const res = await run(req);
    expect(res.statusCode).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('is a no-op (200) when the link id does not match any business', async () => {
    prisma.business.findFirst.mockResolvedValue(null);
    const req = signedRequest(linkPaymentPaidPayload({ linkId: 'link_unknown' }));
    const res = await run(req);
    expect(res.statusCode).toBe(200);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  test('is a no-op (200) for an unrelated event type', async () => {
    const req = signedRequest({ data: { attributes: { type: 'source.chargeable', data: {} } } });
    const res = await run(req);
    expect(res.statusCode).toBe(200);
    expect(prisma.business.findFirst).not.toHaveBeenCalled();
  });

  test('is a no-op (200) for a standalone payment.paid event (no reliable link id to correlate on)', async () => {
    const req = signedRequest({
      data: { attributes: { type: 'payment.paid', data: { id: 'pay_1', type: 'payment', attributes: { origin: 'links', metadata: { pm_reference_number: 'WhGO70c' } } } } },
    });
    const res = await run(req);
    expect(res.statusCode).toBe(200);
    expect(prisma.business.findFirst).not.toHaveBeenCalled();
  });
});
