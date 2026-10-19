'use client';
import { useState, useEffect, useMemo } from 'react';
import { inventory as inventoryApi } from '@/lib/api';
import { phpFmt } from '@/lib/print';
import { MOVEMENT_TYPES, newStockFor, planRow } from '@/lib/bulkStock';
import toast from 'react-hot-toast';
import { X, Search, Plus, Trash2, Check } from 'lucide-react';

const today = new Date().toISOString().split('T')[0];
const qtyFmt = (n) => Number(n || 0).toLocaleString('en-PH');

// Top drawer: pick items on the left, review current figures in the middle and
// enter the new ones on the right. What a quantity means depends on the type.
export default function BulkStockMovementDrawer({ items, onClose, onDone }) {
  const [type, setType] = useState('IN');
  const [txnDate, setTxnDate] = useState(today);
  const [reference, setReference] = useState('');
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [rows, setRows] = useState([]); // { itemId, qty, cost, price }
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({}); // itemId -> message from a failed post

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const picked = new Set(rows.map((r) => r.itemId));
  const typeMeta = MOVEMENT_TYPES.find((t) => t.value === type);

  const results = items.filter((i) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return i.name.toLowerCase().includes(s) || i.sku.toLowerCase().includes(s);
  });

  const toRow = (i) => ({ itemId: i.id, qty: '', cost: String(i.costPrice), price: String(i.sellingPrice) });
  const addItem = (item) => {
    if (picked.has(item.id)) return;
    setRows((r) => [...r, toRow(item)]);
  };
  const addAllShown = () => {
    setRows((r) => {
      const have = new Set(r.map((x) => x.itemId));
      return [...r, ...results.filter((i) => !have.has(i.id)).map(toRow)];
    });
  };
  const update = (itemId, patch) => setRows((r) => r.map((x) => (x.itemId === itemId ? { ...x, ...patch } : x)));
  const remove = (itemId) => setRows((r) => r.filter((x) => x.itemId !== itemId));

  const plans = rows
    .filter((r) => byId.has(r.itemId))
    .map((r) => ({ row: r, item: byId.get(r.itemId), plan: planRow(type, byId.get(r.itemId), r) }));
  const actionable = plans.filter((p) => !p.plan.error && !p.plan.nothing);
  const hasError = plans.some((p) => p.plan.error);
  const movementValue = actionable.reduce((s, p) => s + (p.plan.moves ? Math.abs(p.plan.delta) * p.plan.cost : 0), 0);

  const submit = async () => {
    if (!actionable.length) return toast.error('Enter a quantity, cost or selling price for at least one item');
    if (hasError) return toast.error('Fix the highlighted rows first');
    setSaving(true);
    setErrors({});
    const failed = {};
    let ok = 0;
    // One item at a time through the same endpoints as a single movement, so
    // GL posting and stock rules are identical. A failed line does not block the
    // others; it stays in the batch with its error.
    for (const { row, item, plan } of actionable) {
      try {
        if (plan.moves) {
          await inventoryApi.transactions.create({
            itemId: item.id, type, quantity: plan.qty, unitCost: plan.cost,
            reference, notes, txnDate,
          });
        }
        if (plan.updateItem) {
          await inventoryApi.items.update(item.id, {
            ...(plan.costChanged && { costPrice: plan.cost }),
            ...(plan.priceChanged && { sellingPrice: plan.price }),
          });
        }
        ok += 1;
        setRows((r) => r.filter((x) => x.itemId !== row.itemId));
      } catch (err) {
        failed[item.id] = err.response?.data?.error || 'Failed';
      }
    }
    setSaving(false);
    setErrors(failed);
    const failCount = Object.keys(failed).length;
    if (ok) toast.success(`${ok} item${ok > 1 ? 's' : ''} updated`);
    if (failCount) toast.error(`${failCount} item${failCount > 1 ? 's' : ''} failed — see the rows`);
    if (ok) onDone({ closed: failCount === 0 });
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-center items-start overflow-y-auto">
      <div className="bg-white w-full max-w-7xl shadow-2xl flex flex-col"
        style={{ borderRadius: '0 0 1rem 1rem', height: '94vh', animation: 'topDrawerIn .28s cubic-bezier(.4,0,.2,1)' }}>
        <div className="flex items-start justify-between px-6 py-4 border-b flex-shrink-0">
          <div>
            <h2 className="font-bold text-gray-900 text-lg">Bulk Stock Movement</h2>
            <p className="text-xs text-gray-500 mt-0.5">{typeMeta.hint}</p>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {/* Type + details */}
        <div className="px-6 py-3 border-b flex-shrink-0 space-y-3">
          <div className="flex flex-wrap gap-2">
            {MOVEMENT_TYPES.map((t) => (
              <button key={t.value} type="button" onClick={() => setType(t.value)}
                className={`px-3 py-1.5 rounded-lg border-2 text-sm font-medium transition-colors ${
                  type === t.value ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="label">Date</label>
              <input type="date" className="input w-full" value={txnDate} onChange={(e) => setTxnDate(e.target.value)} />
            </div>
            <div>
              <label className="label">Reference</label>
              <input className="input w-full" value={reference} placeholder="PO#, DR#, count sheet…"
                onChange={(e) => setReference(e.target.value)} />
            </div>
            <div>
              <label className="label">Notes</label>
              <input className="input w-full" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        </div>

        {/* Three columns: items | current | new */}
        <div className="grid grid-cols-1 lg:grid-cols-4 flex-1 min-h-0 overflow-hidden">
          {/* Items (25%) */}
          <div className="lg:col-span-1 border-b lg:border-b-0 lg:border-r flex flex-col min-h-0 max-h-72 lg:max-h-none">
            <div className="p-3 border-b flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input className="input pl-9 w-full" placeholder="Search items…" autoFocus
                  value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button type="button" onClick={addAllShown} disabled={!results.length}
                className="text-xs text-blue-600 hover:underline mt-2 disabled:text-gray-300">
                Add all {search.trim() ? 'shown ' : ''}({results.length})
              </button>
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
              {results.length === 0 && <p className="p-4 text-sm text-gray-400 text-center">No items found</p>}
              {results.map((i) => (
                <button key={i.id} type="button" onClick={() => addItem(i)} disabled={picked.has(i.id)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 disabled:bg-gray-50 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{i.name}</div>
                    <div className="text-[11px] text-gray-400 font-mono">{i.sku} · {qtyFmt(i.currentStock)} {i.unit}</div>
                  </div>
                  {picked.has(i.id)
                    ? <Check className="w-4 h-4 text-green-600 shrink-0" />
                    : <Plus className="w-4 h-4 text-blue-600 shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {/* Current + New (75%) */}
          <div className="lg:col-span-3 overflow-auto min-h-0">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white z-10">
                <tr className="text-[11px] uppercase tracking-wide">
                  <th rowSpan={2} className="px-3 py-2 text-left text-gray-500 align-bottom">Item</th>
                  <th colSpan={3} className="px-3 py-1.5 text-center text-gray-500 bg-gray-50 border-x border-gray-200">Current</th>
                  <th colSpan={3} className="px-3 py-1.5 text-center text-blue-700 bg-blue-50 border-r border-blue-100">New</th>
                  <th rowSpan={2} className="w-8" />
                </tr>
                <tr className="text-[11px] uppercase tracking-wide border-b border-gray-200">
                  <th className="px-2 py-1.5 text-right text-gray-500 bg-gray-50 border-l border-gray-200">Qty</th>
                  <th className="px-2 py-1.5 text-right text-gray-500 bg-gray-50">Cost</th>
                  <th className="px-2 py-1.5 text-right text-gray-500 bg-gray-50 border-r border-gray-200">Price</th>
                  <th className="px-2 py-1.5 text-right text-blue-700 bg-blue-50">{typeMeta.qtyLabel}</th>
                  <th className="px-2 py-1.5 text-right text-blue-700 bg-blue-50">Cost</th>
                  <th className="px-2 py-1.5 text-right text-blue-700 bg-blue-50 border-r border-blue-100">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {plans.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-16 text-center text-gray-400">
                    Pick items from the list to add them to this movement.
                  </td></tr>
                )}
                {plans.map(({ row, item, plan }) => {
                  const after = newStockFor(type, item.currentStock, row.qty);
                  const rowErr = plan.error || errors[item.id];
                  return (
                    <tr key={row.itemId} className={rowErr ? 'bg-red-50' : ''}>
                      <td className="px-3 py-2 align-top">
                        <div className="font-medium text-gray-900">{item.name}</div>
                        <div className="text-[11px] text-gray-400 font-mono">{item.sku} · {item.unit}</div>
                        {rowErr && <div className="text-[11px] text-red-600 mt-0.5">{rowErr}</div>}
                      </td>
                      <td className="px-2 py-2 text-right text-gray-700 align-top">{qtyFmt(item.currentStock)}</td>
                      <td className="px-2 py-2 text-right text-gray-500 align-top">{phpFmt(item.costPrice)}</td>
                      <td className="px-2 py-2 text-right text-gray-500 align-top">{phpFmt(item.sellingPrice)}</td>
                      <td className="px-2 py-2 align-top w-36">
                        <input type="number" min="0" step="0.001" className="input w-full text-right" placeholder="0"
                          value={row.qty} onChange={(e) => update(row.itemId, { qty: e.target.value })} />
                        {after !== null && (
                          <div className={`text-[11px] text-right mt-0.5 ${after < 0 ? 'text-amber-600' : 'text-gray-500'}`}>
                            → {qtyFmt(after)} {item.unit}{after < 0 ? ' (negative)' : ''}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2 align-top w-28">
                        <input type="number" min="0" step="0.01" className="input w-full text-right"
                          value={row.cost} onChange={(e) => update(row.itemId, { cost: e.target.value })} />
                      </td>
                      <td className="px-2 py-2 align-top w-28">
                        <input type="number" min="0" step="0.01" className="input w-full text-right"
                          value={row.price} onChange={(e) => update(row.itemId, { price: e.target.value })} />
                      </td>
                      <td className="px-1 py-2 align-top">
                        <button type="button" onClick={() => remove(row.itemId)} className="p-1.5 text-gray-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="px-6 py-3 border-t bg-gray-50 flex flex-wrap items-center justify-between gap-3 flex-shrink-0"
          style={{ borderRadius: '0 0 1rem 1rem' }}>
          <div className="text-sm text-gray-600">
            {rows.length} item{rows.length === 1 ? '' : 's'} · {actionable.length} with changes
            {movementValue > 0 && <> · Movement value <strong className="text-gray-900">{phpFmt(movementValue)}</strong></>}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="button" onClick={submit} disabled={saving || !actionable.length} className="btn-primary">
              {saving ? 'Posting…' : `Post ${typeMeta.label}${actionable.length ? ` (${actionable.length})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
