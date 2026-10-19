// Date-range helpers for the Sales Summary, shared by the Express API and the
// Next.js UI (CommonJS, like lib/arAging.js). Dates are 'YYYY-MM-DD' strings and
// all arithmetic is done in UTC so the server and browser agree.

const DAY_MS = 86400000;
const parse = (d) => new Date(`${String(d).slice(0, 10)}T00:00:00Z`);
const iso = (dt) => dt.toISOString().slice(0, 10);

function addDays(date, n) {
  return iso(new Date(parse(date).getTime() + n * DAY_MS));
}

const SHORT = { month: 'short', timeZone: 'UTC' };
const monthName = (dt) => dt.toLocaleDateString('en-US', SHORT);

// The selected month ('YYYY-MM') and the `count - 1` months before it, oldest first.
function monthRanges(endMonth, count = 3) {
  const [y, m] = endMonth.split('-').map(Number);
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const first = new Date(Date.UTC(y, m - 1 - i, 1));
    const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0));
    out.push({ from: iso(first), to: iso(last), label: `${monthName(first)} ${first.getUTCFullYear()}` });
  }
  return out;
}

// The same number of days immediately before [from, to].
function previousRange(from, to) {
  const days = Math.round((parse(to) - parse(from)) / DAY_MS) + 1;
  const prevTo = addDays(from, -1);
  return { from: addDays(prevTo, -(days - 1)), to: prevTo };
}

function rangeLabel(from, to) {
  const a = parse(from);
  const b = parse(to);
  const wholeMonth = a.getUTCDate() === 1
    && a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth()
    && new Date(b.getTime() + DAY_MS).getUTCDate() === 1;
  if (wholeMonth) return `${monthName(a)} ${a.getUTCFullYear()}`;
  const md = (dt) => `${monthName(dt)} ${dt.getUTCDate()}`;
  return a.getUTCFullYear() === b.getUTCFullYear()
    ? `${md(a)} – ${md(b)}, ${b.getUTCFullYear()}`
    : `${md(a)}, ${a.getUTCFullYear()} – ${md(b)}, ${b.getUTCFullYear()}`;
}

module.exports = { addDays, monthRanges, previousRange, rangeLabel };
