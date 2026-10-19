// Profit & Loss from general-ledger lines. Used by the Profit & Loss report (by
// driver / vehicle, and comparative) and by the Expenses Summary.
//
// A "line" is { accountId, account: { id, accountCode, accountName, accountType },
// debit, credit, ... } and, once assigned, a `col` naming the report column it
// belongs to (or null to leave it out).

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dateKey = (d) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);

const SECTIONS = [
  { key: 'revenue', label: 'Revenue' },
  { key: 'cogs', label: 'Cost of Sales' },
  { key: 'opex', label: 'Operating Expenses' },
  { key: 'otherIncome', label: 'Other Income' },
  { key: 'otherExpense', label: 'Other Expenses' },
];

// Same account-code rules as the Income Statement: 4000-4499 revenue, other 4xxx+
// revenue is other income, 5xxx cost of sales, 7xxx other expense, the rest operating.
function sectionOf(account) {
  const code = String(account.accountCode || '');
  if (account.accountType === 'REVENUE') {
    return code.startsWith('4') && Number(code) < 4500 ? 'revenue' : 'otherIncome';
  }
  if (code.startsWith('5')) return 'cogs';
  if (code.startsWith('7')) return 'otherExpense';
  return 'opex';
}

// Revenue is credit minus debit, expenses debit minus credit.
const balanceOf = (account, debit, credit) => (account.accountType === 'REVENUE' ? credit - debit : debit - credit);

function buildStatement(lines, columns) {
  const idx = new Map(columns.map((c, i) => [c.key, i]));
  const byAccount = new Map();

  for (const l of lines) {
    const i = idx.get(l.col);
    if (i === undefined) continue;
    if (!byAccount.has(l.account.id)) {
      byAccount.set(l.account.id, {
        id: l.account.id, code: l.account.accountCode, name: l.account.accountName,
        section: sectionOf(l.account), values: columns.map(() => 0),
      });
    }
    const row = byAccount.get(l.account.id);
    row.values[i] = round2(row.values[i] + balanceOf(l.account, Number(l.debit), Number(l.credit)));
  }

  let rows = [...byAccount.values()];
  // A business whose revenue accounts sit outside 4000-4499 would otherwise show no revenue.
  if (!rows.some((r) => r.section === 'revenue')) {
    rows = rows.map((r) => (r.section === 'otherIncome' ? { ...r, section: 'revenue' } : r));
  }

  const sum = (values) => round2(values.reduce((s, v) => s + v, 0));
  const sections = SECTIONS.map(({ key, label }) => {
    const accounts = rows.filter((r) => r.section === key)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(({ id, code, name, values }) => ({ id, code, name, values, total: sum(values) }));
    const totals = columns.map((_, i) => round2(accounts.reduce((s, a) => s + a.values[i], 0)));
    return { key, label, accounts, totals: { values: totals, total: sum(totals) } };
  });

  const t = Object.fromEntries(sections.map((s) => [s.key, s.totals.values]));
  const line = (values) => ({ values, total: sum(values) });
  const grossProfit = columns.map((_, i) => round2(t.revenue[i] - t.cogs[i]));
  const operatingIncome = columns.map((_, i) => round2(grossProfit[i] - t.opex[i]));
  const netIncome = columns.map((_, i) => round2(operatingIncome[i] + t.otherIncome[i] - t.otherExpense[i]));

  return {
    columns, sections,
    summary: { grossProfit: line(grossProfit), operatingIncome: line(operatingIncome), netIncome: line(netIncome) },
  };
}

// ─── Choosing the columns ────────────────────────────────────────

// One column per driver (or vehicle) that has lines, sorted by label, and an
// Untagged column last when some lines carry no tag.
function assignByTag(lines, dimension, labels) {
  const field = dimension === 'vehicle' ? 'vehicleId' : 'driverId';
  const word = dimension === 'vehicle' ? 'Vehicle' : 'Driver';
  const used = new Set();
  let untagged = false;

  const out = lines.map((l) => {
    if (l[field]) { used.add(l[field]); return { ...l, col: `t${l[field]}` }; }
    untagged = true;
    return { ...l, col: 'untagged' };
  });

  const columns = [...used]
    .map((id) => ({ key: `t${id}`, label: labels.get(id) || `${word} #${id}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  if (untagged) columns.push({ key: 'untagged', label: 'Untagged' });
  return { columns, lines: out };
}

// One column per date range, oldest first. Lines outside every range are left out.
function assignByRange(lines, ranges) {
  const columns = ranges.map((r, i) => ({ key: `r${i}`, label: r.label }));
  const out = lines.map((l) => {
    const d = dateKey(l.entryDate);
    const i = ranges.findIndex((r) => d >= r.from && d <= r.to);
    return { ...l, col: i === -1 ? null : `r${i}` };
  });
  return { columns, lines: out };
}

// ─── Change between the newest column and the one before it ──────
const changeOf = (values) => {
  if (values.length < 2) return { change: null, changePct: null };
  const prev = values[values.length - 2];
  const change = round2(values[values.length - 1] - prev);
  return { change, changePct: prev === 0 ? null : round2((change / Math.abs(prev)) * 100) };
};

function withChange(statement) {
  const addTo = (o) => ({ ...o, ...changeOf(o.values) });
  return {
    ...statement,
    sections: statement.sections.map((s) => ({
      ...s, accounts: s.accounts.map(addTo), totals: addTo(s.totals),
    })),
    summary: Object.fromEntries(Object.entries(statement.summary).map(([k, v]) => [k, addTo(v)])),
  };
}

module.exports = { SECTIONS, sectionOf, balanceOf, buildStatement, assignByTag, assignByRange, withChange };
