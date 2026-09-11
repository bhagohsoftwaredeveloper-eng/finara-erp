const prisma = require('../config/database');
const logger = require('../utils/logger');
const mailer = require('../utils/mailer');
const { verifyWebhookSignature } = require('../utils/paymongo');

exports.paymongo = async (req, res) => {
  try {
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

    const paymongoEventType = event?.data?.attributes?.type;
    const payment = event?.data?.attributes?.data;
    const isLinkPayment = paymongoEventType === 'link.payment.paid'
      || (paymongoEventType === 'payment.paid' && payment?.attributes?.origin === 'links');
    if (!isLinkPayment) {
      logger.info(`[paymongoWebhook] ignoring unrelated event type: ${paymongoEventType}`);
      return res.sendStatus(200);
    }

    const businessId = Number(payment?.attributes?.metadata?.businessId);
    if (!businessId) {
      logger.warn('[paymongoWebhook] link payment event had no businessId in metadata — ignoring');
      return res.sendStatus(200);
    }

    const paymentId = payment?.attributes?.id || payment?.id;

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) {
      logger.info(`[paymongoWebhook] business ${businessId} not found — ignoring`);
      return res.sendStatus(200);
    }
    if (business.licenseStatus === 'ACTIVE') {
      logger.info(`[paymongoWebhook] business ${businessId} is already ACTIVE — ignoring`);
      return res.sendStatus(200);
    }

    const amount = Number(payment?.attributes?.amount || 0) / 100;

    // Mirror the manual path's state machine (businessController.LICENSE_TRANSITIONS):
    // SUSPENDED → ACTIVE is a REACTIVATED event, PENDING → ACTIVE is ACTIVATED.
    const eventType = business.licenseStatus === 'SUSPENDED' ? 'REACTIVATED' : 'ACTIVATED';

    // The conditional updateMany is the race-safe guard: a concurrent redelivery of the
    // same event loses the update and writes no LicenseEvent rows.
    const activated = await prisma.$transaction(async (tx) => {
      const result = await tx.business.updateMany({
        where: { id: businessId, licenseStatus: { not: 'ACTIVE' } },
        data: { licenseStatus: 'ACTIVE', licenseActivatedAt: new Date(), licenseActivatedBy: null },
      });
      if (result.count === 0) return false;

      await tx.licenseEvent.create({
        data: {
          businessId,
          eventType: 'PAYMENT_RECEIVED',
          amount,
          note: `PayMongo payment ${paymentId}`,
          actorUserId: null,
        },
      });
      await tx.licenseEvent.create({
        data: { businessId, eventType, actorUserId: null },
      });
      return true;
    });

    if (!activated) {
      logger.info(`[paymongoWebhook] business ${businessId} was already ACTIVE by the time the transaction ran — skipping duplicate activation`);
      return res.sendStatus(200);
    }

    const requester = business.createdByUserId
      ? await prisma.user.findUnique({ where: { id: business.createdByUserId } })
      : null;
    mailer.sendLicenseActivatedNotice({ ...business, licenseStatus: 'ACTIVE' }, requester);

    logger.info(`[paymongoWebhook] business ${businessId} activated (${eventType}) via PayMongo webhook — payment ${paymentId}`);
    res.sendStatus(200);
  } catch (err) {
    logger.error('[paymongoWebhook] ' + (err.stack || err.message));
    res.sendStatus(500);
  }
};
