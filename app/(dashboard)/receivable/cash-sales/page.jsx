'use client';
import { useState, useEffect, useCallback } from 'react';
import { cashSales as csApi, accounts as acctApi, inventory as invApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Search, Ban, Printer, X, Filter } from 'lucide-react';
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
    vatCode: 'EXEMPT', paymentMethod: 'Cash', notes: '',
  };
}

// ─── New Cash Sale Modal ────────────────────────────────────────
function NewSaleModal({ accounts, items: loadedItems, onClose, onSaved }) {
  const [form, setForm] = useState(emptyForm());
  // Items quick-added from this modal, merged with the inventory list so they
  // are searchable straight away without reloading the page.
  const [created, setCreated] = useState([]);
  const items = [...loadedItems, ...created];
  const [quickOpen, setQuickOpen] = useState(false);
  const [quick, setQuick] = useState({ name: '', sellingPrice: '', costPrice: '', unit: 'pcs' });
  const [quickSaving, setQuickSaving] = useState(false);
  const [cart, setCart] = useState([]);
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const addLine = () => {
    setCart((c) => [...c, {
      key: `line-${Date.now()}-${c.length}`, itemId: null, description: '',
      quantity: 1, unitPrice: 0, stockCap: Infinity,
      discountType: 'NONE', discountValue: 0,
    }]);
  };

  const updateLine = (key, patch) => setCart((c) => c.map((l) => l.key === key ? { ...l, ...patch } : l));
  const removeLine = (key) => setCart((c) => c.filter((l) => l.key !== key));

  // Quick add: create the item in Inventory (stock 0) and drop it straight onto
  // the cart as a linked line. Selling at zero stock is allowed.
  const quickAdd = async () => {
    const name = quick.name.trim();
    if (!name) return toast.error('Item name is required');
    const existing = items.find((it) => it.name.toLowerCase() === name.toLowerCase());
    if (existing) return toast.error(`"${existing.name}" already exists in Inventory — pick it from the list`);
    setQuickSaving(true);
    try {
      const { data } = await invApi.items.create({
        name,
        sellingPrice: Number(quick.sellingPrice) || 0,
        costPrice: Number(quick.costPrice) || 0,
        unit: quick.unit.trim() || 'pcs',
      });
      setCreated((c) => [...c, data]);
      setCart((c) => [...c, {
        key: `line-${Date.now()}-${c.length}`, itemId: data.id, description: data.name,
        quantity: 1, unitPrice: Number(data.sellingPrice), stockCap: Number(data.currentStock || 0),
        discountType: 'NONE', discountValue: 0,
      }]);
      setQuick({ name: '', sellingPrice: '', costPrice: '', unit: 'pcs' });
      setQuickOpen(false);
      toast.success(`${data.name} added to Inventory`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not add item');
    } finally {
      setQuickSaving(false);
    }
  };

  // Typing is free-form; if the text exactly matches an Inventory item's name,
  // link the row to it (auto-fill price, cap qty to its stock) — same
  // datalist-driven match Quotations already uses. Editing the text away from
  // a match reverts the row to a plain custom line.
  const setLineDescription = (key, value) => {
    const match = items.find((it) => it.name === value);
    setCart((c) => c.map((l) => {
      if (l.key !== key) return l;
      if (!match) return { ...l, description: value, itemId: null, stockCap: Infinity };
      return {
        ...l, description: value, itemId: match.id, unitPrice: Number(match.sellingPrice),
        stockCap: Number(match.currentStock), quantity: Number(l.quantity) > 0 ? l.quantity : 1,
      };
    }));
  };

  const lineGross = (l) => Math.round(Number(l.quantity) * Number(l.unitPrice) * 100) / 100;
  const lineDiscount = (l) => {
    const v = Number(l.discountValue) || 0;
    if (l.discountType === 'PERCENT') return Math.round(lineGross(l) * Math.min(v, 100)) / 100;
    if (l.discountType === 'AMOUNT') return Math.min(v, lineGross(l));
    return 0;
  };
  const lineTotal = (l) => Math.round((lineGross(l) - lineDiscount(l)) * 100) / 100;
  const discountTotal = cart.reduce((s, l) => s + lineDiscount(l), 0);
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
    if (total <= 0) return toast.error('Total must be greater than 0');
    setSaving(true);
    try {
      const payload = {
        ...form,
        items: cart.map((l) => ({
          itemId: l.itemId || undefined,
          description: l.description,
          quantity: Number(l.quantity),
          unitPrice: Number(l.unitPrice),
          discountType: l.discountType,
          discountValue: l.discountType === 'NONE' ? 0 : Number(l.discountValue) || 0,
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
      <div className="modal max-w-7xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">New Cash Sale</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <datalist id="cash-sale-items">
          {items.map((it) => <option key={it.id} value={it.name}>{it.sku}</option>)}
        </datalist>
        <form onSubmit={submit}>
          <div className="modal-body">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="md:col-span-1 space-y-4">
                <div className="form-group">
                  <label className="label">Sale Date *</label>
                  <input type="date" className="input" required value={form.saleDate} onChange={set('saleDate')} />
                </div>
                <div className="form-group">
                  <label className="label">Buyer Name</label>
                  <input className="input" value={form.buyerName} onChange={set('buyerName')} placeholder="Walk-in" />
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
                <div className="form-group">
                  <label className="label">Notes</label>
                  <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
                </div>
              </div>

              <div className="md:col-span-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Items</label>
                  <div className="flex items-center gap-4">
                    <button type="button" onClick={() => setQuickOpen((v) => !v)}
                      className="text-xs font-medium text-blue-700 hover:text-blue-800 flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" /> Quick Add Item
                    </button>
                    <button type="button" onClick={addLine} className="text-xs font-medium text-green-700 hover:text-green-800 flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" /> Add Line
                    </button>
                  </div>
                </div>
                {quickOpen && (
                  <div className="mb-3 rounded-xl border border-blue-200 bg-blue-50 p-3">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 items-end">
                      <div className="col-span-2">
                        <label className="label">Item name *</label>
                        <input className="input" autoFocus value={quick.name} placeholder="e.g. 2x3ft Tarpaulin"
                          onChange={(e) => setQuick((q) => ({ ...q, name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Selling price</label>
                        <NumberInput className="input text-right" value={quick.sellingPrice} placeholder="0.00"
                          onChange={(v) => setQuick((q) => ({ ...q, sellingPrice: v }))} />
                      </div>
                      <div>
                        <label className="label">Cost price</label>
                        <NumberInput className="input text-right" value={quick.costPrice} placeholder="0.00"
                          onChange={(v) => setQuick((q) => ({ ...q, costPrice: v }))} />
                      </div>
                      <div>
                        <label className="label">Unit</label>
                        <input className="input" value={quick.unit}
                          onChange={(e) => setQuick((q) => ({ ...q, unit: e.target.value }))} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      <p className="text-[11px] text-blue-700">Saved to Inventory with 0 stock. You can still sell it now.</p>
                      <div className="flex gap-2">
                        <button type="button" className="btn-secondary btn-sm" onClick={() => setQuickOpen(false)}>Cancel</button>
                        <button type="button" className="btn-primary btn-sm" disabled={quickSaving} onClick={quickAdd}>
                          {quickSaving ? 'Adding…' : 'Add to Inventory & Cart'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                      <tr>
                        <th className="text-left px-3 py-2">Item / Description</th>
                        <th className="text-center px-3 py-2 w-28">Qty</th>
                        <th className="text-right px-3 py-2 w-24">Price</th>
                        <th className="text-left px-3 py-2 w-36">Discount Type</th>
                        <th className="text-right px-3 py-2 w-28">Discount</th>
                        <th className="text-right px-3 py-2 w-28">Total</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {cart.length === 0 ? (
                        <tr><td colSpan={7} className="text-center py-6 text-gray-400">No items yet — click "+ Add Line" to get started.</td></tr>
                      ) : cart.map((l) => (
                        <tr key={l.key} className="border-t border-gray-100">
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <input className="input flex-1 min-w-0" list="cash-sale-items" placeholder="Type to search items, or enter free text"
                                value={l.description} onChange={(e) => setLineDescription(l.key, e.target.value)} />
                              {l.itemId && (
                                <span className={`text-[10px] whitespace-nowrap shrink-0 ${Number(l.quantity) > l.stockCap ? 'text-amber-600' : 'text-gray-400'}`}>
                                  {items.find((it) => it.id === l.itemId)?.sku} · {l.stockCap} in stock
                                  {Number(l.quantity) > l.stockCap ? ' (stock will go negative)' : ''}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            <NumberInput decimals={3} className="input text-center" value={String(l.quantity)}
                              onChange={(v) => updateLine(l.key, { quantity: Number(v) || 0 })} />
                          </td>
                          <td className="px-3 py-2">
                            <NumberInput className="input text-right" value={String(l.unitPrice)}
                              onChange={(v) => updateLine(l.key, { unitPrice: Number(v) || 0 })} />
                          </td>
                          <td className="px-3 py-2">
                            <select className="input" value={l.discountType}
                              onChange={(e) => updateLine(l.key, { discountType: e.target.value, discountValue: 0 })}>
                              <option value="NONE">None</option>
                              <option value="PERCENT">Percent (%)</option>
                              <option value="AMOUNT">Amount (₱)</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <NumberInput className="input text-right" disabled={l.discountType === 'NONE'}
                              value={l.discountType === 'NONE' ? '' : String(l.discountValue)}
                              placeholder={l.discountType === 'PERCENT' ? '0 %' : '0.00'}
                              onChange={(v) => updateLine(l.key, { discountValue: Number(v) || 0 })} />
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
              </div>
            </div>
            {cart.length > 0 && (
              <div className="bg-gray-50 rounded-xl px-4 py-3 text-sm flex justify-end gap-6 mt-4">
                {discountTotal > 0 && (
                  <span className="text-gray-500">Discount: −{formatCurrency(discountTotal)}</span>
                )}
                <span className="text-gray-500">Subtotal: {formatCurrency(subtotal)}</span>
                <span className="text-gray-500">VAT: {formatCurrency(vat)}</span>
                <span className="font-semibold">Total: {formatCurrency(total)}</span>
              </div>
            )}
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
          <td>${it.description}${it.discountType ? `<br><small>Less ${it.discountType === 'PERCENT' ? `${Number(it.discountValue)}%` : phpFmt(it.discountValue)} discount</small>` : ''}</td>
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
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [showDateFilter, setShowDateFilter] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = { search, from, to, limit: 100 };
    Object.keys(params).forEach((k) => !params[k] && delete params[k]);
    csApi.list(params)
      .then((r) => { setRows(r.data.data); setTotal(r.data.total); })
      .catch(() => toast.error('Failed to load cash sales'))
      .finally(() => setLoading(false));
  }, [search, from, to]);

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
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <div className="relative max-w-sm flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Search buyer, description, sale #..."
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <button className="btn-secondary" onClick={() => setShowDateFilter(!showDateFilter)}>
            <Filter className="w-4 h-4" /> Date Range
            {(from || to) && (
              <span className="ml-1 w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">
                {[from, to].filter(Boolean).length}
              </span>
            )}
          </button>
          {(from || to) && (
            <button onClick={() => { setFrom(''); setTo(''); }} className="btn-secondary text-red-500 hover:text-red-600">
              <X className="w-4 h-4" /> Clear
            </button>
          )}
        </div>
        {showDateFilter && (
          <div className="px-6 pb-4 pt-1 flex gap-3 border-t border-gray-100">
            <div className="form-group">
              <label className="label">From</label>
              <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="form-group">
              <label className="label">To</label>
              <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
        )}
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
