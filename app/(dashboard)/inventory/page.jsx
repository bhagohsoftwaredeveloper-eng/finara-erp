'use client';
import { useState, useEffect, useCallback } from 'react';
import { inventory as inventoryApi } from '@/lib/api';
import { printDocument, phpFmt, dateFmt, badge } from '@/lib/print';
import toast from 'react-hot-toast';
import {
  Package, AlertTriangle, TrendingUp,
  Search, RefreshCw, Printer, Filter, ChevronDown,
  ArrowUpCircle, ArrowDownCircle, SlidersHorizontal,
  Eye, ExternalLink,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import Link from 'next/link';
import BulkStockMovementDrawer from '@/components/inventory/BulkStockMovementDrawer';
import TxnModal from '@/components/inventory/RecordMovementModal';

const TYPE_COLORS = {
  PRODUCT:  'badge-blue',
  MATERIAL: 'badge-yellow',
  SUPPLY:   'badge-green',
  ASSET:    'badge-red',
};

export default function InventoryDashboardPage() {
  const [data, setData]         = useState({ summary: null, items: [] });
  const [categories, setCategories] = useState([]);
  const [filter, setFilter]     = useState({ search: '', categoryId: '', type: '', from: '', to: '' });
  const [loading, setLoading]   = useState(true);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [txnItem, setTxnItem]   = useState(null); // item whose Record Stock Movement dialog is open

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filter.categoryId) params.categoryId = filter.categoryId;
      if (filter.type)       params.type        = filter.type;
      if (filter.from)       params.from        = filter.from;
      if (filter.to)         params.to          = filter.to;
      const [soh, cats] = await Promise.all([
        inventoryApi.reports.stockOnHand(params),
        inventoryApi.categories.list(),
      ]);
      setData(soh.data);
      setCategories(cats.data);
    } catch { toast.error('Failed to load inventory'); }
    finally { setLoading(false); }
  }, [filter.categoryId, filter.type, filter.from, filter.to]);

  useEffect(() => { load(); }, [load]);

  const filtered = (data.items || []).filter((i) => {
    if (!filter.search) return true;
    const s = filter.search.toLowerCase();
    return i.name.toLowerCase().includes(s) || i.sku.toLowerCase().includes(s);
  });

  // With a date range the report also shows opening / in / out for the period
  // and On Hand becomes the balance as of the "to" date.
  const ranged = Boolean(filter.from || filter.to);
  const periodLabel = ranged
    ? `${filter.from ? dateFmt(filter.from) : 'Beginning'} to ${filter.to ? dateFmt(filter.to) : dateFmt(new Date())}`
    : null;
  const qty = (n) => Number(n || 0).toLocaleString('en-PH');

  const handlePrint = async () => {
    const rows = filtered.map((i) => `
      <tr>
        <td class="mono">${i.sku}</td>
        <td class="bold">${i.name}</td>
        <td>${i.category?.name || '—'}</td>
        <td class="center">${i.unit}</td>
        ${ranged ? `<td class="right">${qty(i.openingStock)}</td><td class="right">${qty(i.qtyIn)}</td><td class="right">${qty(i.qtyOut)}</td>` : ''}
        <td class="right ${i.isOutOfStock ? 'red' : i.isLowStock ? 'bold' : ''}">${Number(i.currentStock).toLocaleString('en-PH', { minimumFractionDigits: 0 })}</td>
        <td class="right gray">${Number(i.reorderLevel).toLocaleString('en-PH', { minimumFractionDigits: 0 })}</td>
        <td class="right">${phpFmt(i.costPrice)}</td>
        <td class="right">${phpFmt(i.sellingPrice)}</td>
        <td class="right bold blue">${phpFmt(i.stockValue)}</td>
        <td class="center">${i.isOutOfStock ? '<span class="badge b-red">OUT</span>' : i.isLowStock ? '<span class="badge b-yellow">LOW</span>' : '<span class="badge b-green">OK</span>'}</td>
      </tr>`).join('');

    const s = data.summary || {};
    const body = `
      <div class="sum-row">
        <div class="sum-box"><div class="sum-lbl">Total Items</div><div class="sum-val">${s.totalItems || 0}</div></div>
        <div class="sum-box sum-green"><div class="sum-lbl">Inventory Value</div><div class="sum-val">${phpFmt(s.totalValue || 0)}</div></div>
        <div class="sum-box sum-yellow"><div class="sum-lbl">Low Stock</div><div class="sum-val">${s.lowStock || 0}</div></div>
        <div class="sum-box sum-red"><div class="sum-lbl">Out of Stock</div><div class="sum-val">${s.outOfStock || 0}</div></div>
      </div>
      <table>
        <thead><tr>
          <th>SKU</th><th>Item Name</th><th>Category</th><th class="center">Unit</th>
          ${ranged ? '<th class="right">Opening</th><th class="right">In</th><th class="right">Out</th>' : ''}
          <th class="right">${ranged ? 'Closing' : 'On Hand'}</th><th class="right">Reorder</th>
          <th class="right">Unit Cost</th><th class="right">Selling Price</th><th class="right">Stock Value</th><th class="center">Status</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <td colspan="${ranged ? 11 : 8}" class="right bold">TOTAL INVENTORY VALUE</td>
          <td class="right bold blue">${phpFmt(filtered.reduce((s, i) => s + i.stockValue, 0))}</td>
          <td></td>
        </tr></tfoot>
      </table>`;
    await printDocument('Stock on Hand', ranged ? periodLabel : `As of ${dateFmt(new Date())}`, body);
  };

  const { summary } = data;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">Stock on hand overview</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePrint} className="btn-secondary flex items-center gap-2">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={() => setBulkOpen(true)} className="btn-secondary flex items-center gap-2">
            <ArrowUpCircle className="w-4 h-4" /> Bulk Stock Movement
          </button>
          <Link href="/inventory/items" className="btn-primary flex items-center gap-2">
            <Package className="w-4 h-4" /> Manage Items
          </Link>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="card card-body">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Total Items</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{summary?.totalItems ?? '—'}</p>
            </div>
            <Package className="w-8 h-8 text-blue-200" />
          </div>
        </div>
        <div className="card card-body">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Inventory Value</p>
              <p className="text-2xl font-bold text-green-600 mt-1">{summary ? phpFmt(summary.totalValue) : '—'}</p>
            </div>
            <PesoSign className="w-8 h-8 text-green-200" />
          </div>
        </div>
        <div className="card card-body">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Low Stock</p>
              <p className="text-2xl font-bold text-yellow-600 mt-1">{summary?.lowStock ?? '—'}</p>
              <p className="text-xs text-gray-400">items at reorder level</p>
            </div>
            <AlertTriangle className="w-8 h-8 text-yellow-200" />
          </div>
        </div>
        <div className="card card-body">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Out of Stock</p>
              <p className="text-2xl font-bold text-red-600 mt-1">{summary?.outOfStock ?? '—'}</p>
            </div>
            <AlertTriangle className="w-8 h-8 text-red-200" />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                className="input pl-9 w-full"
                placeholder="Search SKU or name…"
                value={filter.search}
                onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
              />
            </div>
            <select
              className="input w-48"
              value={filter.categoryId}
              onChange={(e) => setFilter((f) => ({ ...f, categoryId: e.target.value }))}
            >
              <option value="">All Categories</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select
              className="input w-40"
              value={filter.type}
              onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value }))}
            >
              <option value="">All Types</option>
              <option value="PRODUCT">Product</option>
              <option value="MATERIAL">Material</option>
              <option value="SUPPLY">Supply</option>
              <option value="ASSET">Asset</option>
            </select>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">From</label>
              <input type="date" className="input w-40" value={filter.from} max={filter.to || undefined}
                onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} />
              <label className="text-xs text-gray-500">To</label>
              <input type="date" className="input w-40" value={filter.to} min={filter.from || undefined}
                onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} />
              {ranged && (
                <button type="button" className="text-xs text-blue-600 hover:underline"
                  onClick={() => setFilter((f) => ({ ...f, from: '', to: '' }))}>Clear</button>
              )}
            </div>
            <button onClick={load} className="btn-secondary flex items-center gap-2">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Stock Table */}
      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">SKU</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Item Name</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Category</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit</th>
                {ranged && (
                  <>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Opening</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-green-600 uppercase tracking-wide">In</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-red-600 uppercase tracking-wide">Out</th>
                  </>
                )}
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">{ranged ? 'Closing' : 'On Hand'}</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Reorder</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Unit Cost</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Selling Price</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Stock Value</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={ranged ? 14 : 11} className="px-4 py-12 text-center text-gray-400">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={ranged ? 14 : 11} className="px-4 py-12 text-center text-gray-400">No items found</td></tr>
              ) : filtered.map((item) => (
                <tr key={item.id} className={`hover:bg-gray-50 ${item.isOutOfStock ? 'bg-red-50' : item.isLowStock ? 'bg-yellow-50' : ''}`}>
                  <td className="px-4 py-3 font-mono text-xs text-gray-500">{item.sku}</td>
                  <td className="px-4 py-3 font-medium text-gray-900">{item.name}</td>
                  <td className="px-4 py-3">
                    {item.category ? (
                      <span className={`badge ${TYPE_COLORS[item.category.type] || 'badge'}`}>
                        {item.category.name}
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center text-gray-500">{item.unit}</td>
                  {ranged && (
                    <>
                      <td className="px-4 py-3 text-right text-gray-500">{qty(item.openingStock)}</td>
                      <td className="px-4 py-3 text-right text-green-700">{qty(item.qtyIn)}</td>
                      <td className="px-4 py-3 text-right text-red-700">{qty(item.qtyOut)}</td>
                    </>
                  )}
                  <td className={`px-4 py-3 text-right font-semibold ${item.isOutOfStock ? 'text-red-600' : item.isLowStock ? 'text-yellow-700' : 'text-gray-900'}`}>
                    {Number(item.currentStock).toLocaleString('en-PH')}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-400">{Number(item.reorderLevel).toLocaleString('en-PH')}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{phpFmt(item.costPrice)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{phpFmt(item.sellingPrice)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-blue-700">{phpFmt(item.stockValue)}</td>
                  <td className="px-4 py-3 text-center">
                    {item.isOutOfStock
                      ? <span className="badge badge-red">Out</span>
                      : item.isLowStock
                        ? <span className="badge badge-yellow">Low</span>
                        : <span className="badge badge-green">OK</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button type="button" onClick={() => setTxnItem(item)}
                      className="btn-secondary btn-sm inline-flex items-center gap-1.5 whitespace-nowrap">
                      <ExternalLink className="w-3.5 h-3.5" /> Transactions
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            {filtered.length > 0 && (
              <tfoot>
                <tr className="bg-blue-50 border-t-2 border-blue-200">
                  <td colSpan={ranged ? 11 : 8} className="px-4 py-3 text-right font-bold text-gray-700 text-sm uppercase tracking-wide">Total Inventory Value</td>
                  <td className="px-4 py-3 text-right font-bold text-blue-700 text-base">
                    {phpFmt(filtered.reduce((s, i) => s + i.stockValue, 0))}
                  </td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {txnItem && (
        <TxnModal
          items={data.items || []}
          initial={{ itemId: String(txnItem.id), unitCost: Number(txnItem.costPrice) ? String(txnItem.costPrice) : '' }}
          onClose={() => setTxnItem(null)}
          onSaved={() => { setTxnItem(null); load(); }}
        />
      )}

      {bulkOpen && (
        <BulkStockMovementDrawer
          items={data.items || []}
          onClose={() => setBulkOpen(false)}
          onDone={({ closed }) => { load(); if (closed) setBulkOpen(false); }}
        />
      )}
    </div>
  );
}
