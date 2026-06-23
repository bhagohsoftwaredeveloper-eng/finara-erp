'use client';
import { useState, useEffect, useCallback } from 'react';
import { receivable as rApi, accounts as acctApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Plus, Search, Eye, DollarSign, Ban, Filter, X,
  AlertCircle, Clock, CheckCircle2, FileText, Receipt,
  Printer, ChevronDown, ChevronUp,
} from 'lucide-react';
import { printDocument, phpFmt, dateFmt, badge } from '@/lib/print';
import { formatCurrency, formatDate } from '@/lib/auth';

// ─── Constants ────────────────────────────────────────────────
const VAT_CODES   = ['VAT', 'ZERO', 'EXEMPT'];
const STATUSES    = ['OPEN', 'PARTIAL', 'PAID', 'OVERDUE', 'VOID'];
const PAY_METHODS = ['Cash', 'Check', 'Bank Transfer', 'Online Banking', 'GCash', 'Maya', 'PESONet', 'InstaPay'];

const STATUS_BADGE = {
  OPEN:    'badge-blue',
  PARTIAL: 'badge-yellow',
  PAID:    'badge-green',
  OVERDUE: 'badge-red',
  VOID:    'badge-gray',
};
const STATUS_ICON = {
  OPEN:    <Clock className="w-3 h-3" />,
  PARTIAL: <AlertCircle className="w-3 h-3" />,
  PAID:    <CheckCircle2 className="w-3 h-3" />,
  OVERDUE: <AlertCircle className="w-3 h-3" />,
  VOID:    <Ban className="w-3 h-3" />,
};

const computeVAT = (amount, code) =>
  code === 'VAT'
    ? { base: amount, vat: amount * 0.12, total: amount * 1.12 }
    : { base: amount, vat: 0, total: amount };

