'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { businesses as bizApi, orders as ordersApi } from '@/lib/api';
import { isAuthenticated, clearSession, formatCurrency } from '@/lib/auth';
import { takePendingCompanyType } from '@/lib/companyTypes';
import { STATUS } from '@/lib/orderStatus';
import AddBusinessModal from '@/components/orders/AddBusinessModal';

const OPEN = ['PENDING_PAYMENT', 'PROOF_SUBMITTED'];
const POLL_MS = 15000;

// First company for a new account. Creating it is a paid order, the same flow
// as "Add business": pick the company and plan, pay, and the company appears
// once the payment is approved. This page shows where that order stands.
export default function OnboardingPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [orders, setOrders] = useState([]);
  const [modal, setModal] = useState(null);       // null | 'new' | order
  const [refreshing, setRefreshing] = useState(false);
  const chosenType = useRef(null);                 // company type picked on the signup form
  const autoOpened = useRef(false);

  const load = useCallback(async (quiet = true) => {
    if (!quiet) setRefreshing(true);
    try {
      const [b, o] = await Promise.all([bizApi.list(), ordersApi.list()]);
      // The order was approved: the company exists now.
      if (b.data?.length) {
        localStorage.setItem('activeBusinessId', b.data[0].id);
        router.replace('/dashboard');
        return;
      }
      setOrders(o.data || []);
      // Nothing placed yet: go straight to the order form, once.
      const hasOpen = (o.data || []).some((x) => OPEN.includes(x.status));
      if (!hasOpen && !autoOpened.current) { autoOpened.current = true; setModal('new'); }
    } catch {
      if (!quiet) toast.error('Could not check your order');
    } finally {
      setReady(true);
      setRefreshing(false);
    }
  }, [router]);

  useEffect(() => {
    if (!isAuthenticated()) { router.replace('/login'); return; }
    chosenType.current = takePendingCompanyType();
    load();
  }, [router, load]);

  const open = orders.find((o) => OPEN.includes(o.status));
  const rejected = !open ? orders.find((o) => o.status === 'REJECTED') : null;

  // While payment is under review, keep checking so the company opens by itself
  useEffect(() => {
    if (open?.status !== 'PROOF_SUBMITTED') return undefined;
    const t = setInterval(() => load(true), POLL_MS);
    return () => clearInterval(t);
  }, [open?.status, load]);

  const cancel = async (o) => {
    if (!window.confirm(`Cancel order ${o.orderNo}?`)) return;
    try {
      await ordersApi.cancel(o.id);
      toast.success('Order cancelled');
      autoOpened.current = false;
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Could not cancel'); }
  };

  if (!ready) return null;

  return (
    <div className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 50%, #1d4ed8 100%)' }}>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl p-8">
        <h1 className="text-xl font-black text-gray-900">Set up your company</h1>
        <p className="text-xs text-gray-400 mt-1 mb-6">
          Choose your plan and pay to create your company. Your books start empty, with a Philippine
          Chart of Accounts ready to use, as soon as your payment is confirmed.
        </p>

        {open ? (
          <div className="rounded-xl border border-gray-200 p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-semibold text-gray-900">{open.companyName}</div>
                <div className="text-xs text-gray-400 font-mono">{open.orderNo}</div>
              </div>
              <span className={`badge ${STATUS[open.status].cls}`}>{STATUS[open.status].label}</span>
            </div>
            <div className="text-sm text-gray-600">
              {open.period === 'YEARLY' ? 'Yearly' : 'Monthly'} plan ·{' '}
              <strong>{formatCurrency(open.amount)}</strong>
            </div>
            {open.status === 'PENDING_PAYMENT' ? (
              <p className="text-sm text-gray-600">Your company is created once your payment is confirmed.</p>
            ) : (
              <p className="text-sm text-gray-600">
                We received your payment and are reviewing it. This page updates by itself, and your
                company opens as soon as it is approved.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" onClick={() => setModal(open)}>
                {open.status === 'PENDING_PAYMENT' ? 'Pay now' : 'Update payment'}
              </button>
              <button className="btn-secondary inline-flex items-center gap-1" onClick={() => load(false)} disabled={refreshing}>
                <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Check status
              </button>
              <button className="btn-danger" onClick={() => cancel(open)}>Cancel order</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {rejected && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                Your last payment ({rejected.orderNo}) was not accepted
                {rejected.reviewNote ? `: ${rejected.reviewNote}` : '.'} You can place a new order below.
              </div>
            )}
            <button className="btn-primary w-full justify-center" onClick={() => setModal('new')}>
              Choose a plan
            </button>
          </div>
        )}

        <button type="button" className="text-xs text-gray-400 mt-6 hover:text-gray-600"
          onClick={() => { clearSession(); router.push('/login'); }}>
          Sign out
        </button>
      </div>

      {modal && (
        <AddBusinessModal
          order={modal === 'new' ? null : modal}
          initialValues={modal === 'new' && chosenType.current ? { companyType: chosenType.current } : null}
          onClose={() => setModal(null)}
          onDone={() => load()}
        />
      )}
    </div>
  );
}
