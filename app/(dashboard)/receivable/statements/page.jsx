'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { receivable as rApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Printer, RefreshCw } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import { AR_BUCKETS, todayPH } from '@/lib/arAging';

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const firstOfMonth = () => `${todayPH().slice(0, 8)}01`;

// ─── Print HTML (string, not React: it is written into the print window) ──
const customerBlock = (c) => `
  <div class="info-grid" style="grid-template-columns:2fr 1fr;">
    <div class="info-box"><div class="info-lbl">Customer</div><div class="info-val">${esc(c.name)}</div>
      ${c.address ? `<div class="small gray">${esc(c.address)}</div>` : ''}</div>
    <div class="info-box"><div class="info-lbl">Customer TIN</div><div class="info-val mono small">${esc(c.tin || '—')}</div></div>
  </div>`;

function openStatementHtml(st) {
  const rows = st.items.map((i) => `
    <tr>
      <td class="mono">${esc(i.invoiceNo)}</td>
      <td>${dateFmt(i.invoiceDate)}</td>
      <td>${esc(i.paymentTerms || '—')}</td>
      <td>${dateFmt(i.dueDate)}</td>
      <td class="right">${phpFmt(i.total)}</td>
      <td class="right">${phpFmt(i.paid)}</td>
      <td class="right bold">${phpFmt(i.outstanding)}</td>
    </tr>`).join('');
  return `${customerBlock(st.customer)}
    <table>
      <thead><tr><th>Invoice #</th><th>Date</th><th>Terms</th><th>Due Date</th>
        <th class="right">Amount</th><th class="right">Paid</th><th class="right">Balance</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="gray">No open invoices.</td></tr>'}</tbody>
      <tfoot><tr><td colspan="6">TOTAL AMOUNT DUE</td><td class="right">${phpFmt(st.total)}</td></tr></tfoot>
    </table>
    <div class="section-title">Aging Summary</div>
    <table>
      <thead><tr>${AR_BUCKETS.map((b) => `<th class="right">${b}</th>`).join('')}</tr></thead>
      <tbody><tr>${AR_BUCKETS.map((b) => `<td class="right">${phpFmt(st.summary[b])}</td>`).join('')}</tr></tbody>
    </table>`;
}

function ledgerStatementHtml(st) {
  const rows = st.rows.map((r) => `
    <tr>
      <td>${dateFmt(r.date)}</td>
      <td>${r.type === 'INVOICE' ? 'Invoice' : 'Payment'}</td>
      <td class="mono">${esc(r.reference)}</td>
      <td>${esc(r.description)}</td>
      <td class="right">${r.debit ? phpFmt(r.debit) : ''}</td>
      <td class="right">${r.credit ? phpFmt(r.credit) : ''}</td>
      <td class="right">${phpFmt(r.balance)}</td>
    </tr>`).join('');
  return `${customerBlock(st.customer)}
    <table>
      <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th>Description</th>
        <th class="right">Debit</th><th class="right">Credit</th><th class="right">Balance</th></tr></thead>
      <tbody>
        <tr><td colspan="6" class="gray">Opening balance</td><td class="right bold">${phpFmt(st.openingBalance)}</td></tr>
        ${rows}
      </tbody>
      <tfoot><tr><td colspan="4">TOTALS / CLOSING BALANCE</td>
        <td class="right">${phpFmt(st.totalDebits)}</td><td class="right">${phpFmt(st.totalCredits)}</td>
        <td class="right">${phpFmt(st.closingBalance)}</td></tr></tfoot>
    </table>`;
}

async function printStatements(data, allCustomers) {
  const build = data.mode === 'open' ? openStatementHtml : ledgerStatementHtml;
  const body = data.statements
    .map(build)
    .join('<div style="page-break-after:always;"></div>');
  const period = data.mode === 'open'
    ? `Open items as of ${dateFmt(data.asOf)}`
    : `${dateFmt(data.from)} to ${dateFmt(data.to)}`;
  const who = allCustomers ? 'All customers' : data.statements[0]?.customer.name || '';
  await printDocument('Statement of Account', `${who} · ${period}`, body);
}

