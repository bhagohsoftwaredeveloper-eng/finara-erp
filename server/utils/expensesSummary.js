// Expenses Summary: net expense (debits less credits) from general-ledger lines of
// EXPENSE accounts, grouped by account, driver, vehicle or month.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dateKey = (d) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (key) => `${MONTH_NAMES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

const GROUPS = ['account', 'driver', 'vehicle', 'month'];

function keyAndLabel(line, groupBy, labels) {
  switch (groupBy) {
    case 'account':
      return { key: String(line.account.id), label: `${line.account.accountCode} · ${line.account.accountName}` };
    case 'driver':
    case 'vehicle': {
      const id = groupBy === 'driver' ? line.driverId : line.vehicleId;
      if (!id) return { key: 'untagged', label: 'Untagged' };
      return { key: `t${id}`, label: (labels && labels.get(id)) || `${groupBy === 'driver' ? 'Driver' : 'Vehicle'} #${id}` };
    }
    case 'month': {
      const key = dateKey(line.entryDate).slice(0, 7);
      return { key, label: monthLabel(key) };
    }
    default:
      throw new Error(`Unknown groupBy "${groupBy}"`);
  }
}

function summarizeExpenses(lines, { groupBy, labels }) {
  if (!GROUPS.includes(groupBy)) throw new Error(`Unknown groupBy "${groupBy}"`);
  const rows = new Map();
  for (const l of lines) {
    const { key, label } = keyAndLabel(l, groupBy, labels);
    if (!rows.has(key)) rows.set(key, { key, label, amount: 0, count: 0 });
    const row = rows.get(key);
    row.amount = round2(row.amount + Number(l.debit) - Number(l.credit));
    row.count += 1;
  }

  const total = round2([...rows.values()].reduce((s, r) => s + r.amount, 0));
  const out = [...rows.values()]
    .map((r) => ({ ...r, pct: total === 0 ? null : Math.round((r.amount / total) * 1000) / 10 }))
    .sort(groupBy === 'month' ? (a, b) => a.key.localeCompare(b.key) : (a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
  return { rows: out, total };
}

module.exports = { GROUPS, summarizeExpenses };
