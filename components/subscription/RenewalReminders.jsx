'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarClock, AlertTriangle } from 'lucide-react';
import { useBusiness } from '@/lib/businessContext';
import { orders as ordersApi } from '@/lib/api';
import { getUser, formatDate } from '@/lib/auth';
import { renewalState, RENEW_ROLES } from '@/lib/subscription';
import { STATUS } from '@/lib/orderStatus';

const OPEN_ORDER = ['PENDING_PAYMENT', 'PROOF_SUBMITTED'];

const dayWord = (n) => (n === 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`);

function message(biz, s) {
  if (s.state === 'suspending') {
    return <>Access to <strong>{biz.name}</strong> will be suspended on <strong>{formatDate(s.date)}</strong> ({dayWord(s.daysLeft)}). Renew to keep working without interruption.</>;
  }
  if (s.state === 'expired') {
    return <>The subscription of <strong>{biz.name}</strong> ended on <strong>{formatDate(s.date)}</strong> ({-s.daysLeft} day{s.daysLeft === -1 ? '' : 's'} ago). Please renew.</>;
  }
  return <>The subscription of <strong>{biz.name}</strong> ends on <strong>{formatDate(s.date)}</strong> ({s.daysLeft === 0 ? 'today' : dayWord(s.daysLeft)}).</>;
}

// Dashboard reminders for the businesses whose subscription is about to end, has ended,
// or has a scheduled suspension. Only the people who can pay see them; paying happens on
// Settings > Subscription (for the business being renewed).
export default function RenewalReminders() {
  const { businesses, setActive } = useBusiness();
  const [role, setRole]         = useState(null);
  const [orders, setOrders]     = useState([]);
  useEffect(() => { setRole(getUser()?.role || null); }, []);

  const canPay = RENEW_ROLES.includes(role);
  const due = useMemo(
    () => (businesses || []).filter((b) => !b.managed).map((biz) => ({ biz, s: renewalState(biz) })).filter((x) => x.s.level),
    [businesses]
  );

  const loadOrders = useCallback(() => ordersApi.list().then((r) => setOrders(r.data)).catch(() => {}), []); // reminders still show
  useEffect(() => { if (canPay && due.length > 0) loadOrders(); }, [canPay, due.length, loadOrders]);

  if (!canPay || due.length === 0) return null;

  return (
    <>
      <div className="space-y-3">
        {due.map(({ biz, s }) => {
          const danger = s.level === 'danger';
          const open = orders.find((o) => o.businessId === biz.id && OPEN_ORDER.includes(o.status));
          const Icon = danger ? AlertTriangle : CalendarClock;
          return (
            <div key={biz.id} className={`flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3 ${
              danger
                ? 'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/20 dark:border-red-900/50 dark:text-red-200'
                : 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-900/20 dark:border-amber-900/50 dark:text-amber-200'}`}>
              <Icon className="w-5 h-5 flex-shrink-0" />
              <p className="text-sm flex-1 min-w-[14rem]">{message(biz, s)}</p>
              {open ? (
                <div className="flex items-center gap-2">
                  <span className={`badge ${STATUS[open.status].cls}`}>Renewal {STATUS[open.status].label.toLowerCase()}</span>
                  <Link href="/settings?tab=subscription" className="text-xs font-medium underline" onClick={() => setActive?.(biz.id)}>Pay / view order</Link>
                </div>
              ) : (
                <Link href="/settings?tab=subscription" className="btn-primary btn-sm" onClick={() => setActive?.(biz.id)}>Renew now</Link>
              )}
            </div>
          );
        })}
      </div>

      {renewBiz && (
        <RenewBusinessModal business={renewBiz} onClose={() => setRenewBiz(null)}
          onDone={() => { setRenewBiz(null); loadOrders(); }} />
      )}
    </>
  );
}
