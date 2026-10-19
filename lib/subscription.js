// Where a business stands on its subscription, for the dashboard reminders and the
// Settings > Subscription page. Shared CommonJS so it can be unit tested.
//
//   none        no paid-until date (a free or legacy business), or the license is not ACTIVE
//   ok          paid through a date beyond the reminder window
//   due_soon    paid-through date is within REMINDER_DAYS (still working normally)
//   expired     the paid-through date has passed (reminder only; the lock is the operator's
//               scheduled suspension, below)
//   suspending  the operator scheduled a suspension: the real deadline

const REMINDER_DAYS = 15;

const DAY_MS = 86400000;
// The Manila calendar date of an instant.
const phDay = (d) => new Date(new Date(d).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
const daysBetween = (fromDay, toDay) => Math.round((Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS);

function renewalState(biz, now = new Date()) {
  const none = { state: 'none', daysLeft: null, date: null, level: null };
  if (!biz || biz.licenseStatus !== 'ACTIVE') return none;

  const today = phDay(now);

  // A scheduled suspension that is still ahead is the deadline that matters.
  if (biz.suspendAt && new Date(biz.suspendAt) > now) {
    const date = phDay(biz.suspendAt);
    return { state: 'suspending', daysLeft: daysBetween(today, date), date, level: 'danger' };
  }

  if (!biz.paidUntil) return none;
  const date = phDay(biz.paidUntil);
  const daysLeft = daysBetween(today, date);
  if (daysLeft < 0) return { state: 'expired', daysLeft, date, level: 'danger' };
  if (daysLeft <= REMINDER_DAYS) return { state: 'due_soon', daysLeft, date, level: 'warning' };
  return { state: 'ok', daysLeft, date, level: null };
}

// Who may pay for a renewal (SUPER_ADMIN always passes the server's authorize()).
const RENEW_ROLES = ['ADMIN', 'MANAGER', 'ACCOUNTANT', 'SUPER_ADMIN'];

module.exports = { REMINDER_DAYS, RENEW_ROLES, renewalState };
