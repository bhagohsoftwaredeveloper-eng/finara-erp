'use client';
import { useState, useEffect, useCallback } from 'react';
import { purchaseOrders as poApi, payable, accounts as acctApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import { Plus, Send, PackageCheck, FileText, XCircle, Trash2, Eye } from 'lucide-react';
import VendorSelect from '@/components/VendorSelect';

const STATUS_BADGE = {
  DRAFT: 'badge-gray', SENT: 'badge-blue', PARTIAL: 'badge-yellow',
  RECEIVED: 'badge-green', BILLED: 'badge-green', CANCELLED: 'badge-red',
};

const emptyLine = () => ({ description: '', quantity: 1, unitPrice: 0, accountId: '' });

function POModal({ po, vendors, accounts, onClose, onSaved, onVendorAdded }) {
  const [form, setForm] = useState(po || {
    vendorId: '', orderDate: new Date().toISOString().split('T')[0],
    expectedDate: '', notes: '', taxAmount: 0, lines: [emptyLine(), emptyLine()],
  });
  const [saving, setSaving] = useState(false);

  const subtotal = form.lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  const total = subtotal + Number(form.taxAmount || 0);

  const setLine = (i, f, v) => setForm((p) => ({ ...p, lines: p.lines.map((l, idx) => idx === i ? { ...l, [f]: v } : l) }));
  const addLine = () => setForm((p) => ({ ...p, lines: [...p.lines, emptyLine()] }));
  const rmLine = (i) => setForm((p) => ({ ...p, lines: p.lines.filter((_, idx) => idx !== i) }));

  const submit = async (e) => {
    e.preventDefault();
    const lines = form.lines.filter((l) => l.description && Number(l.quantity) > 0);
    if (!form.vendorId) return toast.error('Select a vendor');
    if (!lines.length) return toast.error('Add at least one line');
    setSaving(true);
    try {
      const payload = { ...form, lines, vendorId: Number(form.vendorId) };
      if (po?.id) await poApi.update(po.id, payload);
      else await poApi.create(payload);
      toast.success('Purchase order saved');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-3xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{po?.id ? `Edit — ${po.poNumber}` : 'New Purchase Order'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-4">
            <div className="form-grid">
              <div className="form-group">
                <label className="label">Vendor *</label>
                <VendorSelect
                  vendors={vendors}
                  value={form.vendorId}
                  onChange={(id) => setForm((f) => ({ ...f, vendorId: id }))}
                  onVendorAdded={onVendorAdded}
                  required
                />
              </div>
              <div className="form-group">
                <label className="label">Order Date *</label>
                <input type="date" className="input" value={form.orderDate} onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="label">Expected Date</label>
                <input type="date" className="input" value={form.expectedDate || ''} onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))} />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Notes</label>
              <input className="input" value={form.notes || ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Line Items</label>
                <button type="button" onClick={addLine} className="btn-secondary btn-sm">+ Add Line</button>
              </div>
              <div className="overflow-x-auto">
                <table className="table text-sm">
                  <thead><tr><th>Description</th><th className="w-20">Qty</th><th className="w-28">Unit Price</th><th>Account</th><th className="w-24 text-right">Amount</th><th className="w-8"></th></tr></thead>
                  <tbody>
                    {form.lines.map((l, i) => (
                      <tr key={i}>
                        <td><input className="input w-full text-xs" value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></td>
                        <td><input type="number" min="0" step="0.01" className="input w-full text-right" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></td>
                        <td><input type="number" min="0" step="0.01" className="input w-full text-right" value={l.unitPrice} onChange={(e) => setLine(i, 'unitPrice', e.target.value)} /></td>
                        <td>
                          <select className="select w-full text-xs" value={l.accountId || ''} onChange={(e) => setLine(i, 'accountId', e.target.value)}>
                            <option value="">-- (req. for billing) --</option>
                            {accounts.map((a) => <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>)}
                          </select>
                        </td>
                        <td className="text-right font-mono">{(Number(l.quantity || 0) * Number(l.unitPrice || 0)).toFixed(2)}</td>
                        <td>{form.lines.length > 1 && <button type="button" onClick={() => rmLine(i)} className="text-red-400 hover:text-red-600 text-lg">&times;</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-6 mt-3 text-sm">
                <div className="text-gray-500">Subtotal: <span className="font-mono text-gray-800">{formatCurrency(subtotal)}</span></div>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Tax/VAT:</span>
                  <input type="number" min="0" step="0.01" className="input w-28 text-right" value={form.taxAmount} onChange={(e) => setForm((f) => ({ ...f, taxAmount: e.target.value }))} />
                </div>
                <div className="font-semibold">Total: <span className="font-mono">{formatCurrency(total)}</span></div>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save PO'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ReceiveModal({ po, onClose, onSaved }) {
  const [lines, setLines] = useState(po.lines.map((l) => ({ id: l.id, description: l.description, quantity: Number(l.quantity), receivedQty: Number(l.receivedQty) })));
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try { await poApi.receive(po.id, { lines: lines.map((l) => ({ id: l.id, receivedQty: Number(l.receivedQty) })) }); toast.success('Goods received'); onSaved(); }
    catch (err) { toast.error(err.response?.data?.error || 'Failed'); } finally { setSaving(false); }
  };
  return (
    <div className="modal-overlay">
      <div className="modal max-w-2xl">
        <div className="modal-header"><h3 className="text-lg font-semibold">Receive Goods — {po.poNumber}</h3><button onClick={onClose} className="text-gray-400 text-2xl">&times;</button></div>
        <div className="modal-body">
          <table className="table text-sm">
            <thead><tr><th>Description</th><th className="text-right">Ordered</th><th className="w-32 text-right">Received</th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={l.id}>
                  <td>{l.description}</td>
                  <td className="text-right">{l.quantity}</td>
                  <td><input type="number" min="0" max={l.quantity} step="0.01" className="input w-full text-right"
                    value={l.receivedQty} onChange={(e) => setLines((p) => p.map((x, idx) => idx === i ? { ...x, receivedQty: e.target.value } : x))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="modal-footer"><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Confirm Receipt'}</button></div>
      </div>
    </div>
  );
}

export default function PurchaseOrdersPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [modal, setModal] = useState(null);
  const [receivePO, setReceivePO] = useState(null);
  const [filter, setFilter] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    poApi.list({ status: filter, limit: 100 }).then((r) => setRows(r.data.data)).finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    payable.vendors.list().then((r) => setVendors(r.data.data || r.data));
    acctApi.list({ active: true }).then((r) => setAccounts(r.data));
  }, []);

  const doSend = async (po) => { try { await poApi.send(po.id); toast.success('PO marked as sent'); load(); } catch (e) { toast.error(e.response?.data?.error || 'Failed'); } };
  const doConvert = async (po) => {
    if (!confirm(`Convert ${po.poNumber} to a Bill and post to GL?`)) return;
    try { const { data } = await poApi.toBill(po.id, {}); toast.success(data.message); load(); } catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };
  const doCancel = async (po) => { if (!confirm(`Cancel ${po.poNumber}?`)) return; try { await poApi.cancel(po.id); toast.success('PO cancelled'); load(); } catch (e) { toast.error(e.response?.data?.error || 'Failed'); } };
  const doDelete = async (po) => { if (!confirm(`Delete ${po.poNumber}?`)) return; try { await poApi.remove(po.id); toast.success('Deleted'); load(); } catch (e) { toast.error(e.response?.data?.error || 'Failed'); } };

  return (
    <div>
      <div className="page-header">
        <div><h1 className="page-title">Purchase Orders</h1><p className="page-subtitle">{rows.length} orders</p></div>
        <button className="btn-primary" onClick={() => setModal('new')}><Plus className="w-4 h-4" /> New PO</button>
      </div>

      <div className="card mb-4"><div className="card-body py-3 flex gap-3 items-center">
        <select className="select w-48" value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="">All Status</option>
          {['DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'BILLED', 'CANCELLED'].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div></div>

      <div className="card"><div className="table-wrapper">
        <table className="table">
          <thead><tr><th>PO No.</th><th>Vendor</th><th>Order Date</th><th>Expected</th><th className="text-right">Total</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">Loading…</td></tr>
              : rows.length === 0 ? <tr><td colSpan={7} className="text-center py-8 text-gray-400">No purchase orders yet.</td></tr>
              : rows.map((po) => (
                <tr key={po.id}>
                  <td className="font-mono text-blue-700 font-medium">{po.poNumber}</td>
                  <td>{po.vendor?.name}</td>
                  <td>{formatDate(po.orderDate)}</td>
                  <td className="text-gray-500">{po.expectedDate ? formatDate(po.expectedDate) : '—'}</td>
                  <td className="text-right font-medium">{formatCurrency(po.total)}</td>
                  <td><span className={STATUS_BADGE[po.status]}>{po.status}</span></td>
                  <td>
                    <div className="flex gap-1">
                      {['DRAFT', 'SENT'].includes(po.status) && <button onClick={() => setModal(po)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded" title="Edit"><Eye className="w-4 h-4" /></button>}
                      {po.status === 'DRAFT' && <button onClick={() => doSend(po)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded" title="Mark Sent"><Send className="w-4 h-4" /></button>}
                      {['SENT', 'PARTIAL'].includes(po.status) && <button onClick={() => setReceivePO(po)} className="p-1.5 text-gray-400 hover:text-green-600 rounded" title="Receive"><PackageCheck className="w-4 h-4" /></button>}
                      {['SENT', 'PARTIAL', 'RECEIVED'].includes(po.status) && <button onClick={() => doConvert(po)} className="p-1.5 text-gray-400 hover:text-green-600 rounded" title="Convert to Bill"><FileText className="w-4 h-4" /></button>}
                      {po.status !== 'BILLED' && po.status !== 'CANCELLED' && <button onClick={() => doCancel(po)} className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="Cancel"><XCircle className="w-4 h-4" /></button>}
                      {['DRAFT', 'CANCELLED'].includes(po.status) && <button onClick={() => doDelete(po)} className="p-1.5 text-gray-400 hover:text-red-600 rounded" title="Delete"><Trash2 className="w-4 h-4" /></button>}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div></div>

      {modal && <POModal po={modal === 'new' ? null : modal} vendors={vendors} accounts={accounts} onClose={() => setModal(null)} onSaved={() => { setModal(null); load(); }} onVendorAdded={(v) => setVendors((prev) => [v, ...prev])} />}
      {receivePO && <ReceiveModal po={receivePO} onClose={() => setReceivePO(null)} onSaved={() => { setReceivePO(null); load(); }} />}
    </div>
  );
}
