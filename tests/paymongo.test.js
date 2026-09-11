const crypto = require('crypto');

const OLD_ENV = process.env;
beforeEach(() => {
  jest.resetModules();
  process.env = { ...OLD_ENV };
  global.fetch = jest.fn();
});
afterEach(() => { process.env = OLD_ENV; });

describe('paymongo.isConfigured', () => {
  test('false when PAYMONGO_SECRET_KEY is unset', () => {
    delete process.env.PAYMONGO_SECRET_KEY;
    const paymongo = require('../server/utils/paymongo');
    expect(paymongo.isConfigured()).toBe(false);
  });

  test('true when PAYMONGO_SECRET_KEY is set', () => {
    process.env.PAYMONGO_SECRET_KEY = 'sk_test_abc';
    const paymongo = require('../server/utils/paymongo');
    expect(paymongo.isConfigured()).toBe(true);
  });
});

describe('paymongo.createPaymentLink', () => {
  test('POSTs to /v1/payment_links with Basic auth, centavos amount, and businessId metadata', async () => {
    process.env.PAYMONGO_SECRET_KEY = 'sk_test_abc';
    const paymongo = require('../server/utils/paymongo');
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: { id: 'link_123', url: 'https://pm.link/finara/abc' } }),
    });

    const result = await paymongo.createPaymentLink({ amount: 15000, description: 'License fee', businessId: 3 });

    expect(result).toEqual({ id: 'link_123', url: 'https://pm.link/finara/abc' });
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe('https://api.paymongo.com/v1/payment_links');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('sk_test_abc:').toString('base64')}`);
    const body = JSON.parse(options.body);
    expect(body).toEqual({ amount: 1500000, currency: 'PHP', description: 'License fee', metadata: { businessId: '3' } });
  });

  test('throws PayMongo\'s error detail on a non-2xx response', async () => {
    process.env.PAYMONGO_SECRET_KEY = 'sk_test_abc';
    const paymongo = require('../server/utils/paymongo');
    global.fetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ errors: [{ detail: 'Invalid API key.' }] }),
    });

    await expect(paymongo.createPaymentLink({ amount: 100, description: 'x', businessId: 1 }))
      .rejects.toThrow('Invalid API key.');
  });

  test('throws when PAYMONGO_SECRET_KEY is unset', async () => {
    delete process.env.PAYMONGO_SECRET_KEY;
    const paymongo = require('../server/utils/paymongo');
    await expect(paymongo.createPaymentLink({ amount: 100, description: 'x', businessId: 1 }))
      .rejects.toThrow('PAYMONGO_SECRET_KEY not configured');
  });
});

describe('paymongo.verifyWebhookSignature', () => {
  const secret = 'whsec_test123';
  function sign(t, rawBody) {
    return crypto.createHmac('sha256', secret).update(`${t}.`).update(rawBody).digest('hex');
  }

  test('accepts a valid test-mode signature (te)', () => {
    const paymongo = require('../server/utils/paymongo');
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const t = '1700000000';
    const te = sign(t, rawBody);
    const header = `t=${t},te=${te},li=`;
    expect(paymongo.verifyWebhookSignature(rawBody, header, secret)).toBe(true);
  });

  test('accepts a valid live-mode signature (li)', () => {
    const paymongo = require('../server/utils/paymongo');
    const rawBody = Buffer.from(JSON.stringify({ hello: 'world' }));
    const t = '1700000000';
    const li = sign(t, rawBody);
    const header = `t=${t},te=,li=${li}`;
    expect(paymongo.verifyWebhookSignature(rawBody, header, secret)).toBe(true);
  });

  test('rejects a tampered body', () => {
    const paymongo = require('../server/utils/paymongo');
    const t = '1700000000';
    const te = sign(t, Buffer.from(JSON.stringify({ hello: 'world' })));
    const header = `t=${t},te=${te},li=`;
    const tamperedBody = Buffer.from(JSON.stringify({ hello: 'tampered' }));
    expect(paymongo.verifyWebhookSignature(tamperedBody, header, secret)).toBe(false);
  });

  test('rejects a missing signature header', () => {
    const paymongo = require('../server/utils/paymongo');
    expect(paymongo.verifyWebhookSignature(Buffer.from('{}'), undefined, secret)).toBe(false);
  });
});
