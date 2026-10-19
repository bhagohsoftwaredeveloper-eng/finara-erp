// Summary of a fund (one or more general-ledger asset accounts) from posted journal
// entries: opening balance, money in, money out, closing balance, a running-balance
// ledger, and where the money went / came from.
//
// An entry is { entryNo, entryDate, reference, description,
//               lines: [{ accountId, account: { accountCode, accountName }, debit, credit }] }
// and must include ALL of its lines, so the other side of a fund movement can be named.

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const dateKey = (d) => String(d instanceof Date ? d.toISOString() : d).slice(0, 10);
const label = (a) => `${a.accountCode} · ${a.accountName}`;

// Spread `amount` over the lines in proportion to their `field` ('debit' or 'credit').
function spread(into, lines, field, amount) {
  const total = lines.reduce((s, l) => s + Number(l[field]), 0);
  if (!(total > 0)) { into.set('Unclassified', round2((into.get('Unclassified') || 0) + amount)); return; }
  for (const l of lines) {
    const key = label(l.account);
    into.set(key, round2((into.get(key) || 0) + amount * (Number(l[field]) / total)));
  }
}

const toList = (m) => [...m.entries()].map(([lbl, amount]) => ({ label: lbl, amount: round2(amount) }))
  .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));

function buildFundSummary(entries, { fundAccounts, from, to }) {
  const fundIds = new Set(fundAccounts.map((a) => a.id));
  const perAccount = new Map(fundAccounts.map((a) => [a.id, { opening: 0, in: 0, out: 0 }]));
  const disbursements = new Map();
  const replenishments = new Map();
  let opening = 0;
  const moves = [];

  const sorted = [...entries].sort((a, b) => dateKey(a.entryDate).localeCompare(dateKey(b.entryDate)) || String(a.entryNo).localeCompare(String(b.entryNo)));

  for (const e of sorted) {
    const date = dateKey(e.entryDate);
    if (date > to) continue;
    const fund = e.lines.filter((l) => fundIds.has(l.accountId));
    if (fund.length === 0) continue;
    const others = e.lines.filter((l) => !fundIds.has(l.accountId));
    const net = round2(fund.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0));

    if (date < from) {
      opening = round2(opening + net);
      for (const l of fund) perAccount.get(l.accountId).opening = round2(perAccount.get(l.accountId).opening + Number(l.debit) - Number(l.credit));
      continue;
    }

    for (const l of fund) {
      const p = perAccount.get(l.accountId);
      p.in = round2(p.in + Number(l.debit));
      p.out = round2(p.out + Number(l.credit));
    }
    // A transfer between two fund accounts nets to nothing for the fund as a whole.
    const inAmt = net > 0 ? net : 0;
    const outAmt = net < 0 ? -net : 0;
    if (outAmt > 0) spread(disbursements, others.filter((l) => Number(l.debit) > 0), 'debit', outAmt);
    if (inAmt > 0) spread(replenishments, others.filter((l) => Number(l.credit) > 0), 'credit', inAmt);
    moves.push({ date, entryNo: e.entryNo, reference: e.reference || null, description: e.description, in: inAmt, out: outAmt });
  }

  let balance = opening;
  const rows = moves.map((m) => {
    balance = round2(balance + m.in - m.out);
    return { ...m, balance };
  });
  const totalIn = round2(moves.reduce((s, m) => s + m.in, 0));
  const totalOut = round2(moves.reduce((s, m) => s + m.out, 0));

  return {
    opening, totalIn, totalOut, closing: round2(opening + totalIn - totalOut),
    accounts: fundAccounts.map((a) => {
      const p = perAccount.get(a.id);
      return { id: a.id, code: a.accountCode, name: a.accountName, opening: p.opening, in: p.in, out: p.out, closing: round2(p.opening + p.in - p.out) };
    }),
    rows,
    disbursements: toList(disbursements),
    replenishments: toList(replenishments),
  };
}

module.exports = { buildFundSummary };
