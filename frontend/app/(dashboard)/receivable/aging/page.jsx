'use client';
import { useState, useEffect, useCallback } from 'react';
import { receivable as rApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  RefreshCw, AlertCircle, CheckCircle2, TrendingUp,
  Users, ChevronDown, ChevronUp, Filter,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { formatCurrency, formatDate } from '@/lib/auth';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, PieChart, Pie, Legend,
} from 'recharts';

// ─── Constants ────────────────────────────────────────────────
const BUCKETS = ['Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'];

const BUCKET_COLORS = {
  'Current':       '#22c55e',
  '1-30 days':     '#eab308',
  '31-60 days':    '#f97316',
  '61-90 days':    '#ef4444',
  'Over 90 days':  '#7f1d1d',
};

const BUCKET_BADGE_CLASS = {
  'Current':       'bg-green-100 text-green-700',
  '1-30 days':     'bg-yellow-100 text-yellow-700',
  '31-60 days':    'bg-orange-100 text-orange-700',
  '61-90 days':    'bg-red-100 text-red-700',
  'Over 90 days':  'bg-red-900 text-white',
};

// ─── Custom Bar Tooltip ───────────────────────────────────────
const BarTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm min-w-36">
        <p className="font-semibold text-gray-800 mb-1">{label}</p>
        <p className="font-bold text-base" style={{ color: BUCKET_COLORS[label] }}>
          {formatCurrency(payload[0].value)}
        </p>
        <p className="text-gray-400 text-xs">
          {payload[0].payload.count} invoice{payload[0].payload.count !== 1 ? 's' : ''}
        </p>
      </div>
    );
  }
  return null;
};

// ─── Pie Tooltip ──────────────────────────────────────────────
const PieTooltip = ({ active, payload }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
        <p className="font-semibold" style={{ color: payload[0].payload.fill }}>{payload[0].name}</p>
        <p className="font-bold">{formatCurrency(payload[0].value)}</p>
        <p className="text-gray-400 text-xs">{payload[0].payload.percent?.toFixed(1)}%</p>
      </div>
    );
  }
  return null;
};