// ─── Invoice Detail Modal ─────────────────────────────────────
function InvoiceDetailModal({ invoice, onClose, onCollect, onVoid }) {
  const balance = Number(invoice.totalAmount) - Number(invoice.paidAmount);
  const pct = invoice.totalAmount > 0
    ? (Number(invoice.paidAmount) / Number(invoice.totalAmount)) * 100
    : 0;
  const isOverdue =
    ['OPEN', 'PARTIAL'].includes(invoice.status) &&
    new Date(invoice.dueDate) < new Date();

  const handlePrint = () => {
    const linesHTML = (invoice.lines || []).map((l) => `
      <tr>
        <td class="mono blue small">${l.account?.accountCode || '—'}</td>
        <td>${l.description || '—'}</td>
        <td class="center"><span class="badge ${l.vatCode === 'VAT' ? 'b-blue' : l.vatCode === 'ZERO' ? 'b-gray' : 'b-yellow'}">${l.vatCode}</span></td>
        <td class="right">${Number(l.quantity).toLocaleString()}</td>
        <td class="right mono">${phpFmt(l.unitPrice)}</td>
        <td class="right mono bold">${phpFmt(l.amount)}</td>
      </tr>`).join('');

    const paymentsHTML = (invoice.payments || []).length > 0 ? `
      <div class="section-title">Collection History</div>
      <table>
        <thead><tr><th>Date</th><th>Reference No.</th><th>Method</th><th class="right">Amount</th></tr></thead>
        <tbody>${invoice.payments.map((p) => `
          <tr>
            <td>${dateFmt(p.paymentDate)}</td>
            <td class="mono small">${p.paymentNo || p.reference || '—'}</td>
            <td>${p.paymentMethod}</td>
            <td class="right mono green bold">${phpFmt(p.amount)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : '';

    const overdueNote = isOverdue
      ? `<div class="desc-box" style="border-color:#fecaca;background:#fff5f5;color:#b91c1c;">
           ⚠ This invoice is overdue by ${Math.floor((new Date() - new Date(invoice.dueDate)) / 86400000)} day(s). Due: ${dateFmt(invoice.dueDate)}
         </div>` : '';

    const body = `
      <div class="info-grid">
        <div class="info-box"><div class="info-lbl">Invoice No.</div><div class="info-val mono">${invoice.invoiceNo}</div></div>
        <div class="info-box"><div class="info-lbl">Customer</div><div class="info-val">${invoice.customer?.name || '—'}</div></div>
        <div class="info-box"><div class="info-lbl">Status</div><div class="info-val">${badge(invoice.status)}</div></div>
        <div class="info-box"><div class="info-lbl">Invoice Date</div><div class="info-val">${dateFmt(invoice.invoiceDate)}</div></div>
        <div class="info-box"><div class="info-lbl">Due Date</div><div class="info-val">${dateFmt(invoice.dueDate)}</div></div>
        <div class="info-box"><div class="info-lbl">Customer TIN</div><div class="info-val mono small">${invoice.customer?.tin || '—'}</div></div>
      </div>
      ${invoice.description ? `<div class="desc-box">${invoice.description}</div>` : ''}
      ${overdueNote}
      <div class="section-title">Line Items</div>
      <table>
        <thead><tr><th>Account</th><th>Description</th><th class="center">VAT</th><th class="right">Qty</th><th class="right">Unit Price</th><th class="right">Amount</th></tr></thead>
        <tbody>${linesHTML}</tbody>
      </table>
      <div class="totals-block" style="max-width:320px;margin-left:auto;margin-top:12px;">
        <div class="totals-row"><span class="gray">Subtotal (ex-VAT)</span><span class="mono">${phpFmt(invoice.subtotal)}</span></div>
        <div class="totals-row"><span class="gray">VAT (12%)</span><span class="mono">${phpFmt(invoice.vatAmount)}</span></div>
        <div class="totals-divider"></div>
        <div class="totals-row totals-total"><span>Total Amount</span><span class="mono">${phpFmt(invoice.totalAmount)}</span></div>
        <div class="totals-row green"><span>Collected</span><span class="mono">(${phpFmt(invoice.paidAmount)})</span></div>
        <div class="totals-row ${balance > 0 ? 'red' : 'green'} bold"><span>Balance Receivable</span><span class="mono">${phpFmt(balance)}</span></div>
      </div>
      ${paymentsHTML}`;

    printDocument(`Invoice — ${invoice.invoiceNo}`, `${invoice.customer?.name || ''} · ${dateFmt(invoice.invoiceDate)}`, body);
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-2xl">
        {/* Header */}
        <div className="modal-header">
          <div>
            <h3 className="text-lg font-semibold">{invoice.invoiceNo}</h3>
            <p className="text-sm text-gray-500">{invoice.customer?.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`${STATUS_BADGE[invoice.status]} flex items-center gap-1`}>
              {STATUS_ICON[invoice.status]} {invoice.status}
            </span>
            {isOverdue && invoice.status !== 'VOID' && (
              <span className="badge-red flex items-center gap-1 text-xs">
                <AlertCircle className="w-3 h-3" /> Overdue
              </span>
            )}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none ml-2">&times;</button>
          </div>
        </div>

        <div className="modal-body space-y-5">
          {/* Info grid */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <span className="text-gray-500 block text-xs uppercase tracking-wide mb-0.5">Invoice Date</span>
              <span className="font-medium">{formatDate(invoice.invoiceDate)}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-xs uppercase tracking-wide mb-0.5">Due Date</span>
              <span className={`font-medium ${isOverdue ? 'text-red-600' : ''}`}>
                {formatDate(invoice.dueDate)}
                {isOverdue && <span className="text-xs block text-red-500">
                  {Math.floor((new Date() - new Date(invoice.dueDate)) / 86400000)} days overdue
                </span>}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block text-xs uppercase tracking-wide mb-0.5">Customer TIN</span>
              <span className="font-mono text-xs">{invoice.customer?.tin || '—'}</span>
            </div>
          </div>

          {invoice.description && (
            <div className="bg-blue-50 rounded-lg p-3 text-sm text-gray-700 border border-blue-100">
              {invoice.description}
            </div>
          )}

          {/* Line items */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Line Items</h4>
            <div className="table-wrapper">
              <table className="table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Description</th>
                    <th>VAT</th>
                    <th className="text-right">Qty</th>
                    <th className="text-right">Unit Price</th>
                    <th className="text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoice.lines?.map((l, i) => (
                    <tr key={i}>
                      <td className="font-mono text-xs text-blue-700">{l.account?.accountCode || '—'}</td>
                      <td className="text-sm">{l.description}</td>
                      <td>
                        <span className={
                          l.vatCode === 'VAT'    ? 'badge-blue'
                          : l.vatCode === 'ZERO' ? 'badge-gray'
                          : 'badge-yellow'
                        }>{l.vatCode}</span>
                      </td>
                      <td className="text-right">{Number(l.quantity).toLocaleString()}</td>
                      <td className="text-right">{formatCurrency(l.unitPrice)}</td>
                      <td className="text-right font-medium">{formatCurrency(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-600">Subtotal (ex-VAT)</span>
              <span>{formatCurrency(invoice.subtotal)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600">VAT (12%)</span>
              <span>{formatCurrency(invoice.vatAmount)}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2">
              <span>Total Amount</span>
              <span>{formatCurrency(invoice.totalAmount)}</span>
            </div>
            <div className="flex justify-between text-green-600">
              <span>Collected</span>
              <span>({formatCurrency(invoice.paidAmount)})</span>
            </div>
            <div className={`flex justify-between font-bold text-base pt-1 ${balance > 0 ? 'text-red-600' : 'text-green-600'}`}>
              <span>Balance Receivable</span>
              <span>{formatCurrency(balance)}</span>
            </div>
          </div>

          {/* Collection progress bar */}
          {invoice.totalAmount > 0 && (
            <div>
              <div className="flex justify-between text-xs text-gray-500 mb-1">
                <span>Collection Progress</span>
                <span>{pct.toFixed(1)}% collected</span>
              </div>
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 rounded-full transition-all duration-500"
                  style={{ width: `${Math.min(100, pct)}%` }}
                />
              </div>
            </div>
          )}

          {/* Collection history */}
          {invoice.payments?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Collection History</h4>
              <div className="space-y-2">
                {invoice.payments.map((p) => (
                  <div key={p.id} className="flex items-center justify-between bg-green-50 border border-green-100 rounded-lg px-3 py-2 text-sm">
                    <div>
                      <span className="font-semibold text-gray-800">{formatCurrency(p.amount)}</span>
                      <span className="text-gray-500 ml-2">via {p.paymentMethod}</span>
                      {p.reference && (
                        <span className="text-gray-400 ml-2 text-xs">Ref: {p.reference}</span>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">{formatDate(p.paymentDate)}</p>
                      <p className="text-xs font-mono text-gray-400">{p.paymentNo}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="modal-footer">
          {invoice.status === 'VOID' ? (
            <span className="text-gray-400 text-sm mr-auto">This invoice has been voided.</span>
          ) : (
            <>
              {invoice.paidAmount == 0 && (
                <button onClick={onVoid} className="btn-danger btn-sm mr-auto">
                  <Ban className="w-4 h-4" /> Void
                </button>
              )}
              {invoice.status !== 'PAID' && (
                <button onClick={onCollect} className="btn-success">
                  <DollarSign className="w-4 h-4" /> Record Collection
                </button>
              )}
            </>
          )}
          <button onClick={handlePrint} className="btn-secondary">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={onClose} className="btn-secondary">Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Collection Modal ─────────────────────────────────────────
function CollectionModal({ invoice, onClose, onCollected }) {
  const balance = Number(invoice.totalAmount) - Number(invoice.paidAmount);
  const [form, setForm] = useState({
    paymentDate:   new Date().toISOString().split('T')[0],
    amount:        balance.toFixed(2),
    paymentMethod: 'Bank Transfer',
    reference:     '',
    notes:         '',
  });
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (Number(form.amount) > balance + 0.01) {
      toast.error(`Amount exceeds receivable balance of ${formatCurrency(balance)}`);
      return;
    }
    setSaving(true);
    try {
      await rApi.invoices.payment(invoice.id, { ...form, amount: Number(form.amount) });
      toast.success('Collection recorded successfully');
      onCollected();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Collection failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">Record Collection</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-4">
            {/* Invoice summary */}
            <div className="bg-green-50 border border-green-100 rounded-xl p-4 text-sm space-y-1.5">
              <div className="flex justify-between">
                <span className="text-gray-600">Invoice</span>
                <span className="font-mono font-medium">{invoice.invoiceNo}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Customer</span>
                <span className="font-medium">{invoice.customer?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Invoice Total</span>
                <span className="font-medium">{formatCurrency(invoice.totalAmount)}</span>
              </div>
              {invoice.paidAmount > 0 && (
                <div className="flex justify-between text-green-600">
                  <span>Already Collected</span>
                  <span>{formatCurrency(invoice.paidAmount)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base border-t border-green-200 pt-1.5">
                <span>Balance to Collect</span>
                <span className="text-blue-700">{formatCurrency(balance)}</span>
              </div>
            </div>

            <div className="form-group">
              <label className="label">Collection Date *</label>
              <input type="date" className="input" required value={form.paymentDate} onChange={set('paymentDate')} />
            </div>

            <div className="form-group">
              <label className="label">Amount Collected (₱) *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 font-medium">₱</span>
                <input
                  type="number" step="0.01" min="0.01" max={balance}
                  className="input pl-8"
                  required
                  value={form.amount}
                  onChange={set('amount')}
                />
              </div>
              <div className="flex gap-2 mt-1.5">
                {[25, 50, 75, 100].map((pct) => (
                  <button
                    key={pct}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, amount: (balance * pct / 100).toFixed(2) }))}
                    className="text-xs px-2 py-1 rounded-md bg-gray-100 hover:bg-blue-100 hover:text-blue-700 text-gray-600 transition-colors"
                  >
                    {pct}%
                  </button>
                ))}
              </div>
            </div>

            <div className="form-group">
              <label className="label">Payment Method *</label>
              <select className="select" required value={form.paymentMethod} onChange={set('paymentMethod')}>
                {PAY_METHODS.map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>

            <div className="form-group">
              <label className="label">Reference / OR No.</label>
              <input
                className="input"
                value={form.reference}
                onChange={set('reference')}
                placeholder="Official receipt no., transaction ID..."
              />
            </div>

            <div className="form-group">
              <label className="label">Notes</label>
              <textarea className="input resize-none" rows={2} value={form.notes} onChange={set('notes')} />
            </div>
          </div>
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-success">
              <DollarSign className="w-4 h-4" />
              {saving ? 'Recording...' : 'Record Collection'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Create Invoice Modal ─────────────────────────────────────
function CreateInvoiceModal({ customers, accounts, onClose, onSaved }) {
  const [form, setForm] = useState({
    customerId:   '',
    invoiceDate:  new Date().toISOString().split('T')[0],
    dueDate:      '',
    description:  '',
    lines: [
      { accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'VAT' },
    ],
  });
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const setLine = (i, k, v) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l, idx) => (idx === i ? { ...l, [k]: v } : l)) }));
  const addLine = () =>
    setForm((f) => ({
      ...f,
      lines: [...f.lines, { accountId: '', description: '', quantity: '1', unitPrice: '', vatCode: 'VAT' }],
    }));
  const removeLine = (i) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((_, idx) => idx !== i) }));

  // Auto due date: +30 days from invoice date
  useEffect(() => {
    if (form.invoiceDate && !form.dueDate) {
      const d = new Date(form.invoiceDate);
      d.setDate(d.getDate() + 30);
      setForm((f) => ({ ...f, dueDate: d.toISOString().split('T')[0] }));
    }
  }, [form.invoiceDate]);

  const revenueAccounts = accounts.filter((a) => a.accountType === 'REVENUE');

  const totals = form.lines.reduce(
    (s, l) => {
      const amt = (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
      const v = computeVAT(amt, l.vatCode);
      return { subtotal: s.subtotal + v.base, vat: s.vat + v.vat, total: s.total + v.total };
    },
    { subtotal: 0, vat: 0, total: 0 }
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    const validLines = form.lines.filter((l) => l.accountId && l.description && l.unitPrice);
    if (!validLines.length) { toast.error('Add at least one line item'); return; }
    setSaving(true);
    try {
      await rApi.invoices.create({
        ...form,
        customerId: Number(form.customerId),
        lines: validLines.map((l) => ({
          accountId:   Number(l.accountId),
          description: l.description,
          quantity:    Number(l.quantity),
          unitPrice:   Number(l.unitPrice),
          vatCode:     l.vatCode,
        })),
      });
      toast.success('Invoice created successfully');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create invoice');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-4xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">New Sales Invoice</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="modal-body space-y-5">
            {/* Header fields */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="label">Customer *</label>
                <select className="select" required value={form.customerId} onChange={set('customerId')}>
                  <option value="">Select customer...</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.customerCode} — {c.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Description / Memo</label>
                <input
                  className="input" value={form.description} onChange={set('description')}
                  placeholder="e.g. Professional services for July 2025"
                />
              </div>
              <div className="form-group">
                <label className="label">Invoice Date *</label>
                <input type="date" className="input" required value={form.invoiceDate} onChange={set('invoiceDate')} />
              </div>
              <div className="form-group">
                <label className="label">Due Date *</label>
                <input type="date" className="input" required value={form.dueDate} onChange={set('dueDate')} />
              </div>
            </div>

            {/* Line items */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-gray-700">Line Items</h4>
                <button type="button" onClick={addLine} className="btn-secondary btn-sm">
                  <Plus className="w-3 h-3" /> Add Line
                </button>
              </div>

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <table className="table">
                  <thead>
                    <tr>
                      <th className="w-48">Revenue Account</th>
                      <th>Description</th>
                      <th className="w-20">VAT</th>
                      <th className="w-20 text-right">Qty</th>
                      <th className="w-32 text-right">Unit Price (₱)</th>
                      <th className="w-36 text-right">Amount (₱)</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.lines.map((line, i) => {
                      const amt = (Number(line.quantity) || 0) * (Number(line.unitPrice) || 0);
                      const v   = computeVAT(amt, line.vatCode);
                      return (
                        <tr key={i} className="align-top">
                          <td className="py-2">
                            <select
                              className="select text-xs"
                              value={line.accountId}
                              onChange={(e) => setLine(i, 'accountId', e.target.value)}
                            >
                              <option value="">Select account...</option>
                              {revenueAccounts.map((a) => (
                                <option key={a.id} value={a.id}>{a.accountCode} — {a.accountName}</option>
                              ))}
                            </select>
                          </td>
                          <td className="py-2">
                            <input
                              className="input text-xs"
                              value={line.description}
                              onChange={(e) => setLine(i, 'description', e.target.value)}
                              placeholder="Item / service description"
                            />
                          </td>
                          <td className="py-2">
                            <select
                              className="select text-xs"
                              value={line.vatCode}
                              onChange={(e) => setLine(i, 'vatCode', e.target.value)}
                            >
                              {VAT_CODES.map((c) => <option key={c}>{c}</option>)}
                            </select>
                          </td>
                          <td className="py-2">
                            <input
                              type="number" step="0.001" min="0.001"
                              className="input text-xs text-right"
                              value={line.quantity}
                              onChange={(e) => setLine(i, 'quantity', e.target.value)}
                            />
                          </td>
                          <td className="py-2">
                            <input
                              type="number" step="0.01" min="0"
                              className="input text-xs text-right"
                              value={line.unitPrice}
                              onChange={(e) => setLine(i, 'unitPrice', e.target.value)}
                              placeholder="0.00"
                            />
                          </td>
                          <td className="py-2">
                            <div className="text-right text-sm font-semibold text-gray-800 py-2">
                              {formatCurrency(v.total)}
                            </div>
                            {line.vatCode === 'VAT' && amt > 0 && (
                              <div className="text-right text-xs text-gray-400">
                                Base: {formatCurrency(amt)}<br />VAT: {formatCurrency(v.vat)}
                              </div>
                            )}
                          </td>
                          <td className="py-2">
                            {form.lines.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeLine(i)}
                                className="p-1 text-gray-300 hover:text-red-500 transition-colors"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Totals summary */}
            <div className="flex justify-end">
              <div className="w-80 bg-gray-50 rounded-xl p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Subtotal (ex-VAT)</span>
                  <span className="font-medium">{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Output VAT (12%)</span>
                  <span className="font-medium">{formatCurrency(totals.vat)}</span>
                </div>
                <div className="flex justify-between font-bold text-base border-t border-gray-200 pt-2">
                  <span>Total Invoice Amount</span>
                  <span className="text-green-700">{formatCurrency(totals.total)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              <Receipt className="w-4 h-4" />
              {saving ? 'Creating Invoice...' : 'Create Invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Invoices Page ───────────────────────────────────────
const today = new Date().toISOString().split('T')[0];

export default function InvoicesPage() {
  const [invoices, setInvoices]   = useState([]);
  const [customers, setCustomers] = useState([]);
  const [accounts, setAccounts]   = useState([]);
  const [loading, setLoading]     = useState(true);
  const [total, setTotal]         = useState(0);
  const [page, setPage]           = useState(1);
  const [summary, setSummary]     = useState({ open: 0, overdue: 0, openCount: 0, collected: 0 });
  const [filter, setFilter]       = useState({ status: '', customerId: '', from: today, to: '', search: '' });
  const [showDateFilter, setShowDateFilter] = useState(false);
  const [modal, setModal]         = useState(null);
  const LIMIT = 15;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: LIMIT, ...filter };
      Object.keys(params).forEach((k) => !params[k] && delete params[k]);
      const r = await rApi.invoices.list(params);
      setInvoices(r.data.data);
      setTotal(r.data.total);

      const today = new Date();
      let open = 0, overdue = 0, openCount = 0, collected = 0;
      r.data.data.forEach((inv) => {
        if (inv.status === 'PAID') { collected += Number(inv.paidAmount); return; }
        if (['OPEN', 'PARTIAL'].includes(inv.status)) {
          const rem = Number(inv.totalAmount) - Number(inv.paidAmount);
          open += rem; openCount++;
          if (new Date(inv.dueDate) < today) overdue += rem;
        }
      });
      setSummary({ open, overdue, openCount, collected });
    } catch {
      toast.error('Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    rApi.customers.list({ active: true }).then((r) => setCustomers(r.data));
    acctApi.list({ active: true }).then((r) => setAccounts(r.data));
  }, []);

  const openInvoice = async (inv) => {
    try {
      const { data } = await rApi.invoices.get(inv.id);
      setModal({ type: 'detail', invoice: data });
    } catch { toast.error('Failed to load invoice details'); }
  };

  const handleVoid = async (inv) => {
    if (!confirm(`Void invoice ${inv.invoiceNo}? This cannot be undone.`)) return;
    try {
      await rApi.invoices.void(inv.id);
      toast.success('Invoice voided');
      load();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Cannot void this invoice');
    }
  };

  const clearFilter = () => setFilter({ status: '', customerId: '', from: today, to: '', search: '' });
  const activeFilters = Object.values(filter).filter(Boolean).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-subtitle">Accounts Receivable — {total} invoice{total !== 1 ? 's' : ''} total</p>
        </div>
        <button className="btn-primary" onClick={() => setModal({ type: 'create' })}>
          <Plus className="w-4 h-4" /> New Invoice
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {[
          {
            label: 'Open Receivables',
            value: formatCurrency(summary.open),
            sub: `${summary.openCount} invoice${summary.openCount !== 1 ? 's' : ''} open`,
            color: 'bg-blue-100 text-blue-600',
            icon: <Clock className="w-5 h-5" />,
          },
          {
            label: 'Overdue',
            value: formatCurrency(summary.overdue),
            sub: 'Past due date',
            color: 'bg-red-100 text-red-600',
            icon: <AlertCircle className="w-5 h-5" />,
          },
          {
            label: 'Page Total Billed',
            value: formatCurrency(invoices.reduce((s, i) => s + Number(i.totalAmount), 0)),
            sub: 'shown records',
            color: 'bg-purple-100 text-purple-600',
            icon: <Receipt className="w-5 h-5" />,
          },
          {
            label: 'Page Collected',
            value: formatCurrency(invoices.reduce((s, i) => s + Number(i.paidAmount), 0)),
            sub: 'amount received',
            color: 'bg-green-100 text-green-600',
            icon: <CheckCircle2 className="w-5 h-5" />,
          },
        ].map((s) => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.color}`}>
              {s.icon}
            </div>
            <div>
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-lg font-bold text-gray-900 leading-tight">{s.value}</p>
              <p className="text-xs text-gray-400">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="card">
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="input pl-9"
              placeholder="Search invoice no., customer..."
              value={filter.search}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            />
          </div>

          <select
            className="select w-36"
            value={filter.status}
            onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}
          >
            <option value="">All Status</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>

          <select
            className="select w-52"
            value={filter.customerId}
            onChange={(e) => setFilter((f) => ({ ...f, customerId: e.target.value }))}
          >
            <option value="">All Customers</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <button
            className="btn-secondary"
            onClick={() => setShowDateFilter(!showDateFilter)}
          >
            <Filter className="w-4 h-4" /> Date Range
            {activeFilters > 0 && (
              <span className="ml-1 w-5 h-5 rounded-full bg-blue-600 text-white text-xs flex items-center justify-center">
                {activeFilters}
              </span>
            )}
          </button>

          {activeFilters > 0 && (
            <button onClick={clearFilter} className="btn-secondary text-red-500 hover:text-red-600">
              <X className="w-4 h-4" /> Clear
            </button>
          )}
        </div>

        {showDateFilter && (
          <div className="px-6 pb-4 pt-3 flex gap-3 border-t border-gray-100">
            <div className="form-group">
              <label className="label">From</label>
              <input
                type="date" className="input"
                value={filter.from}
                onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="label">To</label>
              <input
                type="date" className="input"
                value={filter.to}
                onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))}
              />
            </div>
          </div>
        )}
      </div>

      {/* Invoices table */}
      <div className="card">
        <div className="table-wrapper">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice No.</th>
                <th>Customer</th>
                <th>Invoice Date</th>
                <th>Due Date</th>
                <th className="text-right">Total</th>
                <th className="text-right">Collected</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
                <th className="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-12">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
                      Loading invoices...
                    </div>
                  </td>
                </tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-12">
                    <div className="flex flex-col items-center gap-3 text-gray-400">
                      <Receipt className="w-10 h-10 text-gray-200" />
                      <p>No invoices found.</p>
                      <button
                        className="btn-primary btn-sm"
                        onClick={() => setModal({ type: 'create' })}
                      >
                        <Plus className="w-3 h-3" /> Create First Invoice
                      </button>
                    </div>
                  </td>
                </tr>
              ) : invoices.map((inv) => {
                const balance   = Number(inv.totalAmount) - Number(inv.paidAmount);
                const isOverdue = ['OPEN', 'PARTIAL'].includes(inv.status) && new Date(inv.dueDate) < new Date();
                return (
                  <tr
                    key={inv.id}
                    className="cursor-pointer hover:bg-green-50/40 transition-colors"
                    onClick={() => openInvoice(inv)}
                  >
                    <td>
                      <span className="font-mono font-medium text-green-700 text-sm">{inv.invoiceNo}</span>
                    </td>
                    <td>
                      <div className="font-medium text-gray-900">{inv.customer?.name}</div>
                      <div className="text-xs text-gray-400">{inv.customer?.customerCode}</div>
                    </td>
                    <td className="text-gray-600 text-sm">{formatDate(inv.invoiceDate)}</td>
                    <td>
                      <span className={`text-sm ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}>
                        {formatDate(inv.dueDate)}
                        {isOverdue && <span className="block text-xs">⚠ Overdue</span>}
                      </span>
                    </td>
                    <td className="text-right font-medium">{formatCurrency(inv.totalAmount)}</td>
                    <td className="text-right text-green-600">{formatCurrency(inv.paidAmount)}</td>
                    <td className="text-right">
                      <span className={`font-semibold ${balance > 0 ? 'text-gray-900' : 'text-green-600'}`}>
                        {formatCurrency(balance)}
                      </span>
                    </td>
                    <td>
                      <span className={`${STATUS_BADGE[inv.status]} flex items-center gap-1 w-fit`}>
                        {STATUS_ICON[inv.status]} {inv.status}
                      </span>
                    </td>
                    <td className="text-center" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openInvoice(inv)}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                          title="View details"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                        {inv.status !== 'PAID' && inv.status !== 'VOID' && (
                          <button
                            onClick={async () => {
                              const { data } = await rApi.invoices.get(inv.id);
                              setModal({ type: 'collect', invoice: data });
                            }}
                            className="p-1.5 text-gray-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                            title="Record collection"
                          >
                            <DollarSign className="w-4 h-4" />
                          </button>
                        )}
                        {inv.paidAmount == 0 && inv.status !== 'VOID' && (
                          <button
                            onClick={() => handleVoid(inv)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Void invoice"
                          >
                            <Ban className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <p className="text-sm text-gray-500">
            Showing {Math.min((page - 1) * LIMIT + 1, total)}–{Math.min(page * LIMIT, total)} of {total} invoices
          </p>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="btn-secondary btn-sm disabled:opacity-40"
            >
              ← Previous
            </button>
            <span className="text-sm text-gray-600 px-2">
              Page {page} of {Math.ceil(total / LIMIT) || 1}
            </span>
            <button
              disabled={page * LIMIT >= total}
              onClick={() => setPage((p) => p + 1)}
              className="btn-secondary btn-sm disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {modal?.type === 'create' && (
        <CreateInvoiceModal
          customers={customers}
          accounts={accounts}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); load(); }}
        />
      )}
      {modal?.type === 'detail' && (
        <InvoiceDetailModal
          invoice={modal.invoice}
          onClose={() => setModal(null)}
          onCollect={() => setModal({ type: 'collect', invoice: modal.invoice })}
          onVoid={() => { handleVoid(modal.invoice); setModal(null); }}
        />
      )}
      {modal?.type === 'collect' && (
        <CollectionModal
          invoice={modal.invoice}
          onClose={() => setModal(null)}
          onCollected={() => { setModal(null); load(); }}
        />
      )}
    </div>
  );
}
