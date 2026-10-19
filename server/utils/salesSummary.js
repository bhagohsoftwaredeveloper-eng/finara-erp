const { addDays } = require('../../lib/salesRanges');

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dateKey = (d) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
const accountLabel = (a) => (a ? `${a.accountCode} · ${a.accountName}` : 'Unassigned');

// Invoices and cash sales as one list of documents. All amounts are net of VAT
// (line amounts already are, and contra-revenue lines are stored negative).
// VOID documents are dropped.
function normalizeDocs(invoices, cashSales) {
  const docs = [];
  for (const inv of invoices) {
    if (inv.status === 'VOID') continue;
    docs.push({
      source: 'Invoice', docNo: inv.invoiceNo, date: dateKey(inv.invoiceDate),
      customer: inv.customer?.name || 'Unknown customer',
      subtotal: Number(inv.subtotal), vatAmount: Number(inv.vatAmount), total: Number(inv.totalAmount),
      lines: (inv.lines || []).map((l) => ({
        account: accountLabel(l.account), description: l.description, amount: Number(l.amount),
      })),
    });
  }
  for (const cs of cashSales) {
    if (cs.status === 'VOID') continue;
    docs.push({
      source: 'Cash Sale', docNo: cs.saleNo, date: dateKey(cs.saleDate),
      customer: (cs.buyerName && cs.buyerName.trim()) || 'Walk-in',
      subtotal: Number(cs.subtotal), vatAmount: Number(cs.vatAmount), total: Number(cs.totalAmount),
      lines: (cs.items || []).map((i) => ({
        account: accountLabel(cs.account), description: i.description, amount: Number(i.amount),
      })),
    });
  }
  return docs;
}

// ─── Periods ─────────────────────────────────────────────────────
const parse = (d) => new Date(`${d}T00:00:00Z`);
const iso = (dt) => dt.toISOString().slice(0, 10);

// First day of the period that contains `date`. Weeks run Monday to Sunday.
function periodStart(date, groupBy) {
  const d = parse(date);
  switch (groupBy) {
    case 'day': return date;
    case 'week': return addDays(date, -((d.getUTCDay() + 6) % 7));
    case 'month': return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)));
    case 'quarter': return iso(new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1)));
    case 'year': return iso(new Date(Date.UTC(d.getUTCFullYear(), 0, 1)));
    default: throw new Error(`Unknown groupBy "${groupBy}"`);
  }
}

function nextPeriodStart(start, groupBy) {
  const d = parse(start);
  switch (groupBy) {
    case 'day': return addDays(start, 1);
    case 'week': return addDays(start, 7);
    case 'month': return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
    case 'quarter': return iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1)));
    case 'year': return iso(new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1)));
    default: throw new Error(`Unknown groupBy "${groupBy}"`);
  }
}

function periodLabel(start, groupBy) {
  const d = parse(start);
  switch (groupBy) {
    case 'day': return start;
    case 'week': return `${start} to ${addDays(start, 6)}`;
    case 'month': return `${d.toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })} ${d.getUTCFullYear()}`;
    case 'quarter': return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    case 'year': return String(d.getUTCFullYear());
    default: throw new Error(`Unknown groupBy "${groupBy}"`);
  }
}

// One row per period from `from` to `to` (empty periods included): number of sales,
// net sales, VAT and total. Only documents dated inside [from, to] are counted.
function summarizeByPeriod(docs, { from, to, groupBy }) {
  const byKey = new Map();
  for (let s = periodStart(from, groupBy); s <= to; s = nextPeriodStart(s, groupBy)) {
    byKey.set(s, { key: s, label: periodLabel(s, groupBy), count: 0, net: 0, vat: 0, total: 0 });
  }
  const totals = { count: 0, net: 0, vat: 0, total: 0 };
  for (const doc of docs) {
    if (doc.date < from || doc.date > to) continue;
    const row = byKey.get(periodStart(doc.date, groupBy));
    for (const t of [row, totals]) {
      t.count += 1;
      t.net = round2(t.net + doc.subtotal);
      t.vat = round2(t.vat + doc.vatAmount);
      t.total = round2(t.total + doc.total);
    }
  }
  return { rows: [...byKey.values()], totals };
}

// ─── Comparison ──────────────────────────────────────────────────
const changeOf = (values) => {
  if (values.length < 2) return { change: null, changePct: null };
  const prev = values[values.length - 2];
  const last = values[values.length - 1];
  const change = round2(last - prev);
  return { change, changePct: prev === 0 ? null : round2((change / Math.abs(prev)) * 100) };
};

// Net sales per account / customer / item for each range, newest range last.
// Account and item rows add up document lines; customer rows add document subtotals.
function summarizeComparison(docs, { dimension, ranges }) {
  const rows = new Map();
  const totals = ranges.map(() => 0);

  const add = (key, label, rangeIdx, amount) => {
    if (!rows.has(key)) rows.set(key, { key, label, values: ranges.map(() => 0) });
    const row = rows.get(key);
    row.values[rangeIdx] = round2(row.values[rangeIdx] + amount);
  };

  ranges.forEach((range, idx) => {
    for (const doc of docs) {
      if (doc.date < range.from || doc.date > range.to) continue;
      totals[idx] = round2(totals[idx] + doc.subtotal);
      if (dimension === 'customer') {
        add(doc.customer, doc.customer, idx, doc.subtotal);
      } else {
        for (const line of doc.lines) {
          if (dimension === 'account') {
            add(line.account, line.account, idx, line.amount);
          } else {
            const label = (line.description || '').trim() || '(no description)';
            add(label.toLowerCase(), label, idx, line.amount);
          }
        }
      }
    }
  });

  const out = [...rows.values()].map((r) => ({
    ...r, total: round2(r.values.reduce((s, v) => s + v, 0)), ...changeOf(r.values),
  })).sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));

  return {
    ranges,
    rows: out,
    totals: { values: totals, total: round2(totals.reduce((s, v) => s + v, 0)), ...changeOf(totals) },
  };
}

module.exports = { normalizeDocs, periodStart, periodLabel, summarizeByPeriod, summarizeComparison };
