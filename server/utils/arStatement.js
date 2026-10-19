const { dateKey } = require('../../lib/arAging');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const isCounted = (p) => p.status !== 'PENDING' && p.status !== 'REVERSED';

// Running-balance customer ledger. Invoices are debits, payments are credits.
// Everything dated before `from` is folded into the opening balance; rows run
// from `from` to `to` inclusive.
function buildLedger(invoices, { from, to }) {
  const txns = [];
  for (const inv of invoices) {
    if (inv.status === 'VOID') continue;
    const date = dateKey(inv.invoiceDate);
    txns.push({
      date, order: 0, type: 'INVOICE', reference: inv.invoiceNo,
      description: inv.paymentTerms ? `Invoice · ${inv.paymentTerms}` : 'Invoice',
      debit: round2(inv.totalAmount), credit: 0,
    });

    const counted = (inv.payments || []).filter(isCounted);
    for (const p of counted) {
      txns.push({
        date: dateKey(p.paymentDate), order: 1, type: 'PAYMENT', reference: p.paymentNo,
        description: `Payment for ${inv.invoiceNo} (${p.paymentMethod}${p.reference ? `, ${p.reference}` : ''})`,
        debit: 0, credit: round2(p.amount),
      });
    }
    // paidAmount can exceed the payment rows (older records): show the difference
    // so the ledger still agrees with the invoice balance.
    const unexplained = round2(Number(inv.paidAmount) - counted.reduce((s, p) => s + Number(p.amount), 0));
    if (unexplained > 0.005) {
      txns.push({
        date, order: 1, type: 'PAYMENT', reference: inv.invoiceNo,
        description: `Payments received on ${inv.invoiceNo} (no payment detail)`,
        debit: 0, credit: unexplained,
      });
    }
  }

  txns.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.reference.localeCompare(b.reference));

  let openingBalance = 0;
  for (const t of txns) if (t.date < from) openingBalance = round2(openingBalance + t.debit - t.credit);

  let balance = openingBalance;
  const rows = [];
  for (const t of txns) {
    if (t.date < from || t.date > to) continue;
    balance = round2(balance + t.debit - t.credit);
    rows.push({ date: t.date, type: t.type, reference: t.reference, description: t.description,
      debit: t.debit, credit: t.credit, balance });
  }

  return {
    openingBalance,
    rows,
    totalDebits: round2(rows.reduce((s, r) => s + r.debit, 0)),
    totalCredits: round2(rows.reduce((s, r) => s + r.credit, 0)),
    closingBalance: balance,
  };
}

module.exports = { buildLedger };
