'use client';
import { useCallback, useEffect, useState } from 'react';
import { CreditCard, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { useBusiness } from '@/lib/businessContext';
import { orders as ordersApi } from '@/lib/api';
import { formatCurrency, formatDate, getUser } from '@/lib/auth';
import { renewalState, RENEW_ROLES } from '@/lib/subscription';
import { COMPANY_TYPES } from '@/lib/companyTypes';
import { STATUS } from '@/lib/orderStatus';
import RenewBusinessModal from '@/components/orders/RenewBusinessModal';

const PERIOD = { MONTHLY: 'Monthly', YEARLY: 'Yearly' };
const OPEN_ORDER = ['PENDING_PAYMENT', 'PROOF_SUBMITTED'];

const STATE_BADGE = {
  none:       { cls: 'badge-gray',   text: 'No renewal date' },
  ok:         { cls: 'badge-green',  text: 'Paid' },
  due_soon:   { cls: 'badge-yellow', text: 'Renewal due soon' },
  expired:    { cls: 'badge-red',    text: 'Expired' },
  suspending: { cls: 'badge-red',    text: 'Suspension scheduled' },
};

// The active business's subscription: plan, paid-through date, price, history, and Renew.
export default function SubscriptionPanel() {
  const { activeBusiness } = useBusiness();
  const [loading, setLoading] = useState(true);
  const [quote, setQuote]     = useState(null);   // null = no subscription on record
  const [orders, setOrders]   = useState([]);
  const [renewOpen, setRenewOpen] = useState(false);
  const canPay = RENEW_ROLES.includes(getUser()?.role);

  const load = useCallback(async () => {
    if (!activeBusiness) return;
    setLoading(true);
    try {
      const [q, o] = await Promise.all([
        ordersApi.renewQuote(activeBusiness.id).then((r) => r.data).catch((err) => {
          if (err.response?.status === 409) return null; // never ordered: free or legacy business
          throw err;
        }),
        ordersApi.list().then((r) => r.data),
      ]);
      setQuote(q);
      setOrders(o.filter((x) => x.businessId === activeBusiness.id));
    } catch {
      toast.error('Could not load the subscription');
    } finally {
      setLoading(false);
    }
  }, [activeBusiness]);
  useEffect(() => { load(); }, [load]);

  if (!activeBusiness) return <p className="text-sm text-gray-400">Choose a business first.</p>;
  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  const s = renewalState(activeBusiness);
  const badge = STATE_BADGE[s.state];
  const last = orders.find((o) => o.status === 'APPROVED') || orders[0] || null; // newest first
  const price = (period) => quote?.prices?.find((p) => p.period === period)?.amount;
  const typeLabel = COMPANY_TYPES.find((t) => t.key === quote?.companyType)?.label || quote?.companyType;
  const open = orders.find((o) => OPEN_ORDER.includes(o.status));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-bold uppercase tracking-wide text-blue-600 flex items-center gap-2">
          <CreditCard className="w-4 h-4" /> Subscription
        </h3>
        <p className="text-xs text-gray-400 mt-1">{activeBusiness.name}</p>
      </div>

      {!quote ? (
        <div className="bg-gray-50 rounded-xl px-4 py-4 text-sm text-gray-600">
          This business has no subscription on record (for example a free or older account), so there is nothing to renew here.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <div className="card p-4"><p className="text-xs text-gray-500 uppercase tracking-wide">Plan</p>
              <p className="text-lg font-semibold mt-1">{typeLabel}{last ? ` · ${PERIOD[last.period] || last.period}` : ''}</p>
              {last && price(last.period) != null && <p className="text-xs text-gray-500 mt-0.5">{formatCurrency(price(last.period))} per {last.period === 'YEARLY' ? 'year' : 'month'}</p>}
            </div>
            <div className="card p-4"><p className="text-xs text-gray-500 uppercase tracking-wide">Paid until</p>
              <p className="text-lg font-semibold mt-1">{activeBusiness.paidUntil ? formatDate(activeBusiness.paidUntil) : '—'}</p>
              {s.daysLeft != null && s.state !== 'suspending' && (
                <p className="text-xs text-gray-500 mt-0.5">{s.daysLeft >= 0 ? `${s.daysLeft} day${s.daysLeft === 1 ? '' : 's'} left` : `ended ${-s.daysLeft} day${s.daysLeft === -1 ? '' : 's'} ago`}</p>
              )}
            </div>
            <div className="card p-4"><p className="text-xs text-gray-500 uppercase tracking-wide">Status</p>
              <p className="mt-1.5"><span className={`badge ${badge.cls}`}>{badge.text}</span></p>
              {s.state === 'suspending' && <p className="text-xs text-red-600 mt-1">Access will be suspended on {formatDate(s.date)}.</p>}
            </div>
            <div className="card p-4 flex flex-col justify-between gap-2">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Renewal</p>
              {open ? (
                <p className="text-sm"><span className={`badge ${STATUS[open.status].cls}`}>{STATUS[open.status].label}</span> <span className="text-xs text-gray-500">order {open.orderNo}</span></p>
              ) : canPay ? (
                <button className="btn-primary btn-sm self-start" onClick={() => setRenewOpen(true)}>Renew now</button>
              ) : (
                <p className="text-xs text-gray-500">Ask the account owner to renew.</p>
              )}
            </div>
          </div>

          {quote.prices?.length > 0 && (
            <div className="text-sm text-gray-600">
              <p className="font-medium text-gray-800 mb-1">Plans for {typeLabel}</p>
              <ul className="space-y-0.5">
                {quote.prices.slice().sort((a, b) => (a.period === 'MONTHLY' ? -1 : 1)).map((p) => (
                  <li key={p.period}>{PERIOD[p.period] || p.period}: <strong>{formatCurrency(p.amount)}</strong>{p.period === 'YEARLY' && p.discountPercent ? ` (${Number(p.discountPercent)}% off)` : ''}</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {orders.length > 0 && (
        <div>
          <p className="text-sm font-medium text-gray-800 mb-2">Payment history</p>
          <div className="card overflow-x-auto">
            <table className="table w-full text-sm">
              <thead><tr><th className="pl-4">Order</th><th>Plan</th><th className="text-right">Amount</th><th>Status</th><th className="pr-4">Date</th></tr></thead>
              <tbody>
                {orders.map((o) => (
                  <tr key={o.id} className="border-b border-gray-100">
                    <td className="pl-4 py-2 font-mono text-xs">{o.orderNo}</td>
                    <td>{PERIOD[o.period] || o.period}</td>
                    <td className="text-right">{formatCurrency(o.amount)}</td>
                    <td><span className={`badge ${STATUS[o.status]?.cls || 'badge'}`}>{STATUS[o.status]?.label || o.status}</span></td>
                    <td className="pr-4">{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {renewOpen && (
        <RenewBusinessModal business={activeBusiness} onClose={() => setRenewOpen(false)}
          onDone={() => { setRenewOpen(false); load(); }} />
      )}
    </div>
  );
}
