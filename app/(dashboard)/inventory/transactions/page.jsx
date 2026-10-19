'use client';
import { useState, useEffect, useCallback } from 'react';
import { inventory as inventoryApi } from '@/lib/api';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import toast from 'react-hot-toast';
import { Plus, Search, RefreshCw, Printer } from 'lucide-react';
import TxnModal, { TXN_TYPES, TXN_MAP } from '@/components/inventory/RecordMovementModal';

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function TransactionsPage() {
  const [txns,   setTxns]   = useState([]);
  const [items,  setItems]  = useState([]);
  const [total,  setTotal]  = useState(0);
  const [modal,  setModal]  = useState(null); // null = closed; object = prefill for the form
  const [loading,setLoading]= useState(true);
  const [filter, setFilter] = useState({ search: '', type: '', itemId: '', from: '', to: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter.type)   params.type   = filter.type;
      if (filter.itemId) params.itemId = filter.itemId;
      if (filter.from)   params.from   = filter.from;
      if (filter.to)     params.to     = filter.to;
      if (filter.search) params.search = filter.search;
      const [txnRes, itemRes] = await Promise.all([
        inventoryApi.transactions.list(params),
        inventoryApi.items.list({ isActive: 'true' }),
      ]);
      setTxns(txnRes.data.data);
      setTotal(txnRes.data.total);
      setItems(itemRes.data);
    } catch { toast.error('Failed to load transactions'); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  // Arriving from Inventory > Transactions: start filtered to that item.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('itemId');
    if (id && /^\d+$/.test(id)) setFilter((f) => ({ ...f, itemId: id }));
  }, []);

  const handlePrint = async () => {
    const rows = txns.map((t) => {
      const meta = TXN_MAP[t.type];
      return `<tr>
        <td class="mono">${t.txnNo}</td>
        <td>${dateFmt(t.txnDate)}</td>
        <td><span class="badge ${meta?.badge || 'b-gray'}">${meta?.label || t.type}</span></td>
        <td class="mono">${t.item?.sku}</td>
        <td>${t.item?.name}</td>
        <td class="right">${Number(t.quantity).toLocaleString('en-PH')} ${t.item?.unit || ''}</td>
        <td class="right">${phpFmt(t.unitCost)}</td>
        <td class="right bold">${phpFmt(t.totalCost)}</td>
        <td class="right">${Number(t.runningStock).toLocaleString('en-PH')}</td>
        <td>${t.reference || '—'}</td>
      </tr>`;
    }).join('');

    const body = `
      <table>
        <thead><tr>
          <th>Txn No</th><th>Date</th><th>Type</th><th>SKU</th><th>Item</th>
          <th class="right">Qty</th><th class="right">Unit Cost</th><th class="right">Total Cost</th>
          <th class="right">Running Stock</th><th>Reference</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
    await printDocument('Stock Movement Log', `${txns.length} transactions`, body);
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Stock Movements</h1>
          <p className="page-subtitle">All inventory transactions · {total} records</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePrint} className="btn-secondary flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={() => setModal({})} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Movement
          </button>
        </div>
      </div>

      {/* Type Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
        {TXN_TYPES.map((t) => {
          const count = txns.filter((x) => x.type === t.value).length;
          return (
            <button key={t.value}
              onClick={() => setFilter((f) => ({ ...f, type: f.type === t.value ? '' : t.value }))}
              className={`card card-body text-left transition-all hover:shadow-md ${filter.type === t.value ? 'ring-2 ring-blue-500' : ''}`}>
              <div className="flex items-center gap-2">
                <t.icon className={`w-4 h-4 ${t.color}`} />
                <span className="text-xs font-semibold text-gray-700">{t.label}</span>
              </div>
              <p className={`text-xl font-bold mt-1 ${t.color}`}>{count}</p>
            </button>
          );
        })}
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input className="input pl-9 w-full" placeholder="Search txn#, reference…"
                value={filter.search} onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))} />
            </div>
            <select className="input w-44" value={filter.itemId}
              onChange={(e) => setFilter((f) => ({ ...f, itemId: e.target.value }))}>
              <option value="">All Items</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
            </select>
            <select className="input w-44" value={filter.type}
              onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value }))}>
              <option value="">All Types</option>
              {TXN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <input className="input w-36" type="date" value={filter.from}
              onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} />
            <input className="input w-36" type="date" value={filter.to}
              onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} />
            <button onClick={load} className="btn-secondary flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Transactions Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Txn No</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">SKU</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Item</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Qty</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Unit Cost</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Total</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase">Running Stock</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">Reference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              ) : txns.length === 0 ? (
                <tr><td colSpan={10} className="p-0">
                  <div className="px-4 py-3 text-sm text-gray-500 bg-gray-50 border-b border-gray-100">
                    {items.length === 0
                      ? 'No transactions yet, and no inventory items to add stock to. Create an item in Item Master first.'
                      : 'No movements found. Pick an item below to add stock.'}
                  </div>
                  {items.length > 0 && (
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100">
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">SKU</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Item</th>
                          <th className="px-4 py-2 text-left text-xs font-semibold text-gray-500 uppercase">Unit</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Stock</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Cost</th>
                          <th className="px-4 py-2 text-right text-xs font-semibold text-gray-500 uppercase">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {items.map((i) => (
                          <tr key={i.id} className="hover:bg-gray-50">
                            <td className="px-4 py-2.5 font-mono text-xs text-gray-500">{i.sku}</td>
                            <td className="px-4 py-2.5 font-medium text-gray-900">{i.name}</td>
                            <td className="px-4 py-2.5 text-gray-600">{i.unit}</td>
                            <td className="px-4 py-2.5 text-right text-gray-700">{Number(i.currentStock).toLocaleString('en-PH')}</td>
                            <td className="px-4 py-2.5 text-right text-gray-600">{phpFmt(i.costPrice)}</td>
                            <td className="px-4 py-2.5 text-right">
                              <button
                                onClick={() => setModal({ itemId: String(i.id), type: 'IN', unitCost: Number(i.costPrice) ? String(i.costPrice) : '' })}
                                className="btn-primary btn-sm inline-flex items-center gap-1">
                                <Plus className="w-3.5 h-3.5" /> Transactions
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </td></tr>
              ) : txns.map((t) => {
                const meta = TXN_MAP[t.type];
                return (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.txnNo}</td>
                    <td className="px-4 py-3 text-gray-700">{dateFmt(t.txnDate)}</td>
                    <td className="px-4 py-3">
                      <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-semibold ${meta?.bg} ${meta?.color}`}>
                        {meta && <meta.icon className="w-3.5 h-3.5" />}
                        {meta?.label || t.type}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.item?.sku}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">{t.item?.name}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${['IN','RETURN_IN'].includes(t.type) ? 'text-green-700' : ['OUT','RETURN_OUT'].includes(t.type) ? 'text-red-700' : 'text-blue-700'}`}>
                      {['IN','RETURN_IN'].includes(t.type) ? '+' : ['OUT','RETURN_OUT'].includes(t.type) ? '-' : '~'}
                      {Number(t.quantity).toLocaleString('en-PH')} {t.item?.unit}
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{phpFmt(t.unitCost)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">{phpFmt(t.totalCost)}</td>
                    <td className="px-4 py-3 text-right text-gray-500">{Number(t.runningStock).toLocaleString('en-PH')}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {t.reference && <span className="font-medium text-gray-700">{t.reference}</span>}
                      {t.notes && <div className="text-gray-400 mt-0.5">{t.notes}</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {modal && (
        <TxnModal
          items={items}
          initial={modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
