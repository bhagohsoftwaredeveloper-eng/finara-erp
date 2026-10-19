'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, ShieldAlert, RefreshCw, LogOut, Send, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { businesses as bizApi } from '@/lib/api';
import { isAuthenticated, clearSession, getUser, formatCurrency, formatDate } from '@/lib/auth';
import { RENEW_ROLES } from '@/lib/subscription';
import { STATUS } from '@/lib/orderStatus';
import RenewBusinessModal from '@/components/orders/RenewBusinessModal';

const PERIOD = { MONTHLY: 'month', YEARLY: 'year' };
const WHY = { SUSPENDED: 'Suspended', PENDING: 'Waiting for activation' };

// Where a user lands when none of their companies is active: what is owed, a way to pay it,
// and a way to ask the operator to activate the license again.
export default function LicenseSuspendedPage() {
  const router = useRouter();
  const [list, setList]       = useState(null);
  const [busyId, setBusyId]   = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pay, setPay]         = useState(null);   // { business, order }
  const role = typeof window !== 'undefined' ? getUser()?.role : null;
  const canPay = RENEW_ROLES.includes(role);

  const load = useCallback(async (quiet = true) => {
    if (!quiet) setRefreshing(true);
    try {
      const [locked, active] = await Promise.all([bizApi.locked(), bizApi.list()]);
      if (active.data?.length) { // something is active (a renewal was approved): back to work
        localStorage.setItem('activeBusinessId', active.data[0].id);
        router.replace('/dashboard');
        return;
      }
      if (!locked.data.length) { router.replace('/onboarding'); return; }
      setList(locked.data);
    } catch {
      if (!quiet) toast.error('Could not refresh');
    } finally { setRefreshing(false); }
  }, [router]);

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/login'); return; }
    load();
  }, [load, router]);

  const request = async (biz) => {
    setBusyId(biz.id);
    try {
      const { data } = await bizApi.requestActivation(biz.id);
      setList((l) => l.map((b) => (b.id === biz.id ? { ...b, activationRequestedAt: data.requestedAt } : b)));
      toast.success('Request sent. We will review it shortly.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not send the request');
    } finally { setBusyId(null); }
  };

  const signOut = () => { clearSession(); router.replace('/login'); };

  if (!list) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center">
          <ShieldAlert className="w-10 h-10 text-red-500 mx-auto" />
          <h1 className="text-2xl font-bold mt-3">Your license is not active</h1>
          <p className="text-sm text-gray-500 mt-1">Settle what is due, or ask us to activate it again, to get back to your books. Your data is safe.</p>
        </div>

        {list.map((b) => {
          const open = b.openOrder;
          const waiting = open?.status === 'PROOF_SUBMITTED';
          return (
            <div key={b.id} className="card p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-lg">{b.name}</p>
                  <p className="text-xs text-gray-500">{b.paidUntil ? `Paid until ${formatDate(b.paidUntil)}` : 'No payment on record'}</p>
                </div>
                <span className={`badge ${b.licenseStatus === 'SUSPENDED' ? 'badge-red' : 'badge-yellow'}`}>{WHY[b.licenseStatus] || b.licenseStatus}</span>
              </div>

              <div className="rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs text-gray-500 uppercase tracking-wide">Amount due</p>
                  {b.amountDue != null
                    ? <p className="text-2xl font-bold text-red-600">{formatCurrency(b.amountDue)}</p>
                    : <p className="text-sm text-gray-600 mt-1">Choose your plan when you pay</p>}
                  {b.period && b.amountDue != null && <p className="text-xs text-gray-500">per {PERIOD[b.period] || b.period}</p>}
                </div>
                {open && <span className={`badge ${STATUS[open.status].cls}`}>Payment {STATUS[open.status].label.toLowerCase()}</span>}
              </div>

              {waiting && <p className="text-sm text-blue-700 dark:text-blue-300">Your payment is being reviewed. This page updates once it is approved.</p>}
              {b.activationRequestedAt && (
                <p className="text-sm text-green-700 dark:text-green-400 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4" /> Activation requested on {formatDate(b.activationRequestedAt)}
                </p>
              )}

              <div className="flex flex-wrap gap-2">
                {!waiting && canPay && (
                  <button className="btn-primary" onClick={() => setPay({ business: b, order: open?.mine && open.status === 'PENDING_PAYMENT' ? open : null })}>
                    Pay now
                  </button>
                )}
                <button className="btn-secondary flex items-center gap-1.5" disabled={busyId === b.id || !!b.activationRequestedAt} onClick={() => request(b)}>
                  {busyId === b.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Request for activation
                </button>
              </div>
              {!canPay && <p className="text-xs text-gray-500">Ask your administrator or manager to pay for the renewal.</p>}
            </div>
          );
        })}

        <div className="flex justify-center gap-4 text-sm">
          <button onClick={() => load(false)} disabled={refreshing} className="inline-flex items-center gap-1.5 text-gray-600 hover:underline">
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
          <button onClick={signOut} className="inline-flex items-center gap-1.5 text-gray-600 hover:underline"><LogOut className="w-4 h-4" /> Sign out</button>
        </div>
      </div>

      {pay && (
        <RenewBusinessModal business={pay.business} resumeOrder={pay.order} onClose={() => setPay(null)} onDone={() => load()} />
      )}
    </div>
  );
}
