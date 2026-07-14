const prisma = require('../config/database');
const { validateLead } = require('../utils/validateLead');
const { sendLeadWebhook } = require('../utils/leadWebhook');

// POST /api/leads — public (marketing site contact form)
exports.create = async (req, res, next) => {
  try {
    const { valid, errors, data } = validateLead(req.body);
    if (!valid) return res.status(400).json({ error: 'Validation failed', details: errors });
    const lead = await prisma.lead.create({ data });
    sendLeadWebhook(lead);
    res.status(201).json({ id: lead.id, message: 'Thank you! We will get back to you shortly.' });
  } catch (err) {
    next(err);
  }
};

// GET /api/leads — ADMIN/MANAGER
exports.list = async (req, res, next) => {
  try {
    const leads = await prisma.lead.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(leads);
  } catch (err) {
    next(err);
  }
};
