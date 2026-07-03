'use client';
import { useState, useEffect, useCallback } from 'react';
import { purchaseOrders as poApi, payable, accounts as acctApi } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  Plus, Send, PackageCheck, FileText, XCircle, Trash2,
  Eye, Printer, Edit2, Search, ChevronDown, CheckCircle2,
} from 'lucide-react';
import VendorSelect from '@/components/VendorSelect';
import AccountSelect from '@/components/ui/AccountSelect';

// ─── Constants ────────────────────────────────────────────────
const STATUS_BADGE = {
  DRAFT:     'badge-gray',
  SENT:      'badge-blue',
  PARTIAL:   'badge-yellow',
  RECEIVED:  'badge-green',
  BILLED:    'badge-green',
  CANCELLED: 'badge-red',
};
const STATUS_LABEL = {
  DRAFT: 'Draft', SENT: 'Sent', PARTIAL: 'Partially Received',
  RECEIVED: 'Received', BILLED: 'Billed', CANCELLED: 'Cancelled',
};
const ALL_STATUSES = ['DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'BILLED', 'CANCELLED'];
const emptyLine = () => ({ description: '', quantity: 1, unitPrice: 0, accountId: '' });

// ─── Print helper ─────────────────────────────────────────────
async function printPO(po) {
  const lineRows = (po.lines || []).map((l) => `
    <tr style="border-bottom:1px solid #f3f4f6;">
      <td style="padding:8px 10px;">${l.description || ''}</td>
      <td style="padding:8px 10px;text-align:right;">${Number(l.quantity).toFixed(2)}</td>
      <td style="padding:8px 10px;text-align:right;">${phpFmt(l.unitPrice)}</td>
      <td style="padding:8px 10px;text-align:right;font-weight:600;">${phpFmt(Number(l.quantity) * Number(l.unitPrice))}</td>
    </tr>`).join('');

  const receivedRows = (po.lines || []).some((l) => Number(l.receivedQty) > 0)
    ? `<div style="margin-top:24px;">
        <p style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px;">Receipt Status</p>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#f9fafb;">
            <th style="padding:6px 10px;text-align:left;color:#374151;">Item</th>
            <th style="padding:6px 10px;text-align:right;color:#374151;">Ordered</th>
            <th style="padding:6px 10px;text-align:right;color:#374151;">Received</th>
          </tr></thead>
          <tbody>${(po.lines || []).map((l) => `
            <tr style="border-bottom:1px solid #f3f4f6;">
              <td style="padding:6px 10px;">${l.description}</td>
              <td style="padding:6px 10px;text-align:right;">${Number(l.quantity).toFixed(2)}</td>
              <td style="padding:6px 10px;text-align:right;color:${Number(l.receivedQty) >= Number(l.quantity) ? '#16a34a' : '#d97706'};">${Number(l.receivedQty).toFixed(2)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

  const body = `
    <div style="margin-bottom:20px;padding-bottom:16px;border-bottom:2px solid #1d4ed8;display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        <p style="margin:0;font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.1em;">Purchase Order</p>
        <p style="margin:4px 0 0;font-size:22px;font-weight:800;color:#1d4ed8;">${po.poNumber}</p>
      </div>
      <div style="text-align:right;font-size:12px;color:#374151;">
        <p style="margin:0;"><strong>Status:</strong> <span style="background:#dbeafe;color:#1e40af;padding:2px 8px;border-radius:4px;font-weight:600;">${STATUS_LABEL[po.status] || po.status}</span></p>
        <p style="margin:4px 0 0;"><strong>Order Date:</strong> ${dateFmt(po.orderDate)}</p>
        ${po.expectedDate ? `<p style="margin:2px 0 0;"><strong>Expected:</strong> ${dateFmt(po.expectedDate)}</p>` : ''}
      </div>
    </div>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-bottom:20px;">
      <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;">Bill To / Vendor</p>
      <p style="margin:0;font-size:14px;font-weight:700;color:#0f172a;">${po.vendor?.name || '—'}</p>
      ${po.vendor?.tin ? `<p style="margin:3px 0 0;font-size:12px;color:#475569;">TIN: ${po.vendor.tin}</p>` : ''}
      ${po.vendor?.address ? `<p style="margin:2px 0 0;font-size:12px;color:#475569;">${po.vendor.address}</p>` : ''}
      ${po.vendor?.contactName ? `<p style="margin:2px 0 0;font-size:12px;color:#475569;">Attn: ${po.vendor.contactName}</p>` : ''}
      ${po.vendor?.email ? `<p style="margin:2px 0 0;font-size:12px;color:#475569;">${po.vendor.email}</p>` : ''}
      ${po.vendor?.phone ? `<p style="margin:2px 0 0;font-size:12px;color:#475569;">${po.vendor.phone}</p>` : ''}
    </div>

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:8px;">
      <thead>
        <tr style="background:#1d4ed8;color:#fff;">
          <th style="padding:9px 10px;text-align:left;border-radius:6px 0 0 6px;">Description</th>
          <th style="padding:9px 10px;text-align:right;width:70px;">Qty</th>
          <th style="padding:9px 10px;text-align:right;width:110px;">Unit Price</th>
          <th style="padding:9px 10px;text-align:right;width:110px;border-radius:0 6px 6px 0;">Amount</th>
        </tr>
      </thead>
      <tbody>${lineRows}</tbody>
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px;">
      <tr>
        <td style="width:55%"></td>
        <td style="padding:5px 10px;color:#6b7280;border-top:1px solid #e5e7eb;">Subtotal</td>
        <td style="padding:5px 10px;text-align:right;border-top:1px solid #e5e7eb;">${phpFmt(po.subtotal)}</td>
      </tr>
      <tr>
        <td></td>
        <td style="padding:5px 10px;color:#6b7280;">Tax / VAT</td>
        <td style="padding:5px 10px;text-align:right;">${phpFmt(po.taxAmount)}</td>
      </tr>
      <tr style="background:#eff6ff;">
        <td></td>
        <td style="padding:9px 10px;font-weight:700;color:#1e3a8a;border-top:2px solid #1d4ed8;">TOTAL</td>
        <td style="padding:9px 10px;text-align:right;font-weight:800;font-size:15px;color:#1d4ed8;border-top:2px solid #1d4ed8;">${phpFmt(po.total)}</td>
      </tr>
    </table>

    ${po.notes ? `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:20px;background:#fefce8;">
      <p style="margin:0 0 4px;font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;">Notes / Terms</p>
      <p style="margin:0;font-size:13px;color:#374151;">${po.notes}</p>
    </div>` : ''}

    ${receivedRows}

    <div style="margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;display:grid;grid-template-columns:1fr 1fr 1fr;gap:30px;font-size:12px;">
      ${['Prepared by', 'Checked by', 'Approved by'].map((label) => `
        <div>
          <p style="font-weight:700;color:#111827;margin:0 0 36px;">${label}:</p>
          <div style="border-top:1px solid #374151;padding-top:4px;color:#6b7280;">Signature / Date</div>
        </div>`).join('')}
    </div>`;

  await printDocument(`Purchase Order — ${po.poNumber}`, `Vendor: ${po.vendor?.name || ''}`, body);
}

// ─── View Modal ───────────────────────────────────────────────
function POViewModal({ po, onClose, onEdit, onSend, onReceive, onConvert, onCancel }) {
  const subtotal = (po.lines || []).reduce((s, l) => s + Number(l.quantity) * Number(l.unitPrice), 0);

  return (
    <div className="modal-overlay">
      <div className="modal max-w-3xl">
        {/* Header */}
        <div className="modal-header">
          <div className="flex items-center gap-3">
            <div>
              <h3 className="text-lg font-bold text-blue-700">{po.poNumber}</h3>
              <span className={STATUS_BADGE[po.status]}>{STATUS_LABEL[po.status] || po.status}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => printPO(po)} className="btn-secondary btn-sm flex items-center gap-1.5">
              <Printer className="w-3.5 h-3.5" /> Print
            </button>
            {['DRAFT', 'SENT'].includes(po.status) && (
              <button onClick={onEdit} className="btn-secondary btn-sm flex items-center gap-1.5">
                <Edit2 className="w-3.5 h-3.5" /> Edit
              </button>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl ml-1">&times;</button>
          </div>
        </div>

        <div className="modal-body space-y-5">
          {/* Meta info */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Vendor', value: po.vendor?.name },
              { label: 'Order Date', value: formatDate(po.orderDate) },
              { label: 'Expected Date', value: po.expectedDate ? formatDate(po.expectedDate) : '—' },
              { label: 'Created', value: formatDate(po.createdAt) },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-gray-400 font-medium">{label}</p>
                <p className="text-sm font-semibold text-gray-800 mt-0.5">{value || '—'}</p>
              </div>
            ))}
          </div>

          {po.vendor && (
            <div className="bg-blue-50 rounded-xl px-4 py-3 text-sm">
              <p className="font-semibold text-blue-900">{po.vendor.name}</p>
              {po.vendor.tin && <p className="text-blue-700 text-xs mt-0.5">TIN: {po.vendor.tin}</p>}
              {po.vendor.address && <p className="text-blue-600 text-xs">{po.vendor.address}</p>}
              {po.vendor.contactName && <p className="text-blue-600 text-xs">Attn: {po.vendor.contactName} {po.vendor.email ? `· ${po.vendor.email}` : ''}</p>}
            </div>
          )}

          {/* Line items */}
          <div className="overflow-x-auto rounded-xl border border-gray-100">
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>Description</th>
                  <th className="text-right w-20">Qty</th>
                  <th className="text-right w-28">Unit Price</th>
                  <th className="text-right w-28">Amount</th>
                  <th className="text-right w-24 text-green-700">Received</th>
                </tr>
              </thead>
              <tbody>
                {(po.lines || []).map((l, i) => {
                  const amount = Number(l.quantity) * Number(l.unitPrice);
                  const recv   = Number(l.receivedQty || 0);
                  const full   = recv >= Number(l.quantity);
                  return (
                    <tr key={i}>
                      <td className="font-medium">{l.description}</td>
                      <td className="text-right font-mono">{Number(l.quantity).toFixed(2)}</td>
                      <td className="text-right font-mono">{formatCurrency(l.unitPrice)}</td>
                      <td className="text-right font-mono font-semibold">{formatCurrency(amount)}</td>
                      <td className={`text-right font-mono text-xs ${full ? 'text-green-600 font-semibold' : recv > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                        {recv > 0 ? `${recv.toFixed(2)}` : '—'}
                        {full && <CheckCircle2 className="inline w-3 h-3 ml-1 mb-0.5" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Totals */}
          <div className="flex justify-end">
            <div className="w-64 space-y-1.5 text-sm">
              <div className="flex justify-between text-gray-500">
                <span>Subtotal</span><span className="font-mono">{formatCurrency(subtotal)}</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span>Tax / VAT</span><span className="font-mono">{formatCurrency(po.taxAmount)}</span>
              </div>
              <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2 mt-1">
                <span>Total</span><span className="font-mono text-blue-700">{formatCurrency(po.total)}</span>
              </div>
            </div>
          </div>

          {po.notes && (
            <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-sm text-amber-800">
              <p className="font-semibold text-xs text-amber-600 mb-1">NOTES</p>
              {po.notes}
            </div>
          )}
        </div>

        {/* Action footer */}
        <div className="modal-footer flex-wrap gap-2">
          <button onClick={onClose} className="btn-secondary">Close</button>
          <div className="flex gap-2 flex-wrap">
            {po.status === 'DRAFT' && (
              <button onClick={onSend} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700">
                <Send className="w-3.5 h-3.5" /> Mark as Sent
              </button>
            )}
            {['SENT', 'PARTIAL'].includes(po.status) && (
              <button onClick={onReceive} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700">
                <PackageCheck className="w-3.5 h-3.5" /> Receive Goods
              </button>
            )}
            {['SENT', 'PARTIAL', 'RECEIVED'].includes(po.status) && (
              <button onClick={onConvert} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700">
                <FileText className="w-3.5 h-3.5" /> Convert to Bill
              </button>
            )}
            {!['BILLED', 'CANCELLED'].includes(po.status) && (
              <button onClick={onCancel} className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-red-100 text-red-700 text-sm font-medium hover:bg-red-200">
                <XCircle className="w-3.5 h-3.5" /> Cancel PO
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Create / Edit Modal ──────────────────────────────────────
function POModal({ po, vendors, accounts, onClose, onSaved, onVendorAdded }) {
  const [form, setForm] = useState(po ? {
    vendorId:     po.vendorId,
    orderDate:    po.orderDate?.split('T')[0] || new Date().toISOString().split('T')[0],
    expectedDate: po.expectedDate?.split('T')[0] || '',
    notes:        po.notes || '',
    taxAmount:    po.taxAmount || 0,
    lines:        po.lines?.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, accountId: l.accountId || '' })) || [emptyLine()],
  } : {
    vendorId: '', orderDate: new Date().toISOString().split('T')[0],
    expectedDate: '', notes: '', taxAmount: 0, lines: [emptyLine(), emptyLine()],
  });
  const [saving, setSaving] = useState(false);

  const subtotal = form.lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unitPrice || 0), 0);
  const total    = subtotal + Number(form.taxAmount || 0);

  const setLine = (i, f, v) => setForm((p) => ({ ...p, lines: p.lines.map((l, idx) => idx === i ? { ...l, [f]: v } : l) }));
  const addLine = () => setForm((p) => ({ ...p, lines: [...p.lines, emptyLine()] }));
  const rmLine  = (i) => setForm((p) => ({ ...p, lines: p.lines.filter((_, idx) => idx !== i) }));

  const submit = async (e) => {
    e.preventDefault();
    const lines = form.lines.filter((l) => l.description && Number(l.quantity) > 0);
    if (!form.vendorId) return toast.error('Select a vendor');
    if (!lines.length)  return toast.error('Add at least one line item');
    setSaving(true);
    try {
      const payload = { ...form, lines, vendorId: Number(form.vendorId) };
      if (po?.id) await poApi.update(po.id, payload);
      else         await poApi.create(payload);
      toast.success(po?.id ? 'Purchase order updated' : 'Purchase order created');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Save failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-4xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{po?.id ? `Edit — ${po.poNumber}` : 'New Purchase Order'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="form-group sm:col-span-1">
                <label className="label">Vendor *</label>
                <VendorSelect vendors={vendors} value={form.vendorId} onChange={(id) => setForm((f) => ({ ...f, vendorId: id }))} onVendorAdded={onVendorAdded} required />
              </div>
              <div className="form-group">
                <label className="label">Order Date *</label>
                <input type="date" className="input" value={form.orderDate} onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))} required />
              </div>
              <div className="form-group">
                <label className="label">Expected Delivery Date</label>
                <input type="date" className="input" value={form.expectedDate || ''} onChange={(e) => setForm((f) => ({ ...f, expectedDate: e.target.value }))} />
              </div>
            </div>

            <div className="form-group">
              <label className="label">Notes / Terms</label>
              <textarea className="input" rows={2} value={form.notes || ''} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Payment terms, delivery instructions, etc." />
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="label mb-0">Line Items</label>
                <button type="button" onClick={addLine} className="btn-secondary btn-sm">+ Add Line</button>
              </div>
              <div className="overflow-x-auto rounded-xl border border-gray-100">
                <table className="table text-sm">
                  <thead>
                    <tr>
                      <th>Description</th>
                      <th className="w-20 text-right">Qty</th>
                      <th className="w-28 text-right">Unit Price</th>
                      <th className="w-48">Expense Account</th>
                      <th className="w-28 text-right">Amount</th>
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((l, i) => (
                      <tr key={i}>
                        <td><input className="input w-full text-xs" placeholder="Item description" value={l.description} onChange={(e) => setLine(i, 'description', e.target.value)} /></td>
                        <td><input type="number" min="0" step="0.01" className="input w-full text-right text-xs" value={l.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></td>
                        <td><input type="number" min="0" step="0.01" className="input w-full text-right text-xs" value={l.unitPrice} onChange={(e) => setLine(i, 'unitPrice', e.target.value)} /></td>
                        <td>
                          <AccountSelect
                            value={l.accountId || ''}
                            onChange={(val) => setLine(i, 'accountId', val)}
                            accounts={accounts}
                            placeholder="-- for billing --"
                          />
                        </td>
                        <td className="text-right font-mono text-xs font-medium">
                          {formatCurrency(Number(l.quantity || 0) * Number(l.unitPrice || 0))}
                        </td>
                        <td>
                          {form.lines.length > 1 && (
                            <button type="button" onClick={() => rmLine(i)} className="text-red-400 hover:text-red-600 text-lg leading-none">&times;</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex justify-end gap-6 mt-3 text-sm items-center">
                <span className="text-gray-500">Subtotal: <span className="font-mono font-medium text-gray-800">{formatCurrency(subtotal)}</span></span>
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 whitespace-nowrap">Tax / VAT:</span>
                  <input type="number" min="0" step="0.01" className="input w-32 text-right text-sm"
                    value={form.taxAmount} onChange={(e) => setForm((f) => ({ ...f, taxAmount: e.target.value }))} />
                </div>
                <span className="font-bold text-base">Total: <span className="font-mono text-blue-700">{formatCurrency(total)}</span></span>
              </div>
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{saving ? 'Saving…' : po?.id ? 'Update PO' : 'Create PO'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Receive Goods Modal ──────────────────────────────────────
function ReceiveModal({ po, onClose, onSaved }) {
  const [lines, setLines] = useState(
    po.lines.map((l) => ({ id: l.id, description: l.description, quantity: Number(l.quantity), receivedQty: Number(l.receivedQty || 0) }))
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await poApi.receive(po.id, { lines: lines.map((l) => ({ id: l.id, receivedQty: l.receivedQty })) });
      toast.success('Goods received updated');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-xl">
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">Receive Goods</h3>
            <p className="text-xs text-gray-400">{po.poNumber} · {po.vendor?.name}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <div className="modal-body space-y-3">
          <p className="text-xs text-gray-500">Enter the quantity actually received for each line item.</p>
          <div className="rounded-xl border border-gray-100 overflow-hidden">
            <table className="table text-sm">
              <thead><tr><th>Item</th><th className="text-right">Ordered</th><th className="text-right w-32">Qty Received</th></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const pct = l.quantity > 0 ? (l.receivedQty / l.quantity) * 100 : 0;
                  return (
                    <tr key={l.id}>
                      <td>
                        <p className="font-medium text-sm">{l.description}</p>
                        <div className="h-1 bg-gray-100 rounded-full mt-1 w-24">
                          <div className="h-1 rounded-full bg-green-500 transition-all" style={{ width: `${Math.min(100, pct)}%` }} />
                        </div>
                      </td>
                      <td className="text-right font-mono">{l.quantity.toFixed(2)}</td>
                      <td>
                        <input type="number" min="0" max={l.quantity} step="0.01" className="input w-full text-right"
                          value={l.receivedQty}
                          onChange={(e) => setLines((p) => p.map((x, idx) => idx === i ? { ...x, receivedQty: Number(e.target.value) } : x))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex justify-end gap-4 text-xs text-gray-500 pt-1">
            <button type="button" onClick={() => setLines((p) => p.map((l) => ({ ...l, receivedQty: l.quantity })))}
              className="text-green-600 hover:underline">Mark All Received</button>
            <button type="button" onClick={() => setLines((p) => p.map((l) => ({ ...l, receivedQty: 0 })))}
              className="text-red-500 hover:underline">Clear All</button>
          </div>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-1.5">
            <PackageCheck className="w-4 h-4" /> {saving ? 'Saving…' : 'Confirm Receipt'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Convert to Bill Modal ────────────────────────────────────
function ConvertModal({ po, onClose, onSaved }) {
  const today = new Date().toISOString().split('T')[0];
  const due30 = new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0];
  const [billDate, setBillDate] = useState(today);
  const [dueDate,  setDueDate]  = useState(due30);
  const [saving,   setSaving]   = useState(false);

  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await poApi.toBill(po.id, { billDate, dueDate });
      toast.success(data.message || 'Bill created successfully');
      onSaved();
    } catch (err) { toast.error(err.response?.data?.error || 'Conversion failed'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-sm">
        <div className="modal-header">
          <h3 className="font-semibold">Convert to AP Bill</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl">&times;</button>
        </div>
        <div className="modal-body space-y-4">
          <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-sm text-purple-800">
            <p className="font-semibold">{po.poNumber} → {po.vendor?.name}</p>
            <p className="text-xs mt-1 text-purple-600">Total: <strong>{formatCurrency(po.total)}</strong></p>
          </div>
          <p className="text-xs text-gray-500">This will create an AP Bill and post the journal entry to the General Ledger.</p>
          <div className="form-group">
            <label className="label">Bill Date *</label>
            <input type="date" className="input" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label">Due Date *</label>
            <input type="date" className="input" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
          <p className="text-xs text-gray-400">Make sure all line items have an expense account before converting.</p>
        </div>
        <div className="modal-footer">
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={submit} disabled={saving} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-60">
            <FileText className="w-4 h-4" /> {saving ? 'Converting…' : 'Convert to Bill'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function PurchaseOrdersPage() {
  const [rows,     setRows]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [vendors,  setVendors]  = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [search,   setSearch]   = useState('');
  const [filter,   setFilter]   = useState('');

  // Modal states
  const [viewPO,    setViewPO]    = useState(null);
  const [editPO,    setEditPO]    = useState(null);
  const [newPO,     setNewPO]     = useState(false);
  const [receivePO, setReceivePO] = useState(null);
  const [convertPO, setConvertPO] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    poApi.list({ status: filter, limit: 200 })
      .then((r) => setRows(r.data.data))
      .catch(() => toast.error('Failed to load purchase orders'))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    payable.vendors.list().then((r) => setVendors(r.data.data || r.data)).catch(() => {});
    acctApi.list({ active: true }).then((r) => setAccounts(r.data)).catch(() => {});
  }, []);

  const doSend = async (po) => {
    try { await poApi.send(po.id); toast.success(`${po.poNumber} marked as sent`); load(); if (viewPO?.id === po.id) setViewPO(null); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };
  const doCancel = async (po) => {
    if (!confirm(`Cancel ${po.poNumber}? This cannot be undone.`)) return;
    try { await poApi.cancel(po.id); toast.success('PO cancelled'); load(); setViewPO(null); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };
  const doDelete = async (po) => {
    if (!confirm(`Permanently delete ${po.poNumber}?`)) return;
    try { await poApi.remove(po.id); toast.success('Deleted'); load(); }
    catch (e) { toast.error(e.response?.data?.error || 'Failed'); }
  };

  // Filtered list
  const displayed = rows.filter((po) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return po.poNumber?.toLowerCase().includes(q) || po.vendor?.name?.toLowerCase().includes(q);
  });

  // Status counts
  const counts = ALL_STATUSES.reduce((acc, s) => ({ ...acc, [s]: rows.filter((r) => r.status === s).length }), {});

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchase Orders</h1>
          <p className="page-subtitle">{rows.length} total orders</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setNewPO(true)}>
          <Plus className="w-4 h-4" /> New PO
        </button>
      </div>

      {/* Status filter chips */}
      <div className="flex flex-wrap gap-2 mb-4">
        <button
          onClick={() => setFilter('')}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${!filter ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}
        >
          All <span className="ml-1 opacity-70">{rows.length}</span>
        </button>
        {ALL_STATUSES.map((s) => (
          <button key={s}
            onClick={() => setFilter(filter === s ? '' : s)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${filter === s ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}
          >
            {STATUS_LABEL[s]} {counts[s] > 0 && <span className="ml-1 opacity-70">{counts[s]}</span>}
          </button>
        ))}
      </div>

      {/* Search + table */}
      <div className="card">
        <div className="card-body py-3 border-b border-gray-100">
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
            <input className="input pl-9 text-sm" placeholder="Search PO number or vendor…"
              value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>PO Number</th>
                <th>Vendor</th>
                <th>Order Date</th>
                <th>Expected</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">Loading…</td></tr>
              ) : displayed.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-10 text-gray-400">
                  {search ? `No results for "${search}"` : 'No purchase orders yet.'}
                </td></tr>
              ) : displayed.map((po) => (
                <tr key={po.id} className="cursor-pointer hover:bg-blue-50/40" onClick={() => setViewPO(po)}>
                  <td>
                    <span className="font-mono font-semibold text-blue-700">{po.poNumber}</span>
                  </td>
                  <td className="font-medium">{po.vendor?.name}</td>
                  <td className="text-gray-500 text-sm">{formatDate(po.orderDate)}</td>
                  <td className="text-gray-400 text-sm">{po.expectedDate ? formatDate(po.expectedDate) : '—'}</td>
                  <td className="text-right font-mono font-semibold">{formatCurrency(po.total)}</td>
                  <td><span className={STATUS_BADGE[po.status]}>{STATUS_LABEL[po.status]}</span></td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setViewPO(po)} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50" title="View">
                        <Eye className="w-4 h-4" />
                      </button>
                      <button onClick={() => printPO(po)} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100" title="Print">
                        <Printer className="w-4 h-4" />
                      </button>
                      {['DRAFT', 'SENT'].includes(po.status) && (
                        <button onClick={() => { setEditPO(po); }} className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50" title="Edit">
                          <Edit2 className="w-4 h-4" />
                        </button>
                      )}
                      {['DRAFT', 'CANCELLED'].includes(po.status) && (
                        <button onClick={() => doDelete(po)} className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50" title="Delete">
                          <Trash2 className="w-4 h-4" />
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

      {/* Modals */}
      {newPO && (
        <POModal vendors={vendors} accounts={accounts}
          onClose={() => setNewPO(false)}
          onSaved={() => { setNewPO(false); load(); }}
          onVendorAdded={(v) => setVendors((p) => [v, ...p])} />
      )}
      {editPO && (
        <POModal po={editPO} vendors={vendors} accounts={accounts}
          onClose={() => setEditPO(null)}
          onSaved={() => { setEditPO(null); load(); }}
          onVendorAdded={(v) => setVendors((p) => [v, ...p])} />
      )}
      {viewPO && (
        <POViewModal
          po={viewPO}
          onClose={() => setViewPO(null)}
          onEdit={() => { setEditPO(viewPO); setViewPO(null); }}
          onSend={() => doSend(viewPO)}
          onReceive={() => { setReceivePO(viewPO); setViewPO(null); }}
          onConvert={() => { setConvertPO(viewPO); setViewPO(null); }}
          onCancel={() => doCancel(viewPO)}
        />
      )}
      {receivePO && (
        <ReceiveModal po={receivePO}
          onClose={() => setReceivePO(null)}
          onSaved={() => { setReceivePO(null); load(); }} />
      )}
      {convertPO && (
        <ConvertModal po={convertPO}
          onClose={() => setConvertPO(null)}
          onSaved={() => { setConvertPO(null); load(); }} />
      )}
    </div>
  );
}
