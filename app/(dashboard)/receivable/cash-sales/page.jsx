'use client';
import { useState, useEffect, useCallback } from 'react';
import { cashSales as csApi, accounts as acctApi, inventory as invApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Search, Ban, Printer } from 'lucide-react';
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
    buyerName: '', description: '', accountId: '',
    vatCode: 'VAT', amount: '', paymentMethod: 'Cash', notes: '',
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

function applyItemAmount(item, quantity, vatCode) {
  const price = Number(item.sellingPrice) || 0;
  const raw = price * quantity;
  return String(Math.round((vatCode === 'VAT' ? raw * 1.12 : raw) * 100) / 100);
}

function NewSaleModal({ accounts, items, onClose, onSaved }) {
  const [tab, setTab] = useState('pick'); // 'pick' | 'custom'
  const [form, setForm] = useState(emptyForm());
  const [selectedItem, setSelectedItem] = useState(null);
  const [qty, setQty] = useState(1);
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

  const selectItem = (item) => {
    setSelectedItem(item);
    setQty(1);
    setForm((f) => ({
      ...f,
      description: `${item.name} x1`,
      amount: applyItemAmount(item, 1, f.vatCode),
      accountId: f.accountId || (item.revenueAccountId ? String(item.revenueAccountId) : f.accountId),
    }));
  };

  const changeQty = (next) => {
    if (!selectedItem) return;
    const max = Math.max(1, Math.floor(Number(selectedItem.currentStock)) || 1);
    const clamped = Math.max(1, Math.min(next, max));
    setQty(clamped);
    setForm((f) => ({
      ...f,
      description: `${selectedItem.name} x${clamped}`,
      amount: applyItemAmount(selectedItem, clamped, f.vatCode),
    }));
  };

  const switchTab = (next) => {
    setTab(next);
    if (next === 'custom') {
      setSelectedItem(null);
      setForm((f) => ({ ...f, description: '', amount: '' }));
    }
  };

  const changeVatCode = (e) => {
    const vatCode = e.target.value;
    setForm((f) => ({
      ...f,
      vatCode,
      amount: selectedItem ? applyItemAmount(selectedItem, qty, vatCode) : f.amount,
    }));
  };

  const amt = Number(form.amount) || 0;
  const vat = form.vatCode === 'VAT' ? amt - amt / 1.12 : 0;
  const subtotal = amt - vat;

  const submit = async (e) => {
    e.preventDefault();
    if (tab === 'pick' && !selectedItem) return toast.error('Select an item or switch to Custom');
    if (!form.accountId) return toast.error('Select a revenue account');
    if (amt <= 0) return toast.error('Amount must be greater than 0');
    setSaving(true);
    try {
      const payload = tab === 'pick' && selectedItem
        ? { ...form, itemId: selectedItem.id, quantity: qty }
        : form;
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
        <div className="flex gap-1 px-6 pt-3 border-b border-gray-100">
          <button type="button" onClick={() => switchTab('pick')}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'pick' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            Pick Item
          </button>
          <button type="button" onClick={() => switchTab('custom')}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === 'custom' ? 'border-green-600 text-green-700' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            Custom
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                {tab === 'pick' ? (
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
                        <ItemTile key={it.id} item={it} selected={selectedItem?.id === it.id} onSelect={selectItem} />
                      ))}
                    </div>
                    {selectedItem && (
                      <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-900">{selectedItem.name}</p>
                          <p className="text-xs text-gray-500">{formatCurrency(selectedItem.sellingPrice)} / {selectedItem.unit}</p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
                            <button type="button" onClick={() => changeQty(qty - 1)} className="px-3 py-1.5 text-gray-600 hover:bg-gray-100">−</button>
                            <span className="px-3 text-sm font-semibold">{qty}</span>
                            <button type="button" onClick={() => changeQty(qty + 1)} className="px-3 py-1.5 text-gray-600 hover:bg-gray-100">+</button>
                          </div>
                          <span className="text-sm font-semibold text-green-700">{formatCurrency(amt)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="form-group">
                    <label className="label">Description *</label>
                    <input className="input" required value={form.description} onChange={set('description')} placeholder="What was sold" />
                  </div>
                )}
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
                    <label className="label">Amount (VAT-inclusive) *</label>
                    <NumberInput className="input" value={form.amount} disabled={tab === 'pick' && !!selectedItem}
                      onChange={(v) => setForm((f) => ({ ...f, amount: v }))} />
                  </div>
                  <div className="form-group">
                    <label className="label">VAT Code</label>
                    <select className="input" value={form.vatCode} onChange={changeVatCode}>
                      {VAT_CODES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label className="label">Payment Method *</label>
                  <select className="input" value={form.paymentMethod} onChange={set('paymentMethod')}>
                    {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {amt > 0 && (
                  <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm flex justify-between">
                    <span className="text-gray-500">Subtotal: {formatCurrency(subtotal)}</span>
                    <span className="text-gray-500">VAT: {formatCurrency(vat)}</span>
                    <span className="font-semibold">Total: {formatCurrency(amt)}</span>
                  </div>
                )}
                <div className="form-group">
                  <label className="label">Notes</label>
                  <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
                </div>
              </div>
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
  const body = `
    <div class="info-grid" style="grid-template-columns:repeat(2,1fr);">
      <div class="info-box"><div class="info-lbl">Buyer</div><div class="info-val">${sale.buyerName || 'Walk-in'}</div></div>
      <div class="info-box"><div class="info-lbl">Payment Method</div><div class="info-val">${sale.paymentMethod}</div></div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="right">Subtotal</th><th class="right">VAT</th><th class="right">Total</th></tr></thead>
      <tbody><tr>
        <td>${sale.description}</td>
        <td class="right">${phpFmt(sale.subtotal)}</td>
        <td class="right">${phpFmt(sale.vatAmount)}</td>
        <td class="right bold">${phpFmt(sale.totalAmount)}</td>
      </tr></tbody>
    </table>
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

  useEffect(() => { load(); }, [load]);
  useEffect(() => { acctApi.list({ active: true }).then((r) => setAccounts(r.data)).catch(() => {}); }, []);
  useEffect(() => {
    invApi.items.list({ limit: 500 })
      .then((r) => setItems(r.data.data || r.data || []))
      .catch(() => setItems([]));
  }, []);

  const handleVoid = async (sale) => {
    const reason = prompt(`Void ${sale.saleNo}? Enter a reason:`);
    if (!reason || !reason.trim()) return;
    try {
      await csApi.void(sale.id, reason);
      toast.success('Cash sale voided');
      load();
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
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}
