'use client';
import { useState, useEffect, useCallback } from 'react';
import { cashSales as csApi, accounts as acctApi, inventory as invApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Search, Ban, Printer, X } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import AccountSelect from '@/components/ui/AccountSelect';
import NumberInput from '@/components/NumberInput';

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Check', 'GCash', 'Maya', 'Credit Card', 'Online'];
const VAT_CODES = ['VAT', 'ZERO', 'EXEMPT'];
const STATUS_BADGE = { ACTIVE: 'badge-green', VOID: 'badge-gray' };

function emptyForm() {
  return {
    saleDate: new Date().toISOString().split('T')[0],
    buyerName: '', accountId: '',
    vatCode: 'VAT', paymentMethod: 'Cash', notes: '',
  };
}

// ─── New Cash Sale Modal ────────────────────────────────────────
const CATEGORY_ALL = 'All';

function StockBadge({ item }) {
  if (item.isOutOfStock) return <span className="badge badge-gray text-xs">Out of stock</span>;
  if (item.isLowStock) return <span className="badge badge-yellow text-xs">Low stock</span>;
  return <span className="badge badge-green text-xs">{Number(item.currentStock)} {item.unit}</span>;
}

function ItemTile({ item, selected, onSelect }) {
  const disabled = item.isOutOfStock;
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onSelect(item)}
      className={`text-left rounded-xl border p-3 transition ${
        disabled ? 'opacity-50 cursor-not-allowed bg-gray-50'
        : selected ? 'border-green-500 ring-2 ring-green-200 bg-green-50'
        : 'border-gray-200 hover:border-green-400'
      }`}
    >
      <p className="text-sm font-semibold text-gray-900 truncate">{item.name}</p>
      <p className="text-xs text-gray-400 font-mono">{item.sku}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-sm font-semibold text-green-700">{formatCurrency(item.sellingPrice)}</span>
        <StockBadge item={item} />
      </div>
    </button>
  );
}

