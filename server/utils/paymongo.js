const crypto = require('crypto');

const API_BASE = 'https://api.paymongo.com/v1';
const TIMEOUT_MS = 10000;

function isConfigured() {
  return !!process.env.PAYMONGO_SECRET_KEY;
}

async function createPaymentLink({ amount, description, businessId }) {
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!secretKey) throw new Error('PAYMONGO_SECRET_KEY not configured');

  const auth = Buffer.from(`${secretKey}:`).toString('base64');
  const res = await fetch(`${API_BASE}/payment_links`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify({
      amount: Math.round(Number(amount) * 100),
      currency: 'PHP',
      description,
      metadata: { businessId: String(businessId) },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const body = await res.json();
  if (!res.ok) {
    const detail = body?.errors?.[0]?.detail || `PayMongo responded ${res.status}`;
    throw new Error(detail);
  }
  return { id: body.data.id, url: body.data.url };
}

/** t=<epoch>,te=<test-mode sig>,li=<live-mode sig> — use whichever of te/li is non-empty. */
function verifyWebhookSignature(rawBody, signatureHeader, secret) {
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

module.exports = { isConfigured, createPaymentLink, verifyWebhookSignature };
