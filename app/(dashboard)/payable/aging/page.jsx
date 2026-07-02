'use client';
import { useState, useEffect, useCallback } from 'react';
import { payable as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  RefreshCw, AlertCircle, CheckCircle2, Clock, TrendingDown,
  Building2, ChevronDown, ChevronUp, Download, Filter
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Cell, Legend
} from 'recharts';

// ─── Constants ────────────────────────────────────────────────
const BUCKETS = ['Current', '1-30 days', '31-60 days', '61-90 days', 'Over 90 days'];

const BUCKET_COLORS = {
  'Current':       '#22c55e',
  '1-30 days':     '#eab308',
  '31-60 days':    '#f97316',
  '61-90 days':    '#ef4444',
  'Over 90 days':  '#991b1b',
};

const BUCKET_BADGE = {
  'Current':       'badge-green',
  '1-30 days':     'badge-yellow',
  '31-60 days':    'text-orange-700 bg-orange-100 badge',
  '61-90 days':    'badge-red',
  'Over 90 days':  'bg-red-900 text-white badge',
};

// ─── Custom Tooltip ───────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
        <p className="font-semibold text-gray-800 mb-1">{label}</p>
        <p style={{ color: BUCKET_COLORS[label] }} className="font-bold text-base">
          {formatCurrency(payload[0].value)}
        </p>
        <p className="text-gray-400 text-xs">{payload[0].payload.count} bill{payload[0].payload.count !== 1 ? 's' : ''}</p>
      </div>
    );
  }
  return null;
};

// ─── Vendor Group Row ─────────────────────────────────────────
function VendorRow({ vendorName, items }) {
  const [expanded, setExpanded] = useState(false);
  const total = items.reduce((s, i) => s + i.outstanding, 0);
  const bucketTotals = Object.fromEntries(BUCKETS.map((b) => [b, 0]));
  items.forEach((i) => { bucketTotals[i.bucket] = (bucketTotals[i.bucket] || 0) + i.outstanding; });

  const worstBucket = [...BUCKETS].reverse().find((b) => bucketTotals[b] > 0);

  return (
    <>
      <tr
        className="cursor-pointer hover:bg-gray-50 transition-colors border-b border-gray-100"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-3 pl-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Building2 className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <span className="font-medium text-gray-900">{vendorName}</span>
            <span className="badge-gray text-xs">{items.length} bill{items.length !== 1 ? 's' : ''}</span>
          </div>
        </td>
        {BUCKETS.map((bucket) => (
          <td key={bucket} className="text-right py-3">
            {bucketTotals[bucket] > 0 ? (
              <span style={{ color: BUCKET_COLORS[bucket] }} className="font-medium text-sm">
                {formatCurrency(bucketTotals[bucket])}
              </span>
            ) : (
              <span className="text-gray-300 text-sm">—</span>
            )}
          </td>
        ))}
        <td className="text-right py-3 pr-4">
          <span className="font-bold text-gray-900">{formatCurrency(total)}</span>
        </td>
        <td className="py-3 pr-2 text-center">
          {expanded
            ? <ChevronUp className="w-4 h-4 text-gray-400 inline" />
            : <ChevronDown className="w-4 h-4 text-gray-400 inline" />}
        </td>
      </tr>

      {expanded && items.map((item, idx) => (
        <tr key={idx} className="bg-blue-50/40 border-b border-blue-100/50">
          <td className="py-2 pl-14">
            <div>
              <span className="font-mono text-sm text-blue-700">{item.billNo}</span>
              <span className="text-xs text-gray-400 ml-2">Due: {formatDate(item.dueDate)}</span>
            </div>
          </td>
          {BUCKETS.map((bucket) => (
            <td key={bucket} className="text-right py-2">
              {item.bucket === bucket ? (
                <span style={{ color: BUCKET_COLORS[bucket] }} className="font-medium text-sm">
                  {formatCurrency(item.outstanding)}
                </span>
              ) : (
                <span className="text-gray-200 text-xs">—</span>
              )}
            </td>
          ))}
          <td className="text-right py-2 pr-4">
            <span className="text-sm font-medium">{formatCurrency(item.outstanding)}</span>
          </td>
          <td className="py-2 pr-2 text-center">
            <span className={`${BUCKET_BADGE[item.bucket]} text-xs`}>{item.daysOverdue === 0 ? 'Current' : `${item.daysOverdue}d`}</span>
          </td>
        </tr>
      ))}
    </>
  );
}

