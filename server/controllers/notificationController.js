const prisma = require('../config/database');
const { createError } = require('../middleware/errorHandler');
const { recordAudit } = require('../utils/audit');
const mailer = require('../utils/mailer');

exports.status = (req, res) => {
  res.json({ emailEnabled: !!mailer.getTransporter() });
};

// Email a single invoice to its customer
exports.emailInvoice = async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const invoice = await prisma.invoice.findUnique({ where: { id }, include: { customer: true, lines: true } });
    if (!invoice) throw createError('Invoice not found', 404);
    if (!invoice.customer?.email) throw createError('Customer has no email address on file', 400);

    const sent = await mailer.sendInvoiceEmail(invoice, invoice.customer);
    if (!sent) throw createError('Email could not be sent. Check SMTP configuration.', 502);

    await recordAudit({ req, action: 'EMAIL', entity: 'Invoice', entityId: id, summary: `Emailed invoice ${invoice.invoiceNo} to ${invoice.customer.email}` });
    res.json({ message: `Invoice emailed to ${invoice.customer.email}` });
  } catch (err) { next(err); }
};

// Send reminder emails for all overdue, unpaid invoices
exports.sendOverdueReminders = async (req, res, next) => {
  try {
    if (!mailer.getTransporter()) throw createError('Email is not configured (SMTP env vars missing)', 400);
    const today = new Date();
    const overdue = await prisma.invoice.findMany({
      where: { status: { in: ['OPEN', 'PARTIAL'] }, dueDate: { lt: today } },
      include: { customer: true },
    });

    let sent = 0, skipped = 0;
    for (const inv of overdue) {
      if (!inv.customer?.email) { skipped++; continue; }
      const ok = await mailer.sendOverdueReminder(inv, inv.customer);
      ok ? sent++ : skipped++;
    }
    await recordAudit({ req, action: 'EMAIL', entity: 'Invoice', summary: `Sent ${sent} overdue reminder(s)` });
    res.json({ overdue: overdue.length, sent, skipped });
  } catch (err) { next(err); }
};
