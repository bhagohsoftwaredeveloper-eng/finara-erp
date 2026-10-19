const crypto = require('crypto');

const API_BASE = 'https://api.paymongo.com/v1';
const TIMEOUT_MS = 10000;

function isConfigured() {
  return !!process.env.PAYMONGO_SECRET_KEY;
}

// What the hosted checkout offers, GCash first. A method must also be enabled on the
// PayMongo account, otherwise PayMongo rejects the session.
const PAYMENT_METHODS = ['gcash', 'qrph', 'paymaya'];

// A hosted Checkout Session, not a Payment Link: only a session lets us choose the
// payment methods. The session id is stored in business.paymentLinkId and the URL in
// paymentLinkUrl, so the rest of the flow keeps working.
async function createPaymentLink({ amount, description, businessId }) {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) throw new Error('PAYMONGO_SECRET_KEY not configured');

  const auth = Buffer.from(`${secretKey}:`).toString('base64');
  const res = await fetch(`${API_BASE}/checkout_sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      data: {
        attributes: {
          line_items: [{ amount: Math.round(Number(amount) * 100), currency: 'PHP', name: description, quantity: 1 }],
          payment_method_types: PAYMENT_METHODS,
          description,
          send_email_receipt: false,
          show_line_items: true,
          metadata: { businessId: String(businessId) },
        },
      },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const body = await res.json();
  if (!res.ok) {
    const detail = body?.errors?.[0]?.detail || `PayMongo responded ${res.status}`;
    throw new Error(detail);
  }
  return { id: body.data.id, url: body.data.attributes.checkout_url };
}

/** t=<epoch>,te=<test-mode sig>,li=<live-mode sig> — use whichever of te/li is non-empty. */
function verifyWebhookSignature(rawBody, signatureHeader, secret) {
  // express.raw() can hand us a non-Buffer body (e.g. {}) when the request has no
  // body or the wrong content-type. crypto's .update() throws on those, so bail early.
  if (!Buffer.isBuffer(rawBody) && typeof rawBody !== 'string') return false;
  if (!signatureHeader || !secret) return false;

  const parts = {};
  for (const pair of signatureHeader.split(',')) {
    const [k, v] = pair.split('=');
    parts[k] = v;
  }
  const { t, te, li } = parts;
  const signature = li || te;
  if (!t || !signature) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.`)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  } catch {
    return false; // length mismatch, non-hex signature, etc.
  }
}

module.exports = { PAYMENT_METHODS, isConfigured, createPaymentLink, verifyWebhookSignature };