function NewSaleModal({ accounts, items, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm());
  const [cart, setCart] = useState([]);
  const [itemSearch, setItemSearch] = useState('');
  const [category, setCategory] = useState(CATEGORY_ALL);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const categories = [CATEGORY_ALL, ...new Set(items.map((it) => it.category?.name).filter(Boolean))];

  const filteredItems = items.filter((it) => {
    if (category !== CATEGORY_ALL && it.category?.name !== category) return false;
    if (!itemSearch.trim()) return true;
    const q = itemSearch.toLowerCase();
    return it.name.toLowerCase().includes(q) || it.sku.toLowerCase().includes(q);
  });

  const addItem = (item) => {
    setCart((c) => {
      const existing = c.find((l) => l.itemId === item.id);
      if (existing) {
        const max = Math.max(1, Math.floor(Number(item.currentStock)) || 1);
        return c.map((l) => l.itemId === item.id ? { ...l, quantity: Math.min(l.quantity + 1, max) } : l);
      }
      return [...c, {
        key: `item-${item.id}`, itemId: item.id, description: item.name,
        quantity: 1, unitPrice: Number(item.sellingPrice), stockCap: Number(item.currentStock),
      }];
    });
  };

  const addCustomLine = () => {
    setCart((c) => [...c, {
      key: `custom-${Date.now()}-${c.length}`, itemId: null, description: '',
      quantity: 1, unitPrice: 0, stockCap: Infinity,
    }]);
  };

  const updateLine = (key, patch) => setCart((c) => c.map((l) => l.key === key ? { ...l, ...patch } : l));
  const removeLine = (key) => setCart((c) => c.filter((l) => l.key !== key));

  const changeQty = (key, next) => {
    setCart((c) => c.map((l) => {
      if (l.key !== key) return l;
      const max = l.stockCap === Infinity ? Infinity : Math.max(1, Math.floor(l.stockCap) || 1);
      return { ...l, quantity: Math.max(1, Math.min(next, max)) };
    }));
  };

  const lineTotal = (l) => Math.round(Number(l.quantity) * Number(l.unitPrice) * 100) / 100;
  const subtotal = cart.reduce((s, l) => s + lineTotal(l), 0);
  const vat = form.vatCode === 'VAT' ? Math.round(subtotal * 0.12 * 100) / 100 : 0;
  const total = Math.round((subtotal + vat) * 100) / 100;

  const submit = async (e) => {
    e.preventDefault();
    if (cart.length === 0) return toast.error('Add at least one item');
    if (cart.some((l) => !l.description.trim() || Number(l.quantity) <= 0)) {
      return toast.error('Every line needs a description and a quantity greater than 0');
    }
    if (!form.accountId) return toast.error('Select a revenue account');
    setSaving(true);
    try {
      const payload = {
        ...form,
        items: cart.map((l) => ({
          itemId: l.itemId || undefined,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
        })),
      };
      const res = await csApi.create(payload);
      if (res.data.posted) {
        toast.success('Cash sale recorded');
      } else {
        toast.error('Recorded, but GL posting failed — check Audit Trail', { duration: 6000 });
      }
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to record cash sale');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-5xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">New Cash Sale</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input className="input pl-9" placeholder="Search item name or SKU..."
                    value={itemSearch} onChange={(e) => setItemSearch(e.target.value)} />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {categories.map((c) => (
                    <button key={c} type="button" onClick={() => setCategory(c)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium ${category === c ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                      {c}
                    </button>
                  ))}
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto pr-1">
                  {filteredItems.length === 0 ? (
                    <p className="col-span-full text-center text-sm text-gray-400 py-6">No items match.</p>
                  ) : filteredItems.map((it) => (
                    <ItemTile key={it.id} item={it} selected={cart.some((l) => l.itemId === it.id)} onSelect={addItem} />
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">Sale Date *</label>
                    <input type="date" className="input" required value={form.saleDate} onChange={set('saleDate')} />
                  </div>
                  <div className="form-group">
                    <label className="label">Buyer Name</label>
                    <input className="input" value={form.buyerName} onChange={set('buyerName')} placeholder="Walk-in" />
                  </div>
                </div>
                <div className="form-group">
                  <label className="label">Revenue Account *</label>
                  <AccountSelect
                    value={form.accountId}
                    onChange={(id) => setForm((f) => ({ ...f, accountId: id }))}
                    accounts={accounts.filter((a) => a.accountType === 'REVENUE')}
                    placeholder="-- select revenue account --"
                  />
                </div>
                <div className="form-grid">
                  <div className="form-group">
                    <label className="label">VAT Code</label>
                    <select className="input" value={form.vatCode} onChange={set('vatCode')}>
                      {VAT_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="form-group">
                    <label className="label">Payment Method *</label>
                    <select className="input" value={form.paymentMethod} onChange={set('paymentMethod')}>
                      {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="label">Notes</label>
                  <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
                </div>
              </div>
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Items</label>
                <button type="button" onClick={addCustomLine} className="text-xs font-medium text-green-700 hover:text-green-800 flex items-center gap-1">
                  <Plus className="w-3.5 h-3.5" /> Add custom line
                </button>
              </div>
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                    <tr>
                      <th className="text-left px-3 py-2">Item / Description</th>
                      <th className="text-center px-3 py-2 w-32">Qty</th>
                      <th className="text-right px-3 py-2 w-28">Price</th>
                      <th className="text-right px-3 py-2 w-28">Total</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {cart.length === 0 ? (
                      <tr><td colSpan={5} className="text-center py-6 text-gray-400">No items yet — tap a tile above or add a custom line.</td></tr>
                    ) : cart.map((l) => (
                      <tr key={l.key} className="border-t border-gray-100">
                        <td className="px-3 py-2">
                          {l.itemId ? (
                            <span className="font-medium text-gray-900">{l.description}</span>
                          ) : (
                            <input className="input" placeholder="Description" value={l.description}
                              onChange={(e) => updateLine(l.key, { description: e.target.value })} />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-center border border-gray-300 rounded-lg overflow-hidden w-fit mx-auto">
                            <button type="button" onClick={() => changeQty(l.key, l.quantity - 1)} className="px-2 py-1 text-gray-600 hover:bg-gray-100">−</button>
                            <span className="px-2 text-sm font-semibold">{l.quantity}</span>
                            <button type="button" onClick={() => changeQty(l.key, l.quantity + 1)} className="px-2 py-1 text-gray-600 hover:bg-gray-100">+</button>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <NumberInput className="input text-right" value={String(l.unitPrice)}
                            onChange={(v) => updateLine(l.key, { unitPrice: Number(v) || 0 })} />
                        </td>
                        <td className="px-3 py-2 text-right font-semibold">{formatCurrency(lineTotal(l))}</td>
                        <td className="px-3 py-2">
                          <button type="button" onClick={() => removeLine(l.key)} className="text-gray-400 hover:text-red-600">
                            <X className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {cart.length > 0 && (
                <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm flex justify-end gap-6 mt-2">
                  <span className="text-gray-500">Subtotal: {formatCurrency(subtotal)}</span>
                  <span className="text-gray-500">VAT: {formatCurrency(vat)}</span>
                  <span className="font-semibold">Total: {formatCurrency(total)}</span>
                </div>
              )}
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving...' : 'Record Sale'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Print a cash sale receipt ───────────────────────────────────
async function printCashSale(sale) {
  const hasItems = Array.isArray(sale.items) && sale.items.length > 0;
  const rows = hasItems
    ? sale.items.map((it) => `
        <tr>
          <td>${it.description}</td>
          <td class="right">${Number(it.quantity)}</td>
          <td class="right">${phpFmt(it.unitPrice)}</td>
          <td class="right bold">${phpFmt(it.amount)}</td>
        </tr>`).join('')
    : `
        <tr>
          <td>${sale.description}</td>
          <td class="right">1</td>
          <td class="right">${phpFmt(sale.subtotal)}</td>
          <td class="right bold">${phpFmt(sale.subtotal)}</td>
        </tr>`;

  const body = `
    <div class="info-grid" style="grid-template-columns:repeat(2,1fr);">
      <div class="info-box"><div class="info-lbl">Buyer</div><div class="info-val">${sale.buyerName || 'Walk-in'}</div></div>
      <div class="info-box"><div class="info-lbl">Payment Method</div><div class="info-val">${sale.paymentMethod}</div></div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="right">Qty</th><th class="right">Price</th><th class="right">Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div style="text-align:right;margin-top:8px;">
      <p class="small">Subtotal: ${phpFmt(sale.subtotal)}</p>
      <p class="small">VAT: ${phpFmt(sale.vatAmount)}</p>
      <p class="bold">Total: ${phpFmt(sale.totalAmount)}</p>
    </div>
    <p class="small gray" style="margin-top:10px;">Not a BIR-registered sales invoice — internal record only.</p>`;
  await printDocument('Cash Sale Receipt', sale.saleNo, body);
}

// ─── Main Page ───────────────────────────────────────────────────
export default function CashSalesPage() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState([]);
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    csApi.list({ search, limit: 100 })
      .then((r) => { setRows(r.data.data); setTotal(r.data.total); })
      .catch(() => toast.error('Failed to load cash sales'))
      .finally(() => setLoading(false));
  }, [search]);

  const loadItems = useCallback(() => {
    invApi.items.list({ limit: 500 })
      .then((r) => setItems(r.data.data || r.data || []))
      .catch(() => setItems([]));
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { acctApi.list({ active: true }).then((r) => setAccounts(r.data)).catch(() => {}); }, []);
  useEffect(() => { loadItems(); }, [loadItems]);

  const handleVoid = async (sale) => {
    const reason = prompt(`Void ${sale.saleNo}? Enter a reason:`);
    if (!reason || !reason.trim()) return;
    try {
      await csApi.void(sale.id, reason);
      toast.success('Cash sale voided');
      load();
      loadItems();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to void cash sale');
    }
  };

  const todayTotal = rows
    .filter((r) => r.status === 'ACTIVE' && r.saleDate?.slice(0, 10) === new Date().toISOString().slice(0, 10))
    .reduce((s, r) => s + Number(r.totalAmount), 0);

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Cash Sales</h1>
          <p className="page-subtitle">{total} record{total !== 1 ? 's' : ''} · Non-invoiced walk-in/counter sales</p>
        </div>
        <button className="btn-primary" onClick={() => setShowNew(true)}>
          <Plus className="w-4 h-4" /> New Cash Sale
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="card p-5 border-l-4 border-l-green-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Today's Cash Sales</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(todayTotal)}</p>
        </div>
        <div className="card p-5 border-l-4 border-l-blue-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total Records</p>
          <p className="text-2xl font-bold text-gray-900">{total}</p>
        </div>
      </div>

      <div className="card">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Search buyer, description, sale #..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="pl-4">Sale #</th>
                <th>Date</th>
                <th>Buyer</th>
                <th>Description</th>
                <th>Method</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th className="w-20 pr-4" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">Loading...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">No cash sales recorded yet.</td></tr>
              ) : rows.map((s) => (
                <tr key={s.id} className="border-b border-gray-100">
                  <td className="pl-4 py-2 font-mono text-sm text-green-700">{s.saleNo}</td>
                  <td className="py-2 text-sm text-gray-600">{formatDate(s.saleDate)}</td>
                  <td className="py-2 text-sm">{s.buyerName || 'Walk-in'}</td>
                  <td className="py-2 text-sm text-gray-600">{s.description}</td>
                  <td className="py-2 text-sm text-gray-500">{s.paymentMethod}</td>
                  <td className="text-right py-2 text-sm font-semibold">{formatCurrency(s.totalAmount)}</td>
                  <td className="py-2">
                    <span className={`badge text-xs ${STATUS_BADGE[s.status]}`}>{s.status}</span>
                    {s.status === 'ACTIVE' && !s.journalEntryId && (
                      <span className="ml-1 text-xs text-red-600" title="GL posting failed — not reflected in financial reports">⚠ unposted</span>
                    )}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <button onClick={() => printCashSale(s)} className="text-gray-400 hover:text-green-600" title="Print receipt">
                        <Printer className="w-4 h-4" />
                      </button>
                      {s.status === 'ACTIVE' && (
                        <button onClick={() => handleVoid(s)} className="text-gray-400 hover:text-red-600" title="Void">
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showNew && (
        <NewSaleModal
          accounts={accounts}
          items={items}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); loadItems(); }}
        />
      )}
    </div>
  );
}
