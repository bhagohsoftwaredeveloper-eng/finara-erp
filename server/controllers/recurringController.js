const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const glPost = require('../utils/glPost');
const { advanceDate: advance } = require('../utils/finance');

const validatePayload = (payload) => {
  if (!Array.isArray(payload) || payload.length < 2) throw createError('Template must have at least two journal lines', 400);
  const dr = payload.reduce((s, l) => s + Number(l.debit || 0), 0);
  const cr = payload.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (Math.abs(dr - cr) > 0.01) throw createError(`Template lines are not balanced (DR ${dr}, CR ${cr})`, 400);
};

exports.list = async (req, res, next) => {
  try {
    const templates = await prisma.recurringTemplate.findMany({ orderBy: { nextRunDate: 'asc' } });
    res.json(templates);
  } catch (err) { next(err); }
};

exports.getOne = async (req, res, next) => {
  try {
    const t = await prisma.recurringTemplate.findUnique({ where: { id: Number(req.params.id) } });
    if (!t) throw createError('Template not found', 404);
    res.json(t);
  } catch (err) { next(err); }
};

exports.create = async (req, res, next) => {
  try {
    const { name, frequency, startDate, endDate, description, reference, payload } = req.body;
    validatePayload(payload);
    const t = await prisma.recurringTemplate.create({
      data: {
        name,
        type: 'JOURNAL',
        frequency: frequency || 'MONTHLY',
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        nextRunDate: new Date(startDate),
        description, reference,
        payload,
        createdBy: req.user?.id ?? null,
      },
    });
    await recordAudit({ req, action: 'CREATE', entity: 'RecurringTemplate', entityId: t.id, summary: `Created recurring "${t.name}" (${t.frequency})` });
    res.status(201).json(t);
  } catch (err) { next(err); }
};

exports.update = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { name, frequency, startDate, endDate, description, reference, payload, nextRunDate } = req.body;
    if (payload) validatePayload(payload);
    const t = await prisma.recurringTemplate.update({
      where: { id },
      data: {
        ...(name && { name }),
        ...(frequency && { frequency }),
        ...(startDate && { startDate: new Date(startDate) }),
        endDate: endDate ? new Date(endDate) : null,
        ...(nextRunDate && { nextRunDate: new Date(nextRunDate) }),
        ...(description != null && { description }),
        ...(reference != null && { reference }),
        ...(payload && { payload }),
      },
    });
    await recordAudit({ req, action: 'UPDATE', entity: 'RecurringTemplate', entityId: id, summary: `Updated recurring "${t.name}"` });
    res.json(t);
  } catch (err) { next(err); }
};

// Generate a journal entry from a template and advance its schedule.
const runTemplate = async (t, userId) => {
  const entry = await glPost.post({
    entryDate: t.nextRunDate,
    description: t.description || `Recurring — ${t.name}`,
    reference: t.reference || null,
    userId: userId || t.createdBy || 1,
    lines: t.payload,
  });
  const nextRunDate = advance(t.nextRunDate, t.frequency);
  const stillActive = !t.endDate || nextRunDate <= new Date(t.endDate);
  await prisma.recurringTemplate.update({
    where: { id: t.id },
    data: { lastRunDate: new Date(), nextRunDate, isActive: stillActive ? t.isActive : false },
  });
  return entry;
};

exports.runNow = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = await prisma.recurringTemplate.findUnique({ where: { id } });
    if (!t) throw createError('Template not found', 404);
    const entry = await runTemplate(t, req.user?.id);
    await recordAudit({ req, action: 'RUN', entity: 'RecurringTemplate', entityId: id, summary: `Ran recurring "${t.name}" → ${entry.entryNo}` });
    res.json({ entry, message: `Posted ${entry.entryNo}` });
  } catch (err) { next(err); }
};

// Run all active templates that are due (nextRunDate <= today).
exports.runDue = async (req, res, next) => {
  try {
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    const due = await prisma.recurringTemplate.findMany({
      where: { isActive: true, nextRunDate: { lte: today } },
    });
    const results = [];
    for (const t of due) {
      try {
        const entry = await runTemplate(t, req.user?.id);
        results.push({ id: t.id, name: t.name, entryNo: entry.entryNo, status: 'posted' });
      } catch (e) {
        results.push({ id: t.id, name: t.name, status: 'error', error: e.message });
      }
    }
    await recordAudit({ req, action: 'RUN_DUE', entity: 'RecurringTemplate', summary: `Ran ${results.length} due template(s)` });
    res.json({ ran: results.length, results });
  } catch (err) { next(err); }
};

exports.toggle = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const t = await prisma.recurringTemplate.findUnique({ where: { id } });
    if (!t) throw createError('Template not found', 404);
    const updated = await prisma.recurringTemplate.update({ where: { id }, data: { isActive: !t.isActive } });
    res.json(updated);
  } catch (err) { next(err); }
};

exports.remove = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await prisma.recurringTemplate.delete({ where: { id } });
    await recordAudit({ req, action: 'DELETE', entity: 'RecurringTemplate', entityId: id, summary: 'Deleted recurring template' });
    res.json({ message: 'Template deleted' });
  } catch (err) { next(err); }
};
