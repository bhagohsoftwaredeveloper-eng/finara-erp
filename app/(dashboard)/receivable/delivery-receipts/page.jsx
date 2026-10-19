'use client';
import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { receivable as rApi, inventory as invApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Search, Printer, Truck, X, Ban, FileText, RefreshCw } from 'lucide-react';
import CustomerSelect from '@/components/CustomerSelect';
import NumberInput from '@/components/NumberInput';
import { printDocument, dateFmt } from '@/lib/print';
import { formatDate } from '@/lib/auth';
import { todayPH } from '@/lib/arAging';

const STATUS_BADGE = { DRAFT: 'badge-gray', DELIVERED: 'badge-green', CANCELLED: 'badge-red' };
const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const blankLine = () => ({ itemId: '', description: '', quantity: '1', unit: '' });

// ─── Print ────────────────────────────────────────────────────
async function printDr(dr) {
  const rows = dr.lines.map((l, i) => `
    <tr>
      <td class="center">${i + 1}</td>
      <td>${esc(l.description)}</td>
      <td class="right">${Number(l.quantity).toLocaleString('en-PH')}</td>
      <td>${esc(l.unit || '')}</td>
    </tr>`).join('');
  const sign = (label) => `
    <div style="flex:1;text-align:center;">
      <div style="border-bottom:1px solid #111;height:38px;"></div>
      <div class="small bold" style="margin-top:3px;">${label}</div>
      <div class="small gray">Name / Signature / Date</div>
    </div>`;
  const body = `
    <div class="info-grid">
      <div class="info-box"><div class="info-lbl">DR No.</div><div class="info-val mono">${esc(dr.drNo)}</div></div>
      <div class="info-box"><div class="info-lbl">Date</div><div class="info-val">${dateFmt(dr.drDate)}</div></div>
      <div class="info-box"><div class="info-lbl">Invoice Ref.</div><div class="info-val mono">${esc(dr.invoice?.invoiceNo || '—')}</div></div>
      <div class="info-box"><div class="info-lbl">Delivered To</div><div class="info-val">${esc(dr.customer.name)}</div></div>
      <div class="info-box"><div class="info-lbl">Driver / Courier</div><div class="info-val">${esc(dr.driverName || '—')}</div></div>
      <div class="info-box"><div class="info-lbl">Vehicle / Plate No.</div><div class="info-val">${esc(dr.vehicleNo || '—')}</div></div>
    </div>
    <div class="desc-box"><strong>Delivery address:</strong> ${esc(dr.deliveryAddress || dr.customer.address || '—')}</div>
    <div class="section-title">Items Delivered</div>
    <table>
      <thead><tr><th class="center" style="width:32px;">#</th><th>Description</th><th class="right">Qty</th><th>Unit</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    ${dr.notes ? `<div class="desc-box" style="margin-top:10px;"><strong>Remarks:</strong> ${esc(dr.notes)}</div>` : ''}
    <p class="small gray" style="margin-top:14px;">Received the above items in good order and condition.</p>
    <div style="display:flex;gap:28px;margin-top:26px;">${sign('Prepared by')}${sign('Delivered by')}${sign('Received by')}</div>`;
  await printDocument('Delivery Receipt', dr.drNo, body);
}

