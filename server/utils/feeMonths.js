/**
 * Month-range multiplier for fees quoted per month (tuition).
 *
 * A school year crosses the calendar year, so the range wraps: June (6) to
 * March (3) is Jun-Dec + Jan-Mar = 10 months. Both ends are inclusive.
 */

const isMonth = (m) => Number.isInteger(m) && m >= 1 && m <= 12;

// Returns the number of months, or null when the range is not set.
function monthsInRange(from, to) {
  const f = Number(from), t = Number(to);
  if (!isMonth(f) || !isMonth(t)) return null;
  return ((t - f + 12) % 12) + 1;
}

module.exports = { monthsInRange, isMonth };