// ─── Expandable Customer Row ──────────────────────────────────
function CustomerRow({ customerName, items }) {
  const [expanded, setExpanded] = useState(false);
  const total = items.reduce((s, i) => s + i.outstanding, 0);

  const bucketTotals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  items.forEach((i) => { bucketTotals[i.bucket] = (bucketTotals[i.bucket] || 0) + i.outstanding; });

  const worstBucket = [...BUCKETS].reverse().find((b) => bucketTotals[b] > 0);
  const overdueAmt  = BUCKETS.slice(1).reduce((s, b) => s + (bucketTotals[b] || 0), 0);

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-3 pl-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0 text-green-700 text-xs font-bold">
              {customerName.split(' ').slice(0, 2).map((w) => w[0]).join('').toUpperCase()}
            </div>
            <span className="font-medium text-gray-900">{customerName}</span>
            <span className="badge-gray text-xs">{items.length} inv.</span>
            {overdueAmt > 0 && (
              <span className="badge bg-red-100 text-red-600 text-xs">{formatCurrency(overdueAmt)} overdue</span>
            )}
          </div>
        </td>
        {BUCKETS.map((bucket) => (
          <td key={bucket} className="text-right py-3">
            {bucketTotals[bucket] > 0 ? (
              <span className="font-medium text-sm" style={{ color: BUCKET_COLORS[bucket] }}>
                {formatCurrency(bucketTotals[bucket])}
              </span>
            ) : (
              <span className="text-gray-200 text-sm">—</span>
            )}
          </td>
        ))}
        <td className="text-right py-3 pr-4">
          <span className="font-bold text-gray-900">{formatCurrency(total)}</span>
        </td>
        <td className="py-3 pr-2 text-center">
          {expanded
            ? <ChevronUp   className="w-4 h-4 text-gray-400 inline" />
            : <ChevronDown className="w-4 h-4 text-gray-400 inline" />}
        </td>
      </tr>

      {expanded && items.map((item, idx) => (
        <tr key={idx} className="bg-green-50/40 border-b border-green-100/50">
          <td className="py-2 pl-14">
            <div>
              <span className="font-mono text-sm text-green-700">{item.invoiceNo}</span>
              <span className="text-xs text-gray-400 ml-2">Due: {formatDate(item.dueDate)}</span>
              {item.daysOverdue > 0 && (
                <span className="text-xs text-red-500 ml-2">({item.daysOverdue}d overdue)</span>
              )}
            </div>
          </td>
          {BUCKETS.map((bucket) => (
            <td key={bucket} className="text-right py-2">
              {item.bucket === bucket ? (
                <span className="font-medium text-sm" style={{ color: BUCKET_COLORS[bucket] }}>
                  {formatCurrency(item.outstanding)}
                </span>
              ) : (
                <span className="text-gray-100 text-xs">—</span>
              )}
            </td>
          ))}
          <td className="text-right py-2 pr-4">
            <span className="text-sm font-medium">{formatCurrency(item.outstanding)}</span>
          </td>
          <td className="py-2 pr-2 text-center">
            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${BUCKET_BADGE_CLASS[item.bucket]}`}>
              {item.bucket}
            </span>
          </td>
        </tr>
      ))}
    </>
  );
}

// ─── Main AR Aging Page ───────────────────────────────────────
export default function ARAgingPage() {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [search, setSearch]       = useState('');
  const [chartType, setChartType] = useState('bar'); // 'bar' | 'pie'
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await rApi.invoices.aging();
      setData(r.data);
      setLastRefresh(new Date());
    } catch {
      toast.error('Failed to load AR aging report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-400">
      <div className="w-8 h-8 border-3 border-green-500 border-t-transparent rounded-full animate-spin" />
      <p>Building AR aging report...</p>
    </div>
  );

  if (!data) return null;

  // Group by customer
  const filtered = data.items.filter((i) =>
    !search || i.customer.toLowerCase().includes(search.toLowerCase())
  );
  const grouped = {};
  filtered.forEach((item) => {
    if (!grouped[item.customer]) grouped[item.customer] = [];
    grouped[item.customer].push(item);
  });

  // Sort customers: worst bucket first, then by outstanding desc
  const sortedCustomers = Object.entries(grouped).sort(([, a], [, b]) => {
    const aWorst = [...BUCKETS].reverse().findIndex((b) => a.some((i) => i.bucket === b));
    const bWorst = [...BUCKETS].reverse().findIndex((b) => b.some((i) => i.bucket === b));
    if (bWorst !== aWorst) return bWorst - aWorst;
    return b.reduce((s, i) => s + i.outstanding, 0) - a.reduce((s, i) => s + i.outstanding, 0);
  });

  // Chart data
  const barData = BUCKETS.map((bucket) => ({
    name:   bucket,
    amount: data.summary[bucket] || 0,
    count:  data.items.filter((i) => i.bucket === bucket).length,
  }));

  const pieData = BUCKETS.filter((b) => (data.summary[b] || 0) > 0).map((bucket) => ({
    name:    bucket,
    value:   data.summary[bucket] || 0,
    fill:    BUCKET_COLORS[bucket],
    percent: data.total > 0 ? ((data.summary[bucket] || 0) / data.total) * 100 : 0,
  }));

  const totalOutstanding  = data.total;
  const overdueTotal      = BUCKETS.slice(1).reduce((s, b) => s + (data.summary[b] || 0), 0);
  const overdueCount      = data.items.filter((i) => i.bucket !== 'Current').length;
  const currentAmount     = data.summary['Current'] || 0;
  const collectionRisk    = totalOutstanding > 0 ? (overdueTotal / totalOutstanding) * 100 : 0;
  const uniqueCustomers   = Object.keys(grouped).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">AR Aging Report</h1>
          <p className="page-subtitle">
            As of {new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
            {lastRefresh && (
              <span className="ml-2 text-gray-400">· Refreshed {lastRefresh.toLocaleTimeString()}</span>
            )}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="card p-5 border-l-4 border-l-green-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total Receivable</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalOutstanding)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.items.length} open invoice{data.items.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="card p-5 border-l-4 border-l-blue-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Not Yet Due</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(currentAmount)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.items.filter((i) => i.bucket === 'Current').length} invoices</p>
        </div>
        <div className="card p-5 border-l-4 border-l-red-500">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total Overdue</p>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(overdueTotal)}</p>
          <p className="text-xs text-gray-400 mt-1">{overdueCount} overdue invoice{overdueCount !== 1 ? 's' : ''}</p>
        </div>
        <div className="card p-5 border-l-4 border-l-orange-400">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Collection Risk</p>
          <div className="flex items-end gap-2">
            <p className={`text-2xl font-bold ${collectionRisk < 20 ? 'text-green-600' : collectionRisk < 50 ? 'text-yellow-600' : 'text-red-600'}`}>
              {collectionRisk.toFixed(1)}%
            </p>
            <p className="text-xs text-gray-400 mb-1">overdue</p>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full rounded-full ${collectionRisk < 20 ? 'bg-green-500' : collectionRisk < 50 ? 'bg-yellow-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, collectionRisk)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Charts + bucket summary */}
      <div className="grid xl:grid-cols-3 gap-5">
        {/* Main chart */}
        <div className="card xl:col-span-2">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Aging Distribution</h3>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {[['bar', 'Bar'], ['pie', 'Pie']].map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setChartType(k)}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      chartType === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="badge-green text-xs">{uniqueCustomers} customer{uniqueCustomers !== 1 ? 's' : ''}</span>
            </div>
          </div>
          <div className="card-body pt-2">
            {chartType === 'bar' ? (
              <ResponsiveContainer width="100%" height={230}>
                <BarChart data={barData} barSize={48} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false}
                    tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip content={<BarTooltip />} />
                  <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                    {barData.map((entry) => (
                      <Cell key={entry.name} fill={BUCKET_COLORS[entry.name]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <ResponsiveContainer width="100%" height={230}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%" cy="50%"
                    innerRadius={55} outerRadius={90}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {pieData.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip content={<PieTooltip />} />
                  <Legend
                    formatter={(value) => <span className="text-xs text-gray-600">{value}</span>}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        {/* Bucket summary panel */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Bucket Breakdown</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {BUCKETS.map((bucket) => {
              const amount = data.summary[bucket] || 0;
              const count  = data.items.filter((i) => i.bucket === bucket).length;
              const pct    = totalOutstanding > 0 ? (amount / totalOutstanding) * 100 : 0;
              return (
                <div key={bucket} className="px-5 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: BUCKET_COLORS[bucket] }}
                      />
                      <span className="text-sm font-medium text-gray-700">{bucket}</span>
                      {count > 0 && <span className="badge-gray text-xs">{count}</span>}
                    </div>
                    <span
                      className="text-sm font-bold"
                      style={{ color: amount > 0 ? BUCKET_COLORS[bucket] : '#d1d5db' }}
                    >
                      {formatCurrency(amount)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${pct}%`, backgroundColor: BUCKET_COLORS[bucket] }}
                    />
                  </div>
                  <p className="text-xs text-gray-400 mt-1 text-right">{pct.toFixed(1)}%</p>
                </div>
              );
            })}
            <div className="px-5 py-3 bg-gray-50 flex justify-between items-center">
              <span className="font-bold text-gray-700">Total Outstanding</span>
              <span className="font-bold text-green-700 text-base">{formatCurrency(totalOutstanding)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Alert banners */}
      {(data.summary['Over 90 days'] || 0) > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">
              {formatCurrency(data.summary['Over 90 days'])} is more than 90 days overdue
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              {data.items.filter((i) => i.bucket === 'Over 90 days').length} invoices · Consider engaging a collection agency or writing off as bad debt.
            </p>
          </div>
        </div>
      )}

      {totalOutstanding === 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 flex items-center gap-4 text-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-green-500" />
          <div>
            <p className="font-semibold text-green-800">All receivables are fully collected!</p>
            <p className="text-xs text-green-600">No outstanding invoices at this time.</p>
          </div>
        </div>
      )}

      {/* Detail table */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-gray-900">Detail by Customer</h3>
          <div className="relative">
            <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              className="input pl-8 text-sm w-52 py-1.5"
              placeholder="Filter customer..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="pl-4 min-w-52">Customer</th>
                {BUCKETS.map((b) => (
                  <th key={b} className="text-right whitespace-nowrap">
                    <span style={{ color: BUCKET_COLORS[b] }}>{b}</span>
                  </th>
                ))}
                <th className="text-right pr-4">Total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {sortedCustomers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">
                    {search
                      ? 'No customers match your search.'
                      : 'No outstanding receivables. All invoices are collected! 🎉'}
                  </td>
                </tr>
              ) : sortedCustomers.map(([customerName, items]) => (
                <CustomerRow key={customerName} customerName={customerName} items={items} />
              ))}
            </tbody>

            {/* Totals footer */}
            {sortedCustomers.length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                  <td className="py-3 pl-4 text-gray-700">TOTAL</td>
                  {BUCKETS.map((bucket) => {
                    const amt = filtered.filter((i) => i.bucket === bucket).reduce((s, i) => s + i.outstanding, 0);
                    return (
                      <td key={bucket} className="text-right py-3">
                        <span style={{ color: amt > 0 ? BUCKET_COLORS[bucket] : '#d1d5db' }}>
                          {formatCurrency(amt)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="text-right py-3 pr-4 text-green-700">
                    {formatCurrency(filtered.reduce((s, i) => s + i.outstanding, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
          <span>Aging calculated as of today · Only Open and Partial invoices are included</span>
          <span className="flex items-center gap-1">
            <PesoSign className="w-3.5 h-3.5" /> Amounts in Philippine Peso (₱)
          </span>
        </div>
      </div>
    </div>
  );
}
