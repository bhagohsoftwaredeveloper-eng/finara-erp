'use client';
import { useState, useEffect, useCallback } from 'react';
import { accounts as api } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Search, Edit2, Trash2, ChevronDown, ChevronRight } from 'lucide-react';

const TYPES = ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'];
const TYPE_COLORS = { ASSET:'badge-blue', LIABILITY:'badge-red', EQUITY:'badge-purple', REVENUE:'badge-green', EXPENSE:'badge-yellow' };

function AccountModal({ account, onClose, onSaved, allAccounts }) {
  const [form, setForm] = useState(account || { accountCode:'', accountName:'', accountType:'ASSET', normalBalance:'DEBIT', parentId:'', description:'' });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      if (account?.id) await api.update(account.id, form);
      else await api.create({ ...form, parentId: form.parentId ? Number(form.parentId) : null });
      toast.success(account?.id ? 'Account updated' : 'Account created');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed to save'); }
    finally { setSaving(false); }
  };

  const autoNormalBalance = (type) => (['ASSET','EXPENSE'].includes(type) ? 'DEBIT' : 'CREDIT');

  return (
    <div className="modal-overlay">
      <div className="modal max-w-lg">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{account?.id ? 'Edit Account' : 'New Account'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            <div className="form-grid">
              <div className="form-group">
                <label className="label">Account Code *</label>
                <input className="input" required value={form.accountCode} onChange={(e) => setForm(f => ({...f, accountCode: e.target.value}))} placeholder="e.g. 1010" />
              </div>
              <div className="form-group">
                <label className="label">Account Type *</label>
                <select className="select" value={form.accountType} onChange={(e) => setForm(f => ({...f, accountType: e.target.value, normalBalance: autoNormalBalance(e.target.value)}))}>
                  {TYPES.map(t => <option key={t}>{t}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="label">Account Name *</label>
              <input className="input" required value={form.accountName} onChange={(e) => setForm(f => ({...f, accountName: e.target.value}))} placeholder="e.g. Cash on Hand" />
            </div>
            <div className="form-grid">
              <div className="form-group">
                <label className="label">Normal Balance</label>
                <select className="select" value={form.normalBalance} onChange={(e) => setForm(f => ({...f, normalBalance: e.target.value}))}>
                  <option>DEBIT</option><option>CREDIT</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">Parent Account</label>
                <select className="select" value={form.parentId} onChange={(e) => setForm(f => ({...f, parentId: e.target.value}))}>
                  <option value="">— None (Root Account) —</option>
                  {allAccounts.filter(a => a.id !== account?.id).map(a => (
                    <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="label">Description</label>
              <textarea className="input resize-none" rows={2} value={form.description || ''} onChange={(e) => setForm(f => ({...f, description: e.target.value}))} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save Account'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [modal, setModal] = useState(null); // null | 'new' | account

  const load = useCallback(() => {
    setLoading(true);
    api.list({ search, type: typeFilter }).then(r => setAccounts(r.data)).catch(console.error).finally(() => setLoading(false));
  }, [search, typeFilter]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!confirm('Delete this account?')) return;
    try { await api.remove(id); toast.success('Account deleted'); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Cannot delete'); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Chart of Accounts</h1>
          <p className="page-subtitle">PFRS-compliant account structure</p>
        </div>
        <button className="btn-primary" onClick={() => setModal('new')}>
          <Plus className="w-4 h-4" /> New Account
        </button>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body py-3 flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Search code or name..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select w-48" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All Types</option>
            {TYPES.map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th><th>Account Name</th><th>Type</th><th>Normal Balance</th><th>Parent</th><th>Status</th><th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">Loading accounts...</td></tr>
              ) : accounts.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8 text-gray-400">No accounts found. Create your chart of accounts to get started.</td></tr>
              ) : accounts.map(a => (
                <tr key={a.id}>
                  <td className="font-mono font-medium text-blue-700">{a.accountCode}</td>
                  <td className="font-medium text-gray-900">{a.accountName}</td>
                  <td><span className={TYPE_COLORS[a.accountType]}>{a.accountType}</span></td>
                  <td><span className="text-gray-500 text-xs">{a.normalBalance}</span></td>
                  <td className="text-gray-400 text-xs">{a.parent ? `${a.parent.accountCode} — ${a.parent.accountName}` : '—'}</td>
                  <td><span className={a.isActive ? 'badge-green' : 'badge-gray'}>{a.isActive ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="flex gap-1">
                      <button onClick={() => setModal(a)} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded transition-colors"><Edit2 className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(a.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
          {accounts.length} account{accounts.length !== 1 ? 's' : ''} found
        </div>
      </div>

      {modal && (
        <AccountModal
          account={modal === 'new' ? null : modal}
          allAccounts={accounts}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