// ─── On-screen statement ──────────────────────────────────────
function StatementCard({ st, mode }) {
  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3 className="font-semibold text-gray-900">{st.customer.name}</h3>
          <p className="text-xs text-gray-400">{st.customer.customerCode}{st.customer.tin ? ` · TIN ${st.customer.tin}` : ''}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-500">{mode === 'open' ? 'Total amount due' : 'Closing balance'}</p>
          <p className="text-lg font-bold text-gray-900">{formatCurrency(mode === 'open' ? st.total : st.closingBalance)}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        {mode === 'open' ? (
          <table className="table w-full">
            <thead><tr>
              <th className="pl-4">Invoice #</th><th>Date</th><th>Terms</th><th>Due Date</th>
              <th className="text-right">Amount</th><th className="text-right">Paid</th><th className="text-right pr-4">Balance</th>
            </tr></thead>
            <tbody>
              {st.items.length === 0 && <tr><td colSpan={7} className="text-center py-6 text-gray-400">No open invoices.</td></tr>}
              {st.items.map((i) => (
                <tr key={i.invoiceNo} className="border-b border-gray-100">
                  <td className="pl-4 font-mono text-sm text-green-700">{i.invoiceNo}</td>
                  <td>{formatDate(i.invoiceDate)}</td>
                  <td>{i.paymentTerms || '—'}</td>
                  <td>
                    {formatDate(i.dueDate)}
                    {i.daysOverdue > 0 && <span className="text-xs text-red-500 ml-2">{i.daysOverdue}d overdue</span>}
                  </td>
                  <td className="text-right">{formatCurrency(i.total)}</td>
                  <td className="text-right">{formatCurrency(i.paid)}</td>
                  <td className="text-right pr-4 font-semibold">{formatCurrency(i.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="table w-full">
            <thead><tr>
              <th className="pl-4">Date</th><th>Type</th><th>Reference</th><th>Description</th>
              <th className="text-right">Debit</th><th className="text-right">Credit</th><th className="text-right pr-4">Balance</th>
            </tr></thead>
            <tbody>
              <tr className="bg-gray-50 border-b border-gray-100">
                <td className="pl-4 text-gray-500" colSpan={6}>Opening balance</td>
                <td className="text-right pr-4 font-semibold">{formatCurrency(st.openingBalance)}</td>
              </tr>
              {st.rows.map((r, idx) => (
                <tr key={`${r.reference}-${idx}`} className="border-b border-gray-100">
                  <td className="pl-4">{formatDate(r.date)}</td>
                  <td>{r.type === 'INVOICE' ? 'Invoice' : 'Payment'}</td>
                  <td className="font-mono text-sm">{r.reference}</td>
                  <td className="text-gray-600">{r.description}</td>
                  <td className="text-right">{r.debit ? formatCurrency(r.debit) : ''}</td>
                  <td className="text-right">{r.credit ? formatCurrency(r.credit) : ''}</td>
                  <td className="text-right pr-4 font-semibold">{formatCurrency(r.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {mode === 'open' && st.items.length > 0 && (
        <div className="card-body border-t border-gray-100 flex flex-wrap gap-x-6 gap-y-1 text-sm">
          {AR_BUCKETS.map((b) => (
            <span key={b} className="text-gray-500">{b}: <strong className="text-gray-800">{formatCurrency(st.summary[b])}</strong></span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function StatementsPage() {
  const searchParams = useSearchParams();
  const [customers, setCustomers]   = useState([]);
  const [customerId, setCustomerId] = useState(searchParams.get('customerId') || '');
  const [mode, setMode]             = useState('open'); // 'open' | 'ledger'
  const [asOf, setAsOf]             = useState(todayPH());
  const [from, setFrom]             = useState(firstOfMonth());
  const [to, setTo]                 = useState(todayPH());
  const [data, setData]             = useState(null);
  const [loading, setLoading]       = useState(false);

  useEffect(() => {
    rApi.customers.list().then((r) => setCustomers(r.data)).catch(() => toast.error('Failed to load customers'));
  }, []);

  const load = useCallback(async () => {
    if (!customerId) { setData(null); return; }
    setLoading(true);
    try {
      const params = { customerId, mode, ...(mode === 'open' ? { asOf } : { from, to }) };
      setData((await rApi.statements.get(params)).data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load statement');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [customerId, mode, asOf, from, to]);
  useEffect(() => { load(); }, [load]);

  const all = customerId === 'all';

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Statement of Account</h1>
          <p className="page-subtitle">What a customer owes: open invoices with aging, or the full ledger with running balance</p>
        </div>
        <button className="btn-primary" disabled={!data || data.statements.length === 0}
          onClick={() => printStatements(data, all)}>
          <Printer className="w-4 h-4" /> Print / Save as PDF
        </button>
      </div>

      <div className="card">
        <div className="card-body flex flex-wrap items-end gap-4">
          <div className="form-group min-w-[16rem]">
            <label className="label">Customer</label>
            <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
              <option value="">— Select customer —</option>
              <option value="all">All customers with a balance</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Show</label>
            <select className="select" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="open">Open items</option>
              <option value="ledger">Full ledger</option>
            </select>
          </div>
          {mode === 'open' ? (
            <div className="form-group">
              <label className="label">As of</label>
              <input type="date" className="input" max={todayPH()} value={asOf}
                onChange={(e) => e.target.value && setAsOf(e.target.value)} />
            </div>
          ) : (
            <>
              <div className="form-group">
                <label className="label">From</label>
                <input type="date" className="input" value={from} max={to}
                  onChange={(e) => e.target.value && setFrom(e.target.value)} />
              </div>
              <div className="form-group">
                <label className="label">To</label>
                <input type="date" className="input" value={to} min={from}
                  onChange={(e) => e.target.value && setTo(e.target.value)} />
              </div>
            </>
          )}
          <button className="btn-secondary" onClick={load} disabled={loading || !customerId}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {!customerId && <p className="text-sm text-gray-400 text-center py-10">Choose a customer to see their statement.</p>}
      {data && data.statements.length === 0 && (
        <p className="text-sm text-gray-400 text-center py-10">No customers with {mode === 'open' ? 'an open balance' : 'activity'} for this selection.</p>
      )}
      {data && data.statements.map((st) => <StatementCard key={st.customer.id} st={st} mode={data.mode} />)}
    </div>
  );
}
