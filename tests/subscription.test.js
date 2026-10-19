const { REMINDER_DAYS, renewalState } = require('../lib/subscription');

// "Today" is 2026-10-19 in Manila
const NOW = new Date('2026-10-19T10:00:00+08:00');
const biz = (over = {}) => ({ licenseStatus: 'ACTIVE', paidUntil: null, suspendAt: null, ...over });
const at = (day) => `${day}T16:00:00.000Z`; // an instant on that Manila date, late in the day

describe('renewalState', () => {
  test('a business with no paid-until date is a legacy/free one: nothing to renew', () => {
    expect(renewalState(biz(), NOW).state).toBe('none');
  });

  test('paid well beyond the reminder window is fine', () => {
    const r = renewalState(biz({ paidUntil: at('2026-12-31') }), NOW);

    expect(r.state).toBe('ok');
    expect(r.daysLeft).toBeGreaterThan(REMINDER_DAYS);
  });

  test('inside the reminder window it is due soon, with the days left', () => {
    const r = renewalState(biz({ paidUntil: new Date('2026-10-31T20:00:00+08:00') }), NOW);

    expect(r).toMatchObject({ state: 'due_soon', daysLeft: 12, date: '2026-10-31', level: 'warning' });
  });

  test('the window edge: exactly REMINDER_DAYS away still reminds, one more day does not', () => {
    const edge = new Date(NOW.getTime() + REMINDER_DAYS * 86400000);
    const beyond = new Date(NOW.getTime() + (REMINDER_DAYS + 1) * 86400000);

    expect(renewalState(biz({ paidUntil: edge }), NOW).state).toBe('due_soon');
    expect(renewalState(biz({ paidUntil: beyond }), NOW).state).toBe('ok');
  });

  test('the last paid day is still today, not yet expired', () => {
    const r = renewalState(biz({ paidUntil: new Date('2026-10-19T20:00:00+08:00') }), NOW);

    expect(r).toMatchObject({ state: 'due_soon', daysLeft: 0 });
  });

  test('after the paid-until date it is expired, with how many days ago', () => {
    const r = renewalState(biz({ paidUntil: new Date('2026-10-14T20:00:00+08:00') }), NOW);

    expect(r).toMatchObject({ state: 'expired', daysLeft: -5, date: '2026-10-14', level: 'danger' });
  });

  test('a scheduled suspension outranks everything: it is the real deadline', () => {
    const r = renewalState(biz({
      paidUntil: new Date('2026-10-14T20:00:00+08:00'),
      suspendAt: new Date('2026-10-26T00:00:00+08:00'),
    }), NOW);

    expect(r).toMatchObject({ state: 'suspending', daysLeft: 7, date: '2026-10-26', level: 'danger' });
  });

  test('a suspension date that has already passed, or a license that is not ACTIVE, is not a reminder', () => {
    expect(renewalState(biz({ suspendAt: new Date('2026-10-01T00:00:00+08:00') }), NOW).state).toBe('none');
    expect(renewalState(biz({ licenseStatus: 'SUSPENDED', paidUntil: at('2026-10-20') }), NOW).state).toBe('none');
    expect(renewalState(biz({ licenseStatus: 'PENDING', paidUntil: at('2026-10-20') }), NOW).state).toBe('none');
  });
});