// ─── Main AP Aging Page ───────────────────────────────────────
export default function APAgingPage() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch]   = useState('');
  const [lastRefresh, setLastRefresh] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await pApi.bills.aging();
      setData(r.data);
      setLastRefresh(new Date());
    } catch (err) {
      toast.error('Failed to load aging report');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-24 gap-3 text-gray-400">
      <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
      <p>Building aging report...</p>
    </div>
  );

  if (!data) return null;

  // Group items by vendor
  const grouped = {};
  const filtered = data.items.filter((i) =>
    !search || i.vendor.toLowerCase().includes(search.toLowerCase())
  );
  filtered.forEach((item) => {
    if (!grouped[item.vendor]) grouped[item.vendor] = [];
    grouped[item.vendor].push(item);
  });

  // Chart data
  const chartData = BUCKETS.map((bucket) => ({
    name: bucket,
    amount: data.summary[bucket] || 0,
    count: data.items.filter((i) => i.bucket === bucket).length,
  }));

  const totalOutstanding = data.total;
  const overdueTotal = BUCKETS.slice(1).reduce((s, b) => s + (data.summary[b] || 0), 0);
  const overdueCount = data.items.filter((i) => i.bucket !== 'Current').length;

  // Worst bucket by amount
  const worstBucket = [...BUCKETS].reverse().find((b) => data.summary[b] > 0) || 'Current';

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">AP Aging Report</h1>
          <p className="page-subtitle">
            As of {new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' })}
            {lastRefresh && <span className="ml-2 text-gray-400">· Refreshed {lastRefresh.toLocaleTimeString()}</span>}
          </p>
        </div>
        <button onClick={load} disabled={loading} className="btn-secondary">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5 border-l-4 border-l-blue-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Total Outstanding</p>
          <p className="text-2xl font-bold text-gray-900">{formatCurrency(totalOutstanding)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.items.length} open bill{data.items.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="card p-5 border-l-4 border-l-green-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Current (Not Due)</p>
          <p className="text-2xl font-bold text-green-600">{formatCurrency(data.summary['Current'] || 0)}</p>
          <p className="text-xs text-gray-400 mt-1">{data.items.filter(i => i.bucket === 'Current').length} bills</p>
        </div>
        <div className="card p-5 border-l-4 border-l-red-500">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Total Overdue</p>
          <p className="text-2xl font-bold text-red-600">{formatCurrency(overdueTotal)}</p>
          <p className="text-xs text-gray-400 mt-1">{overdueCount} overdue bill{overdueCount !== 1 ? 's' : ''}</p>
        </div>
        <div className="card p-5 border-l-4 border-l-orange-400">
          <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Overdue %</p>
          <p className="text-2xl font-bold text-orange-600">
            {totalOutstanding > 0 ? ((overdueTotal / totalOutstanding) * 100).toFixed(1) : '0.0'}%
          </p>
          <p className="text-xs text-gray-400 mt-1">of total outstanding</p>
        </div>
      </div>

      {/* Chart + Bucket summary */}
      <div className="grid xl:grid-cols-1 sm:grid-cols-3 gap-5">
        {/* Bar chart */}
        <div className="card xl:col-span-2">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Aging Distribution</h3>
            <span className="badge-blue text-xs">By Days Outstanding</span>
          </div>
          <div className="card-body pt-2">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barSize={48} margin={{ top: 4, right: 8, bottom: 0, left: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#6b7280' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry) => (
                    <Cell key={entry.name} fill={BUCKET_COLORS[entry.name]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bucket breakdown */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Bucket Summary</h3>
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
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: BUCKET_COLORS[bucket] }} />
                      <span className="text-sm font-medium text-gray-700">{bucket}</span>
                      {count > 0 && <span className="badge-gray text-xs">{count}</span>}
                    </div>
                    <span className={`text-sm font-bold ${amount > 0 ? '' : 'text-gray-300'}`}
                      style={{ color: amount > 0 ? BUCKET_COLORS[bucket] : undefined }}>
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
            <div className="px-5 py-3 bg-gray-50 flex justify-between font-bold">
              <span className="text-gray-700">Total</span>
              <span className="text-gray-900">{formatCurrency(totalOutstanding)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Alert banner for severely overdue */}
      {(data.summary['Over 90 days'] || 0) > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">
              {formatCurrency(data.summary['Over 90 days'])} is more than 90 days overdue
            </p>
            <p className="text-xs text-red-600 mt-0.5">
              {data.items.filter(i => i.bucket === 'Over 90 days').length} bills · Immediate action recommended. Contact vendors to negotiate payment terms or escalate.
            </p>
          </div>
        </div>
      )}

      {/* Detailed table */}
      <div className="card">
        <div className="card-header">
          <h3 className="font-semibold text-gray-900">Detail by Vendor</h3>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Filter className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                className="input pl-8 text-sm w-48 py-1.5"
                placeholder="Filter vendor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th className="pl-4 min-w-48">Vendor</th>
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
              {Object.keys(grouped).length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-gray-400">
                    {search ? 'No vendors match your search.' : 'No outstanding payables. You are all caught up! 🎉'}
                  </td>
                </tr>
              ) : Object.entries(grouped).sort(([, a], [, b]) => {
                // Sort by worst bucket
                const aWorst = [...BUCKETS].reverse().findIndex((bucket) => a.some(i => i.bucket === bucket));
                const bWorst = [...BUCKETS].reverse().findIndex((bucket) => b.some(i => i.bucket === bucket));
                return bWorst - aWorst;
              }).map(([vendorName, items]) => (
                <VendorRow key={vendorName} vendorName={vendorName} items={items} />
              ))}
            </tbody>

            {/* Totals row */}
            {Object.keys(grouped).length > 0 && (
              <tfoot>
                <tr className="bg-gray-50 font-bold border-t-2 border-gray-200">
                  <td className="py-3 pl-4 text-gray-700">TOTAL</td>
                  {BUCKETS.map((bucket) => {
                    const filteredTotal = filtered
                      .filter((i) => i.bucket === bucket)
                      .reduce((s, i) => s + i.outstanding, 0);
                    return (
                      <td key={bucket} className="text-right py-3">
                        <span style={{ color: filteredTotal > 0 ? BUCKET_COLORS[bucket] : '#d1d5db' }}>
                          {formatCurrency(filteredTotal)}
                        </span>
                      </td>
                    );
                  })}
                  <td className="text-right py-3 pr-4 text-blue-700">
                    {formatCurrency(filtered.reduce((s, i) => s + i.outstanding, 0))}
                  </td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400">
          Aging calculated as of today · Only Open and Partial bills are included · Void and Paid bills are excluded
        </div>
      </div>
    </div>
  );
}