// ─── Create / edit / view modal ───────────────────────────────
function DrModal({ drId, customers, items, onCustomerAdded, onClose, onChanged }) {
  const router = useRouter();
  const [dr, setDr]           = useState(null);       // loaded record (null while creating)
  const [loading, setLoading] = useState(!!drId);
  const [saving, setSaving]   = useState(false);
  const [form, setForm] = useState({
    customerId: '', drDate: todayPH(), deliveryAddress: '', driverName: '', vehicleNo: '',
    notes: '', deductStock: false, lines: [blankLine()],
  });

  const fill = (data) => {
    setDr(data);
    setForm({
      customerId: String(data.customerId), drDate: String(data.drDate).slice(0, 10),
      deliveryAddress: data.deliveryAddress || '', driverName: data.driverName || '', vehicleNo: data.vehicleNo || '',
      notes: data.notes || '', deductStock: data.deductStock,
      lines: data.lines.map((l) => ({
        itemId: l.itemId ? String(l.itemId) : '', description: l.description,
        quantity: String(Number(l.quantity)), unit: l.unit || '',
      })),
    });
  };

  useEffect(() => {
    if (!drId) return;
    rApi.deliveryReceipts.get(drId).then(({ data }) => fill(data))
      .catch(() => { toast.error('Failed to load delivery receipt'); onClose(); })
      .finally(() => setLoading(false));
  }, [drId]); // eslint-disable-line react-hooks/exhaustive-deps

  const readOnly = !!dr && dr.status !== 'DRAFT';
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, patch) => setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)) }));

  const pickItem = (i, itemId) => {
    const item = items.find((it) => String(it.id) === String(itemId));
    setLine(i, item ? { itemId: String(item.id), description: item.name, unit: item.unit || '' } : { itemId: '' });
  };

  const pickCustomer = (id) => {
    const c = customers.find((x) => String(x.id) === String(id));
    setForm((f) => ({ ...f, customerId: id, deliveryAddress: f.deliveryAddress || c?.address || '' }));
  };

  const payload = () => ({
    ...(dr ? {} : { customerId: Number(form.customerId) }),
    drDate: form.drDate, deliveryAddress: form.deliveryAddress, driverName: form.driverName,
    vehicleNo: form.vehicleNo, notes: form.notes, deductStock: form.deductStock,
    lines: form.lines.filter((l) => l.description.trim()).map((l) => ({
      itemId: l.itemId ? Number(l.itemId) : undefined, description: l.description,
      quantity: Number(l.quantity), unit: l.unit,
    })),
  });

  const act = async (fn, okMsg) => {
    setSaving(true);
    try {
      await fn();
      toast.success(okMsg);
      onChanged();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Action failed');
    } finally {
      setSaving(false);
    }
  };

  const save = async (e) => {
    e.preventDefault();
    if (!dr && !form.customerId) { toast.error('Select a customer'); return; }
    await act(() => (dr ? rApi.deliveryReceipts.update(dr.id, payload()) : rApi.deliveryReceipts.create(payload())),
      dr ? 'Delivery receipt updated' : 'Delivery receipt created');
  };

  const deliver = async () => {
    const stockNote = dr.deductStock ? ' Stocked items will be deducted from inventory.' : '';
    if (!confirm(`Mark ${dr.drNo} as delivered?${stockNote}`)) return;
    await act(() => rApi.deliveryReceipts.deliver(dr.id), 'Marked as delivered');
  };

  const cancel = async () => {
    const reason = window.prompt(`Cancel ${dr.drNo}?${dr.status === 'DELIVERED' && dr.deductStock ? ' Stock will be returned to inventory.' : ''}\nReason (optional):`);
    if (reason === null) return;
    await act(() => rApi.deliveryReceipts.cancel(dr.id, { reason }), 'Delivery receipt cancelled');
  };

  const toInvoice = () => router.push(`/receivable?fromDr=${dr.id}`);

  if (loading) return null;

  return (
    <div className="modal-overlay">
      <div className="modal max-w-4xl">
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">{dr ? dr.drNo : 'New Delivery Receipt'}</h3>
            {dr && <span className={`badge ${STATUS_BADGE[dr.status]}`}>{dr.status}</span>}
            {dr?.invoice && <span className="text-xs text-gray-500">Invoice {dr.invoice.invoiceNo}</span>}
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>

        <form onSubmit={save}>
          <div className="modal-body space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="label">Customer *</label>
                {dr ? (
                  <input className="input" disabled value={dr.customer.name} />
                ) : (
                  <CustomerSelect customers={customers} value={form.customerId} onChange={pickCustomer}
                    onCustomerAdded={onCustomerAdded} required />
                )}
              </div>
              <div className="form-group">
                <label className="label">Date *</label>
                <input type="date" className="input" required disabled={readOnly} value={form.drDate} onChange={set('drDate')} />
              </div>
              <div className="form-group md:col-span-2">
                <label className="label">Delivery Address</label>
                <textarea className="input resize-none" rows={2} disabled={readOnly}
                  value={form.deliveryAddress} onChange={set('deliveryAddress')} />
              </div>
              <div className="form-group">
                <label className="label">Driver / Courier</label>
                <input className="input" disabled={readOnly} value={form.driverName} onChange={set('driverName')} />
              </div>
              <div className="form-group">
                <label className="label">Vehicle / Plate No.</label>
                <input className="input" disabled={readOnly} value={form.vehicleNo} onChange={set('vehicleNo')} />
              </div>
            </div>

            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Items</h4>
              <div className="space-y-2">
                {form.lines.map((l, i) => (
                  <div key={i} className="grid grid-cols-1 md:grid-cols-[1.4fr_2fr_6rem_5rem_2rem] gap-2 items-start">
                    <select className="select text-sm" disabled={readOnly} value={l.itemId} onChange={(e) => pickItem(i, e.target.value)}>
                      <option value="">— Not a stocked item —</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id} disabled={form.lines.some((x, xi) => xi !== i && String(x.itemId) === String(it.id))}>
                          {it.sku} · {it.name}
                        </option>
                      ))}
                    </select>
                    <input className="input text-sm" placeholder="Description" disabled={readOnly}
                      value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                    <NumberInput className="input text-sm text-right" decimals={3} placeholder="Qty" disabled={readOnly}
                      value={l.quantity} onChange={(v) => setLine(i, { quantity: v })} />
                    <input className="input text-sm" placeholder="Unit" disabled={readOnly}
                      value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} />
                    {!readOnly && (
                      <button type="button" className="p-1.5 text-red-400 hover:text-red-600"
                        onClick={() => setForm((f) => ({ ...f, lines: f.lines.length > 1 ? f.lines.filter((_, xi) => xi !== i) : [blankLine()] }))}
                        title="Remove line"><X className="w-4 h-4" /></button>
                    )}
                  </div>
                ))}
              </div>
              {!readOnly && (
                <button type="button" className="btn-secondary btn-sm mt-2"
                  onClick={() => setForm((f) => ({ ...f, lines: [...f.lines, blankLine()] }))}>
                  <Plus className="w-3.5 h-3.5" /> Add line
                </button>
              )}
            </div>

            <label className="flex items-start gap-3 bg-gray-50 rounded-xl px-4 py-3 cursor-pointer">
              <input type="checkbox" className="mt-1" disabled={readOnly} checked={form.deductStock}
                onChange={(e) => setForm((f) => ({ ...f, deductStock: e.target.checked }))} />
              <span>
                <span className="text-sm font-medium text-gray-700 block">Deduct from inventory when delivered</span>
                <span className="text-xs text-gray-500">
                  Only lines with a stocked item move stock. Posts the cost of goods to the books. Leave off when the invoice or another document already handles stock.
                </span>
              </span>
            </label>

            <div className="form-group">
              <label className="label">Remarks</label>
              <textarea className="input resize-none" rows={2} disabled={readOnly} value={form.notes} onChange={set('notes')} />
            </div>
            {dr?.status === 'CANCELLED' && dr.cancelReason && (
              <p className="text-sm text-red-600">Cancelled: {dr.cancelReason}</p>
            )}
          </div>

          <div className="modal-footer">
            {dr && dr.status !== 'CANCELLED' && (
              <button type="button" onClick={cancel} disabled={saving} className="btn-danger btn-sm mr-auto">
                <Ban className="w-4 h-4" /> Cancel DR
              </button>
            )}
            {dr && (
              <button type="button" onClick={() => printDr(dr)} className="btn-secondary">
                <Printer className="w-4 h-4" /> Print
              </button>
            )}
            {dr && dr.status !== 'CANCELLED' && !dr.invoice && (
              <button type="button" onClick={toInvoice} className="btn-secondary">
                <FileText className="w-4 h-4" /> Convert to Invoice
              </button>
            )}
            {dr?.status === 'DRAFT' && (
              <button type="button" onClick={deliver} disabled={saving} className="btn-secondary">
                <Truck className="w-4 h-4" /> Mark Delivered
              </button>
            )}
            {!readOnly && (
              <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : dr ? 'Save Changes' : 'Create DR'}</button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function DeliveryReceiptsPage() {
  const [rows, setRows]           = useState([]);
  const [customers, setCustomers] = useState([]);
  const [items, setItems]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [status, setStatus]       = useState('');
  const [search, setSearch]       = useState('');
  const [modal, setModal]         = useState(null); // null | { id: number | null }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await rApi.deliveryReceipts.list({ ...(status && { status }), ...(search.trim() && { search: search.trim() }) });
      setRows(data);
    } catch {
      toast.error('Failed to load delivery receipts');
    } finally {
      setLoading(false);
    }
  }, [status, search]);

  useEffect(() => {
    const t = setTimeout(load, 250); // debounce typing in the search box
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    rApi.customers.list({ active: true }).then((r) => setCustomers(r.data)).catch(() => {});
    invApi.items.list().then((r) => setItems(r.data.data || r.data || [])).catch(() => {});
    const open = new URLSearchParams(window.location.search).get('open');
    if (open) setModal({ id: Number(open) });
  }, []);

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Delivery Receipts</h1>
          <p className="page-subtitle">Proof of delivery. Create from an invoice, or deliver first and invoice after.</p>
        </div>
        <button className="btn-primary" onClick={() => setModal({ id: null })}>
          <Plus className="w-4 h-4" /> New Delivery Receipt
        </button>
      </div>

      <div className="card">
        <div className="card-body flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input className="input pl-8 text-sm w-64" placeholder="Search DR no. or customer…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <select className="select w-44 text-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            <option value="DRAFT">Draft</option>
            <option value="DELIVERED">Delivered</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table w-full">
          <thead>
            <tr>
              <th className="pl-4">DR No.</th><th>Date</th><th>Customer</th><th>Invoice</th>
              <th className="text-center">Items</th><th>Stock</th><th className="pr-4">Status</th>
            </tr>
          </thead>
          <tbody>
            {!loading && rows.length === 0 && (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">No delivery receipts yet.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="cursor-pointer hover:bg-green-50/40 border-b border-gray-100" onClick={() => setModal({ id: r.id })}>
                <td className="pl-4 font-mono text-sm text-green-700">{r.drNo}</td>
                <td>{formatDate(r.drDate)}</td>
                <td>{r.customer.name}</td>
                <td className="font-mono text-sm">{r.invoice?.invoiceNo || <span className="text-gray-300">—</span>}</td>
                <td className="text-center">{r._count.lines}</td>
                <td>{r.deductStock ? <span className="badge badge-blue">Deducts stock</span> : <span className="text-gray-300">—</span>}</td>
                <td className="pr-4"><span className={`badge ${STATUS_BADGE[r.status]}`}>{r.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modal && (
        <DrModal
          drId={modal.id}
          customers={customers}
          items={items}
          onCustomerAdded={(c) => setCustomers((prev) => [c, ...prev])}
          onClose={() => setModal(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}
