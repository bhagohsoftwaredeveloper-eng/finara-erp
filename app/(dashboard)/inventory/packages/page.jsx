'use client';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { inventory as inventoryApi, accounts as accountsApi } from '@/lib/api';
import { formatCurrency } from '@/lib/auth';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput from '@/components/NumberInput';
import toast from 'react-hot-toast';
import { Plus, Search, X, Pencil, Trash2, Package, Check, RefreshCw } from 'lucide-react';

const VAT_CODES = ['VAT', 'ZERO', 'EXEMPT'];
const qtyFmt = (n) => Number(n || 0).toLocaleString('en-PH');
const blank = () => ({ id: null, name: '', description: '', price: '', accountId: '', vatCode: 'VAT', items: [] });

// ── Create / edit drawer ─────────────────────────────────────────
function PackageDrawer({ pkg, items: loadedItems, accounts, onClose, onSaved }) {
  const [form, setForm] = useState(() => (pkg
    ? {
        id: pkg.id, name: pkg.name, description: pkg.description || '', price: String(pkg.price),
        accountId: pkg.accountId ? String(pkg.accountId) : '', vatCode: pkg.vatCode,
        items: pkg.items.map((pi) => ({ itemId: pi.itemId, quantity: String(pi.quantity) })),
      }
    : blank()));
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  // Items quick-added here are saved to Inventory straight away and merged into
  // the list so they can be picked without reloading.
  const [created, setCreated] = useState([]);
  const items = useMemo(() => [...loadedItems, ...created], [loadedItems, created]);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState({ name: '', sellingPrice: '', costPrice: '', unit: 'pcs' });
  const [quickSaving, setQuickSaving] = useState(false);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const picked = new Set(form.items.map((i) => i.itemId));
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const shown = items.filter((i) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return i.name.toLowerCase().includes(s) || i.sku.toLowerCase().includes(s);
  });

  const addItem = (item) => {
    if (picked.has(item.id)) return;
    setForm((f) => ({ ...f, items: [...f.items, { itemId: item.id, quantity: '1' }] }));
  };
  const setQty = (itemId, quantity) =>
    setForm((f) => ({ ...f, items: f.items.map((i) => (i.itemId === itemId ? { ...i, quantity } : i)) }));
  const removeItem = (itemId) =>
    setForm((f) => ({ ...f, items: f.items.filter((i) => i.itemId !== itemId) }));

  const openQuick = () => {
    setQuick((q) => ({ ...q, name: search.trim() || q.name }));
    setQuickOpen(true);
  };

  const quickAdd = async () => {
    const name = quick.name.trim();
    if (!name) return toast.error('Item name is required');
    const existing = items.find((i) => i.name.toLowerCase() === name.toLowerCase());
    if (existing) return toast.error(`"${existing.name}" is already in Inventory — pick it from the list`);
    setQuickSaving(true);
    try {
      const { data } = await inventoryApi.items.create({
        name,
        sellingPrice: Number(quick.sellingPrice) || 0,
        costPrice: Number(quick.costPrice) || 0,
        unit: quick.unit.trim() || 'pcs',
      });
      setCreated((c) => [...c, data]);
      setForm((f) => ({ ...f, items: [...f.items, { itemId: data.id, quantity: '1' }] }));
      setQuick({ name: '', sellingPrice: '', costPrice: '', unit: 'pcs' });
      setQuickOpen(false);
      setSearch('');
      toast.success(`${data.name} saved to Inventory and added to the package`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not add item');
    } finally {
      setQuickSaving(false);
    }
  };

  const submit = async () => {
    if (!form.name.trim()) return toast.error('Package name is required');
    if (form.price === '' || Number(form.price) < 0) return toast.error('Enter the package price');
    if (!form.items.length) return toast.error('Add at least one item to the package');
    if (form.items.some((i) => !(Number(i.quantity) > 0))) return toast.error('Every item needs a quantity greater than 0');
    setSaving(true);
    try {
      const payload = {
        name: form.name, description: form.description, price: Number(form.price),
        accountId: form.accountId ? Number(form.accountId) : null, vatCode: form.vatCode,
        items: form.items.map((i) => ({ itemId: i.itemId, quantity: Number(i.quantity) })),
      };
      if (form.id) await inventoryApi.packages.update(form.id, payload);
      else await inventoryApi.packages.create(payload);
      toast.success(form.id ? 'Package updated' : 'Package created');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to save package');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-center items-start overflow-y-auto">
      <div className="bg-white w-full max-w-6xl shadow-2xl flex flex-col"
        style={{ borderRadius: '0 0 1rem 1rem', height: '92vh', animation: 'topDrawerIn .28s cubic-bezier(.4,0,.2,1)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <h2 className="font-bold text-gray-900 text-lg">{form.id ? 'Edit Package' : 'New Package'}</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 flex-1 min-h-0 overflow-hidden">
          {/* Left: every inventory item, pick to add */}
          <div className="lg:col-span-4 border-b lg:border-b-0 lg:border-r flex flex-col min-h-0 max-h-72 lg:max-h-none">
            <div className="p-3 border-b flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input className="input pl-9 w-full" placeholder="Search items…" value={search}
                  onChange={(e) => setSearch(e.target.value)} />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <p className="text-[11px] text-gray-400">{shown.length} of {items.length} items. Click an item to add it.</p>
                <button type="button" onClick={quickOpen ? () => setQuickOpen(false) : openQuick}
                  className="text-xs font-medium text-blue-700 hover:text-blue-800 flex items-center gap-1 shrink-0">
                  <Plus className="w-3.5 h-3.5" /> Quick Add
                </button>
              </div>
              {quickOpen && (
                <div className="mt-2 rounded-xl border border-blue-200 bg-blue-50 p-2.5 space-y-2">
                  <div>
                    <label className="label">Item name *</label>
                    <input className="input w-full" autoFocus value={quick.name} placeholder="e.g. 2x3ft Tarpaulin"
                      onChange={(e) => setQuick((q) => ({ ...q, name: e.target.value }))} />
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <label className="label">Price</label>
                      <NumberInput className="input w-full text-right" value={quick.sellingPrice} placeholder="0.00"
                        onChange={(v) => setQuick((q) => ({ ...q, sellingPrice: v }))} />
                    </div>
                    <div>
                      <label className="label">Cost</label>
                      <NumberInput className="input w-full text-right" value={quick.costPrice} placeholder="0.00"
                        onChange={(v) => setQuick((q) => ({ ...q, costPrice: v }))} />
                    </div>
                    <div>
                      <label className="label">Unit</label>
                      <input className="input w-full" value={quick.unit}
                        onChange={(e) => setQuick((q) => ({ ...q, unit: e.target.value }))} />
                    </div>
                  </div>
                  <p className="text-[11px] text-blue-700">Saved to Inventory with 0 stock and added to this package.</p>
                  <div className="flex justify-end gap-2">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setQuickOpen(false)}>Cancel</button>
                    <button type="button" className="btn-primary btn-sm" disabled={quickSaving} onClick={quickAdd}>
                      {quickSaving ? 'Saving…' : 'Save to Inventory & Add'}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <div className="overflow-y-auto flex-1 divide-y divide-gray-100">
              {shown.length === 0 && (
                <div className="p-4 text-center">
                  <p className="text-sm text-gray-400">No items found</p>
                  {!quickOpen && (
                    <button type="button" onClick={openQuick} className="mt-2 text-sm font-medium text-blue-700 hover:underline">
                      {search.trim() ? `Add “${search.trim()}” to Inventory` : 'Quick add an item'}
                    </button>
                  )}
                </div>
              )}
              {shown.map((i) => (
                <button key={i.id} type="button" onClick={() => addItem(i)} disabled={picked.has(i.id)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 disabled:bg-gray-50 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-900 truncate">{i.name}</div>
                    <div className="text-[11px] text-gray-400 font-mono">{i.sku} · {qtyFmt(i.currentStock)} {i.unit} on hand</div>
                  </div>
                  {picked.has(i.id)
                    ? <Check className="w-4 h-4 text-green-600 shrink-0" />
                    : <Plus className="w-4 h-4 text-blue-600 shrink-0" />}
                </button>
              ))}
            </div>
          </div>

          {/* Right: package details + what is inside */}
          <div className="lg:col-span-8 overflow-y-auto p-6 space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="md:col-span-2">
                <label className="label">Package name *</label>
                <input className="input w-full" value={form.name} onChange={set('name')} placeholder="e.g. Starter Signage Kit" />
              </div>
              <div>
                <label className="label">Package price (overall) *</label>
                <NumberInput className="input w-full text-right" value={form.price} placeholder="0.00"
                  onChange={(v) => setForm((f) => ({ ...f, price: v }))} />
                <p className="text-[11px] text-gray-400 mt-1">Invoices show this one price, not each item&apos;s price.</p>
              </div>
              <div>
                <label className="label">VAT</label>
                <select className="input w-full" value={form.vatCode} onChange={set('vatCode')}>
                  {VAT_CODES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="label">Revenue account</label>
                <AccountSelect value={form.accountId}
                  onChange={(id) => setForm((f) => ({ ...f, accountId: id }))}
                  accounts={accounts.filter((a) => a.accountType === 'REVENUE')}
                  placeholder="-- select revenue account (used on invoices) --" />
              </div>
              <div className="md:col-span-2">
                <label className="label">Description</label>
                <input className="input w-full" value={form.description} onChange={set('description')} placeholder="Optional" />
              </div>
            </div>

            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">
                What&apos;s inside <span className="text-gray-400 font-normal">({form.items.length} item{form.items.length === 1 ? '' : 's'})</span>
              </h3>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Item</th>
                      <th className="text-left px-3 py-2">SKU</th>
                      <th className="text-right px-3 py-2 w-36">Quantity</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {form.items.length === 0 && (
                      <tr><td colSpan={4} className="px-3 py-10 text-center text-gray-400">
                        Pick items from the list on the left.
                      </td></tr>
                    )}
                    {form.items.map((line) => {
                      const item = byId.get(line.itemId);
                      return (
                        <tr key={line.itemId}>
                          <td className="px-3 py-2 font-medium text-gray-900">
                            {item ? item.name : `Item #${line.itemId}`}
                            {!item && <span className="ml-2 text-xs text-amber-600">(inactive or missing)</span>}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-gray-500">{item?.sku}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5">
                              <NumberInput decimals={3} className="input text-right w-full" value={line.quantity}
                                onChange={(v) => setQty(line.itemId, v)} />
                              <span className="text-xs text-gray-400 w-8">{item?.unit}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2">
                            <button type="button" onClick={() => removeItem(line.itemId)} className="p-1.5 text-gray-400 hover:text-red-600">
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
          </div>
        </div>

        <div className="px-6 py-3 border-t bg-gray-50 flex items-center justify-end gap-2 flex-shrink-0"
          style={{ borderRadius: '0 0 1rem 1rem' }}>
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={submit} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : (form.id ? 'Save Changes' : 'Create Package')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────
export default function PackagesPage() {
  const [packages, setPackages] = useState([]);
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [drawer, setDrawer] = useState(null); // null | { pkg } (pkg null = new)

  // Each list loads on its own: items and accounts must still appear (so a
  // package can be built) even if the packages list itself fails.
  const load = useCallback(async () => {
    setLoading(true);
    const [p, i, a] = await Promise.allSettled([
      inventoryApi.packages.list(),
      inventoryApi.items.list({ isActive: 'true' }),
      accountsApi.list({ active: 'true' }),
    ]);
    if (p.status === 'fulfilled') setPackages(p.value.data);
    else toast.error(p.reason?.response?.data?.error || 'Failed to load packages');
    if (i.status === 'fulfilled') setItems(i.value.data);
    else toast.error('Failed to load inventory items');
    if (a.status === 'fulfilled') setAccounts(a.value.data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const shown = packages.filter((p) => {
    if (!showInactive && !p.isActive) return false;
    if (!search.trim()) return true;
    return p.name.toLowerCase().includes(search.toLowerCase());
  });

  const deactivate = async (p) => {
    if (!confirm(`Deactivate "${p.name}"? Past invoices keep their contents.`)) return;
    try {
      await inventoryApi.packages.remove(p.id);
      toast.success('Package deactivated');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  const reactivate = async (p) => {
    try {
      await inventoryApi.packages.update(p.id, {
        name: p.name, description: p.description, price: Number(p.price), accountId: p.accountId,
        vatCode: p.vatCode, isActive: true,
        items: p.items.map((pi) => ({ itemId: pi.itemId, quantity: Number(pi.quantity) })),
      });
      toast.success('Package reactivated');
      load();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Packages</h1>
          <p className="page-subtitle">Bundle items and sell them at one overall price</p>
        </div>
        <div className="flex gap-2">
          <button onClick={load} className="btn-secondary flex items-center gap-2">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button onClick={() => setDrawer({ pkg: null })} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> New Package
          </button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9 w-full" placeholder="Search packages…" value={search}
              onChange={(e) => setSearch(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-600">
            <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Show inactive
          </label>
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-3 text-left">Package</th>
                <th className="px-4 py-3 text-left">Contents</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3 text-center">VAT</th>
                <th className="px-4 py-3 text-center">Status</th>
                <th className="px-4 py-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              ) : shown.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-14 text-center text-gray-400">
                  <Package className="w-10 h-10 mx-auto mb-2 text-gray-300" />
                  <p>No packages yet. Click <strong>New Package</strong> to bundle items.</p>
                </td></tr>
              ) : shown.map((p) => (
                <tr key={p.id} className={`hover:bg-gray-50 ${p.isActive ? '' : 'opacity-60'}`}>
                  <td className="px-4 py-3 align-top">
                    <div className="font-medium text-gray-900">{p.name}</div>
                    {p.description && <div className="text-xs text-gray-400">{p.description}</div>}
                  </td>
                  <td className="px-4 py-3 align-top">
                    <ul className="space-y-0.5">
                      {p.items.map((pi) => (
                        <li key={pi.id} className="text-xs text-gray-600">
                          {qtyFmt(pi.quantity)} {pi.item.unit} × {pi.item.name}
                        </li>
                      ))}
                    </ul>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900 align-top">{formatCurrency(p.price)}</td>
                  <td className="px-4 py-3 text-center align-top"><span className="badge badge-blue">{p.vatCode}</span></td>
                  <td className="px-4 py-3 text-center align-top">
                    <span className={`badge ${p.isActive ? 'badge-green' : 'badge-gray'}`}>{p.isActive ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="px-4 py-3 align-top">
                    <div className="flex justify-center gap-1.5">
                      <button className="btn-secondary btn-sm" onClick={() => setDrawer({ pkg: p })} title="Edit">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      {p.isActive
                        ? <button className="btn-danger btn-sm" onClick={() => deactivate(p)} title="Deactivate"><Trash2 className="w-3.5 h-3.5" /></button>
                        : <button className="btn-secondary btn-sm" onClick={() => reactivate(p)}>Reactivate</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {drawer && (
        <PackageDrawer
          pkg={drawer.pkg}
          items={items}
          accounts={accounts}
          onClose={() => setDrawer(null)}
          onSaved={() => { setDrawer(null); load(); }}
        />
      )}
    </div>
  );
}
