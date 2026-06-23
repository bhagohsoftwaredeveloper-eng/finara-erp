'use client';
import { useState, useEffect, useCallback } from 'react';
import { journal as jApi, accounts as acctApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Eye, CheckCircle, XCircle, Filter, AlertTriangle, ShieldAlert, Lock } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';

const STATUS_BADGE = { DRAFT:'badge-yellow', POSTED:'badge-green', VOIDED:'badge-gray' };

// ─── 2-Step Void Authorization Modal ─────────────────────────
function VoidModal({ entry, onClose, onVoided }) {
  const [step, setStep]       = useState(1);   // 1 = confirm, 2 = admin auth
  const [reason, setReason]   = useState('');
  const [agreed, setAgreed]   = useState(false);
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [pwError, setPwError] = useState('');

  const totalDr = entry.lines?.reduce((s, l) => s + Number(l.debit), 0) || 0;

  const handleStep1 = () => {
    if (!reason.trim()) { toast.error('Please provide a reason for voiding'); return; }
    if (!agreed)        { toast.error('You must confirm you understand this action'); return; }
    setStep(2);
  };

  const handleVoid = async () => {
    if (!password) { setPwError('Admin password is required'); return; }
    setLoading(true);
    setPwError('');
    try {
      await jApi.void(entry.id, { adminPassword: password, reason });
      toast.success(`${entry.entryNo} has been voided`);
      onVoided();
      onClose();
    } catch (err) {
      const msg = err.response?.data?.error || 'Void failed';
      if (msg.toLowerCase().includes('password') || msg.toLowerCase().includes('unauthorized')) {
        setPwError(msg);
      } else {
        toast.error(msg);
      }
    } finally { setLoading(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">

        {/* ── Step 1: Confirm ── */}
        {step === 1 && (
          <>
            <div className="modal-header bg-red-50 border-b border-red-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-red-800">Void Journal Entry</h3>
                  <p className="text-xs text-red-500">This action cannot be undone</p>
                </div>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="modal-body space-y-4">
              {/* Entry summary */}
              <div className="bg-gray-50 rounded-xl border border-gray-200 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Entry No.</span>
                  <span className="font-mono font-bold text-gray-900">{entry.entryNo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Date</span>
                  <span className="text-gray-700">{formatDate(entry.entryDate)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Amount</span>
                  <span className="font-semibold text-gray-900">{formatCurrency(totalDr)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Description</span>
                  <span className="text-gray-700 text-right max-w-[200px] truncate">{entry.description}</span>
                </div>
              </div>

              {/* Warning */}
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800 leading-relaxed">
                <strong>Warning:</strong> Voiding this entry will permanently reverse its effect on all account balances,
                reports, and financial statements. The entry will be marked VOIDED and cannot be re-posted.
              </div>

              {/* Reason */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Reason for voiding <span className="text-red-500">*</span>
                </label>
                <textarea
                  className="input w-full h-20 resize-none text-sm"
                  placeholder="State the reason this entry must be voided…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>

              {/* Confirmation checkbox */}
              <label className="flex items-start gap-3 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-red-600"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span className="text-sm text-gray-700">
                  I understand that voiding this entry is <strong>permanent</strong> and will affect
                  financial reports. Super admin authorization is required on the next step.
                </span>
              </label>
            </div>

            <div className="modal-footer">
              <button onClick={onClose} className="btn-secondary">Cancel</button>
              <button onClick={handleStep1} className="btn bg-red-600 text-white hover:bg-red-700 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4" /> Proceed to Authorization
              </button>
            </div>
          </>
        )}

        {/* ── Step 2: Admin password ── */}
        {step === 2 && (
          <>
            <div className="modal-header bg-red-50 border-b border-red-200">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                  <Lock className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-red-800">Super Admin Authorization</h3>
                  <p className="text-xs text-red-500">Step 2 of 2 — Enter admin credentials to confirm</p>
                </div>
              </div>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
            </div>

            <div className="modal-body space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800">
                You are about to void <strong className="font-mono">{entry.entryNo}</strong>.
                An account with <strong>ADMIN</strong> role must authorize this action.
              </div>

              <div className="bg-gray-50 rounded-xl border border-gray-200 p-3 text-xs text-gray-600 space-y-1">
                <p><span className="font-medium">Reason recorded:</span> {reason}</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Admin Password <span className="text-red-500">*</span>
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="password"
                    className={`input pl-9 w-full ${pwError ? 'border-red-400 focus:ring-red-400' : ''}`}
                    placeholder="Enter super admin password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setPwError(''); }}
                    onKeyDown={(e) => e.key === 'Enter' && handleVoid()}
                    autoFocus
                  />
                </div>
                {pwError && <p className="text-xs text-red-600 mt-1 flex items-center gap-1"><AlertTriangle className="w-3 h-3" />{pwError}</p>}
              </div>
            </div>

            <div className="modal-footer">
              <button onClick={() => setStep(1)} className="btn-secondary">← Back</button>
              <button
                onClick={handleVoid}
                disabled={loading}
                className="btn bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 flex items-center gap-2"
              >
                {loading ? 'Verifying…' : <><XCircle className="w-4 h-4" /> Confirm Void</>}
              </button>
            </div>
          </>
        )}

      </div>
    </div>
  );
}

function JournalModal({ entry, accounts, onClose, onSaved }) {
  const [form, setForm] = useState(entry || {
    entryDate: new Date().toISOString().split('T')[0],
    reference: '', description: '',
    lines: [
      { accountId: '', debit: '', credit: '', description: '' },
      { accountId: '', debit: '', credit: '', description: '' },
    ],
  });
  const [saving, setSaving] = useState(false);

  const totalDebit  = form.lines.reduce((s, l) => s + (Number(l.debit)  || 0), 0);
  const totalCredit = form.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const setLine = (i, field, val) => setForm(f => ({
    ...f, lines: f.lines.map((l, idx) => idx === i ? { ...l, [field]: val } : l)
  }));

  const addLine = () => setForm(f => ({ ...f, lines: [...f.lines, { accountId:'', debit:'', credit:'', description:'' }] }));
  const removeLine = (i) => setForm(f => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!balanced) { toast.error('Entry is not balanced'); return; }
    setSaving(true);
    try {
      const payload = { ...form, lines: form.lines.filter(l => l.accountId).map(l => ({ ...l, accountId: Number(l.accountId), debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 })) };
      if (entry?.id) await jApi.update(entry.id, payload);
      else await jApi.create(payload);
      toast.success('Journal entry saved');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-3xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{entry?.id ? `Edit — ${entry.entryNo}` : 'New Journal Entry'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            <div className="form-grid">
              <div className="form-group">
                <label className="label">Date *</label>
                <input type="date" className="input" required value={form.entryDate} onChange={(e) => setForm(f => ({...f, entryDate: e.target.value}))} />
              </div>
              <div className="form-group">
                <label className="label">Reference</label>
                <input className="input" value={form.reference} onChange={(e) => setForm(f => ({...f, reference: e.target.value}))} placeholder="e.g. OR-0001" />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Description *</label>
              <input className="input" required value={form.description} onChange={(e) => setForm(f => ({...f, description: e.target.value}))} placeholder="e.g. Payment received for Invoice INV-000001" />
            </div>

            {/* Lines */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Journal Lines</label>
                <button type="button" onClick={addLine} className="btn-secondary btn-sm"><Plus className="w-3 h-3" /> Add Line</button>
              </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <table className="table">
                  <thead>
                    <tr><th>Account</th><th>Description</th><th className="text-right">Debit (₱)</th><th className="text-right">Credit (₱)</th><th /></tr>
                  </thead>
                  <tbody>
                    {form.lines.map((line, i) => (
                      <tr key={i}>
                        <td className="py-2">
                          <select className="select text-xs" value={line.accountId} onChange={(e) => setLine(i, 'accountId', e.target.value)}>
                            <option value="">Select account...</option>
                            {accounts.map(a => <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>)}
                          </select>
                        </td>
                        <td className="py-2">
                          <input className="input text-xs" value={line.description} onChange={(e) => setLine(i, 'description', e.target.value)} placeholder="Optional" />
                        </td>
                        <td className="py-2">
                          <input type="number" step="0.01" min="0" className="input text-right text-xs" value={line.debit} onChange={(e) => setLine(i, 'debit', e.target.value)} placeholder="0.00" />
                        </td>
                        <td className="py-2">
                          <input type="number" step="0.01" min="0" className="input text-right text-xs" value={line.credit} onChange={(e) => setLine(i, 'credit', e.target.value)} placeholder="0.00" />
                        </td>
                        <td className="py-2">
                          {form.lines.length > 2 && <button type="button" onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600"><XCircle className="w-4 h-4" /></button>}
                        </td>
                      </tr>
                    ))}
                    <tr className={`font-semibold text-sm ${balanced ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
                      <td colSpan={2} className="px-4 py-2">Totals {balanced ? '✓ Balanced' : '✗ Not Balanced'}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(totalDebit)}</td>
                      <td className="px-4 py-2 text-right">{formatCurrency(totalCredit)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving || !balanced} className="btn-primary">{saving ? 'Saving...' : 'Save Entry'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function JournalPage() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [modal, setModal] = useState(null);
  const [filter, setFilter] = useState({ status: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const load = useCallback(() => {
    setLoading(true);
    jApi.list({ ...filter, page, limit: 20 }).then(r => { setEntries(r.data.data); setTotal(r.data.total); }).finally(() => setLoading(false));
  }, [filter, page]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { acctApi.list({ active: true }).then(r => setAccounts(r.data)); }, []);

  const handlePost = async (id) => {
    try { await jApi.post(id); toast.success('Entry posted to GL'); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Cannot post'); }
  };

  const [voidEntry, setVoidEntry] = useState(null);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Journal Entries</h1>
          <p className="page-subtitle">{total} total entries</p>
        </div>
        <button className="btn-primary" onClick={() => setModal('new')}><Plus className="w-4 h-4" /> New Entry</button>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body py-3 flex flex-wrap gap-3">
          <select className="select w-40" value={filter.status} onChange={(e) => setFilter(f => ({...f, status: e.target.value}))}>
            <option value="">All Status</option>
            <option>DRAFT</option><option>POSTED</option><option>VOIDED</option>
          </select>
          <input type="date" className="input w-40" value={filter.from} onChange={(e) => setFilter(f => ({...f, from: e.target.value}))} />
          <input type="date" className="input w-40" value={filter.to} onChange={(e) => setFilter(f => ({...f, to: e.target.value}))} />
          <button className="btn-secondary" onClick={load}><Filter className="w-4 h-4" /> Filter</button>
        </div>
      </div>

      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr><th>Entry No.</th><th>Date</th><th>Description</th><th>Reference</th><th className="text-right">Debit</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">Loading...</td></tr>
              ) : entries.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">No journal entries yet.</td></tr>
              ) : entries.map(e => {
                const totalDr = e.lines?.reduce((s, l) => s + Number(l.debit), 0) || 0;
                return (
                  <tr key={e.id}>
                    <td className="font-mono text-blue-700 font-medium">{e.entryNo}</td>
                    <td>{formatDate(e.entryDate)}</td>
                    <td className="max-w-xs truncate text-gray-700">{e.description}</td>
                    <td className="text-gray-400 text-xs">{e.reference || '—'}</td>
                    <td className="text-right font-medium">{formatCurrency(totalDr)}</td>
                    <td><span className={STATUS_BADGE[e.status]}>{e.status}</span></td>
                    <td>
                      <div className="flex gap-1">
                        <button onClick={() => setModal(e)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Eye className="w-4 h-4" /></button>
                        {e.status === 'DRAFT' && <button onClick={() => handlePost(e.id)} className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded" title="Post"><CheckCircle className="w-4 h-4" /></button>}
                        {e.status !== 'VOIDED' && <button onClick={() => setVoidEntry(e)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded" title="Void"><XCircle className="w-4 h-4" /></button>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t flex items-center justify-between text-sm text-gray-500">
          <span>{total} entries total</span>
          <div className="flex gap-2">
            <button disabled={page<=1} onClick={() => setPage(p=>p-1)} className="btn-secondary btn-sm">Previous</button>
            <span className="px-3 py-1 text-sm">Page {page}</span>
            <button disabled={entries.length < 20} onClick={() => setPage(p=>p+1)} className="btn-secondary btn-sm">Next</button>
          </div>
        </div>
      </div>

      {modal && <JournalModal entry={modal === 'new' ? null : modal} accounts={accounts} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} />}
      {voidEntry && <VoidModal entry={voidEntry} onClose={() => setVoidEntry(null)} onVoided={() => { setVoidEntry(null); load(); }} />}
    </div>
  );
}
