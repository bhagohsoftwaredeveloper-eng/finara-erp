const prisma = require('../config/database');
const logger = require('../utils/logger');
const mailer = require('../utils/mailer');
const { verifyWebhookSignature } = require('../utils/paymongo');

exports.paymongo = async (req, res) => {
  const signatureHeader = req.headers['paymongo-signature'];
  const secret = process.env.PAYMONGO_WEBHOOK_SECRET;
  const rawBody = req.body; // Buffer — this route is mounted with express.raw(), see server/index.js

  if (!verifyWebhookSignature(rawBody, signatureHeader, secret)) {
    logger.warn('[paymongoWebhook] signature verification failed');
    return res.sendStatus(401);
  }

  let event;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.sendStatus(400);
  }

  const eventType = event?.data?.attributes?.type;
  const payment = event?.data?.attributes?.data;
  const isLinkPayment = eventType === 'link.payment.paid'
    || (eventType === 'payment.paid' && payment?.attributes?.origin === 'links');
  if (!isLinkPayment) return res.sendStatus(200);

  const businessId = Number(payment?.attributes?.metadata?.businessId);
  if (!businessId) return res.sendStatus(200);

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business || business.licenseStatus === 'ACTIVE') return res.sendStatus(200);

  const amount = Number(payment?.attributes?.amount || 0) / 100;

  await prisma.$transaction([
    prisma.business.update({
      where: { id: businessId },
      data: { licenseStatus: 'ACTIVE', licenseActivatedAt: new Date(), licenseActivatedBy: null },
    }),
    prisma.licenseEvent.create({
      data: { businessId, eventType: 'PAYMENT_RECEIVED', amount, actorUserId: null },
    }),
    prisma.licenseEvent.create({
      data: { businessId, eventType: 'ACTIVATED', actorUserId: null },
    }),
  ]);

  const requester = business.createdByUserId
    ? await prisma.user.findUnique({ where: { id: business.createdByUserId } })
    : null;
  mailer.sendLicenseActivatedNotice(business, requester);

  res.sendStatus(200);
};
