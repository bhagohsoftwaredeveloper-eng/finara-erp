// AR aging maths shared by the Express API and the Next.js UI (CommonJS, like
// lib/draftStorage.js). Dates travel as 'YYYY-MM-DD' strings so the server's
// time zone can never shift an invoice into another bucket.

const AR_BUCKETS = ['Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'];

const DAY_MS = 86400000;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dateKey = (d) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
const utcDay = (d) => Date.parse(`${dateKey(d)}T00:00:00Z`);

// Philippine calendar date (UTC+8) for "today".
function todayPH(now = Date.now()) {
  return new Date(now + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function daysBetween(from, to) {
  return Math.round((utcDay(to) - utcDay(from)) / DAY_MS);
}

function bucketForDays(days) {
  if (days <= 0) return 'Current';
  if (days <= 30) return '1-30 days';
  if (days <= 60) return '31-60 days';
  if (days <= 90) return '61-90 days';
  return 'Over 90 days';
}

// basis 'due': days past the due date. basis 'invoice': days since the invoice
// date (Current then means "issued on the as-of date").
function ageOf(inv, asOf, basis = 'due') {
  const from = basis === 'invoice' ? inv.invoiceDate : inv.dueDate;
  const days = Math.max(0, daysBetween(from, asOf));
  return { days, bucket: bucketForDays(days) };
}

// Amount collected as of a date. invoice.paidAmount is the live total, so for a
// past date take back the counted payments dated after it. PENDING/REVERSED
// payments never reached paidAmount, so they are ignored.
function paidAsOf(inv, asOf) {
  const later = (inv.payments || [])
    .filter((p) => p.status !== 'PENDING' && p.status !== 'REVERSED' && dateKey(p.paymentDate) > asOf)
    .reduce((s, p) => s + Number(p.amount), 0);
  return Math.max(0, round2(Number(inv.paidAmount) - later));
}

function buildAging(invoices, { asOf, basis = 'due', customerNames = {} }) {
  const items = [];
  for (const inv of invoices) {
    if (inv.status === 'VOID') continue;
    if (dateKey(inv.invoiceDate) > asOf) continue;
    const total = Number(inv.totalAmount);
    const paid = paidAsOf(inv, asOf);
    const outstanding = round2(total - paid);
    if (outstanding <= 0.005) continue;
    const { days, bucket } = ageOf(inv, asOf, basis);
    items.push({
      invoiceNo: inv.invoiceNo,
      customerId: inv.customerId,
      customer: customerNames[inv.customerId] || 'Unknown customer',
      invoiceDate: inv.invoiceDate,
      dueDate: inv.dueDate,
      paymentTerms: inv.paymentTerms || null,
      total, paid, outstanding,
      daysOverdue: days,
      bucket,
      notes: inv.notes,
    });
  }
  const summary = Object.fromEntries(
    AR_BUCKETS.map((b) => [b, round2(items.filter((i) => i.bucket === b).reduce((s, i) => s + i.outstanding, 0))])
  );
  return { items, summary, total: round2(items.reduce((s, i) => s + i.outstanding, 0)) };
}

module.exports = { AR_BUCKETS, todayPH, daysBetween, bucketForDays, ageOf, paidAsOf, buildAging };
