'use client';
import { useState } from 'react';
import { inventory as inventoryApi } from '@/lib/api';
import { phpFmt } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  ArrowUpCircle, ArrowDownCircle, SlidersHorizontal, RotateCcw, X,
} from 'lucide-react';

// Single-item "Record Stock Movement" dialog, shared by Stock Movements and the
// Inventory list. `initial` prefills the form (e.g. { itemId, unitCost }).
const today = new Date().toISOString().split('T')[0];

export const TXN_TYPES = [
  { value: 'IN',         label: 'Stock In',       icon: ArrowUpCircle,    color: 'text-green-600',  bg: 'bg-green-50',  badge: 'badge-green' },
  { value: 'OUT',        label: 'Stock Out',       icon: ArrowDownCircle,  color: 'text-red-600',    bg: 'bg-red-50',    badge: 'badge-red'   },
  { value: 'ADJUSTMENT', label: 'Adjustment',      icon: SlidersHorizontal,color: 'text-blue-600',   bg: 'bg-blue-50',   badge: 'badge-blue'  },
  { value: 'RETURN_IN',  label: 'Customer Return', icon: RotateCcw,        color: 'text-purple-600', bg: 'bg-purple-50', badge: 'badge-gray'  },
  { value: 'RETURN_OUT', label: 'Return to Supplier', icon: RotateCcw,    color: 'text-orange-600', bg: 'bg-orange-50', badge: 'badge-yellow'},
];
export const TXN_MAP = Object.fromEntries(TXN_TYPES.map((t) => [t.value, t]));

const BLANK_TXN = {
  itemId: '', type: 'IN', quantity: '', unitCost: '',
  reference: '', notes: '', txnDate: today,
};

// ── New Transaction Modal ─────────────────────────────────────────────────────
export default function TxnModal({ items, initial, onClose, onSaved }) {
  const [form, setForm] = useState({ ...BLANK_TXN, ...initial });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const selectedItem = items.find((i) => i.id === Number(form.itemId));
  const isAdjustment = form.type === 'ADJUSTMENT';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await inventoryApi.transactions.create({
        ...form,
        quantity: Number(form.quantity),
        unitCost: Number(form.unitCost) || 0,
      });
      toast.success('Transaction recorded');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-center items-start overflow-y-auto">
      <div className="bg-white w-full max-w-lg shadow-2xl flex flex-col" style={{borderRadius:'0 0 1rem 1rem',maxHeight:'88vh',animation:'topDrawerIn .28s cubic-bezier(.4,0,.2,1)'}}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <h2 className="font-bold text-gray-900">Record Stock Movement</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Type selector */}
          <div>
            <label className="label">Transaction Type <span className="text-red-500">*</span></label>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
              {TXN_TYPES.map((t) => (
                <button
                  key={t.value} type="button"
                  onClick={() => setForm((f) => ({ ...f, type: t.value }))}
                  className={`flex flex-col items-center gap-1 p-2.5 border-2 rounded-lg text-xs font-medium transition-all ${
                    form.type === t.value
                      ? `border-blue-500 ${t.bg} ${t.color}`
                      : 'border-gray-100 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  <t.icon className="w-4 h-4" />
                  {t.label}
                </button>
              ))}
            </div>
          </div>

          {/* Item */}
          <div>
            <label className="label">Item <span className="text-red-500">*</span></label>
            <select className="input w-full" value={form.itemId} onChange={set('itemId')} required>
              <option value="">— Select Item —</option>
              {items.map((i) => <option key={i.id} value={i.id}>{i.sku} — {i.name}</option>)}
            </select>
            {selectedItem && (
              <p className="text-xs text-gray-500 mt-1">
                Current stock: <strong className="text-gray-800">{Number(selectedItem.currentStock).toLocaleString('en-PH')} {selectedItem.unit}</strong>
                {' · '}Cost: {phpFmt(selectedItem.costPrice)}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">
                {isAdjustment ? 'New Stock Count' : 'Quantity'} <span className="text-red-500">*</span>
              </label>
              <input className="input w-full" type="number" min="0" step="0.001"
                value={form.quantity} onChange={set('quantity')} required placeholder="0" />
              {isAdjustment && selectedItem && (
                <p className="text-xs text-gray-500 mt-1">Enter the actual count; difference will be computed</p>
              )}
            </div>
            <div>
              <label className="label">Unit Cost</label>
              <input className="input w-full" type="number" min="0" step="0.01"
                value={form.unitCost} onChange={set('unitCost')} placeholder="0.00" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Date</label>
              <input className="input w-full" type="date" value={form.txnDate} onChange={set('txnDate')} />
            </div>
            <div>
              <label className="label">Reference</label>
              <input className="input w-full" value={form.reference} onChange={set('reference')} placeholder="PO#, INV#, etc." />
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea className="input w-full" rows={2} value={form.notes} onChange={set('notes')} />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : 'Record Transaction'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
