// Turns a profit-and-loss statement (from /api/reports/profit-loss) into a flat list of
// display rows, so the screen, the Excel/CSV download and the print all show the same
// lines in the same order. Shared CommonJS so it can be unit tested.
//
// Row: { type: 'header' | 'account' | 'total' | 'summary', label, values?, total?, change?, changePct? }

function flattenStatement(statement, { showChange = false } = {}) {
  const rows = [];
  const money = (o) => ({
    values: o.values, total: o.total,
    ...(showChange && { change: o.change ?? null, changePct: o.changePct ?? null }),
  });
  const section = (key) => statement.sections.find((s) => s.key === key);

  const addSection = (key) => {
    const s = section(key);
    if (!s || s.accounts.length === 0) return false;
    rows.push({ type: 'header', label: s.label });
    for (const a of s.accounts) rows.push({ type: 'account', label: `${a.code} · ${a.name}`, ...money(a) });
    rows.push({ type: 'total', label: `Total ${s.label}`, ...money(s.totals) });
    return true;
  };

  addSection('revenue');
  if (addSection('cogs')) rows.push({ type: 'summary', label: 'Gross Profit', ...money(statement.summary.grossProfit) });
  addSection('opex');
  const hasOther = addSection('otherIncome') | addSection('otherExpense');
  if (hasOther) {
    // Operating income belongs before the other items; insert it ahead of them.
    const at = rows.findIndex((r) => r.type === 'header' && (r.label === section('otherIncome').label || r.label === section('otherExpense').label));
    rows.splice(at, 0, { type: 'summary', label: 'Operating Income', ...money(statement.summary.operatingIncome) });
  }
  rows.push({ type: 'summary', label: 'Net Income', ...money(statement.summary.netIncome) });
  return rows;
}

module.exports = { flattenStatement };
