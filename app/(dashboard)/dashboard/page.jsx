'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { dashboard as dashApi } from '@/lib/api';
import { formatCurrency } from '@/lib/auth';
import toast from 'react-hot-toast';
import {
  TrendingUp, TrendingDown, AlertCircle, Users, Building2,
  ShoppingCart, FileText, CheckCircle, Clock,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const PRESETS = [
  { key: 'month', label: 'This Month' },
  { key: 'lastMonth', label: 'Last Month' },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'year', label: 'This Year' },
  { key: 'custom', label: 'Custom' },
];

function presetRange(key) {
  const t = new Date();
  const y = t.getFullYear();
  const m = t.getMonth();
  if (key === 'lastMonth') return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
  if (key === 'quarter') { const q = Math.floor(m / 3) * 3; return { from: ymd(new Date(y, q, 1)), to: ymd(new Date(y, q + 3, 0)) }; }
  if (key === 'year') return { from: `${y}-01-01`, to: `${y}-12-31` };
  return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) };
}

const fmtShort = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });

const StatCard = ({ label, value, sub, icon: Icon, color, trend }) => (
  <div className="stat-card">
    <div className={`stat-icon ${color}`}>
      <Icon className="w-6 h-6" />
    </div>
    <div className="flex-1">
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
    </div>
    {trend !== undefined && (
      <div className={`text-xs font-medium ${trend >= 0 ? 'text-green-600' : 'text-red-500'}`}>
        {trend >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
      </div>
    )}
  </div>
);

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [preset, setPreset] = useState('month');
  const [range, setRange] = useState(() => presetRange('month'));

  useEffect(() => {
    if (!range.from || !range.to) return;
    if (range.from > range.to) { toast.error('"From" date must not be after "To" date'); return; }
    dashApi.get({ from: range.from, to: range.to })
      .then((r) => setData(r.data))
      .catch((e) => toast.error(e.response?.data?.message || 'Failed to load dashboard data'))
      .finally(() => setLoading(false));
  }, [range]);

  const choosePreset = (key) => {
    setPreset(key);
    if (key !== 'custom') setRange(presetRange(key));
  };
  const periodLabel = preset === 'month' ? 'This month' : `${fmtShort(range.from)} – ${fmtShort(range.to)}`;

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="flex flex-col items-center gap-3">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-500 text-sm">Loading dashboard...</p>
      </div>
    </div>
  );

  const d = data || {};
  const netIncome = d.gl?.netIncome || 0;
  const chartData = [
    { name: 'Revenue', amount: d.gl?.monthRevenue || 0, fill: '#22c55e' },
    { name: 'Expenses', amount: d.gl?.monthExpense || 0, fill: '#ef4444' },
    { name: 'Net Income', amount: Math.max(0, netIncome), fill: '#3b82f6' },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-2xl p-6 text-white">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold">Welcome to Finara Accounting System ERP</h2>
            <p className="text-blue-200 text-sm mt-1">BIR • SSS • PhilHealth • Pag-IBIG Compliant System</p>
          </div>
          <div className="hidden md:flex gap-1 h-6">
            <div className="w-3 bg-blue-400 rounded" />
            <div className="w-3 bg-white rounded" />
            <div className="w-3 bg-red-400 rounded" />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          label="Total Sales"
          value={formatCurrency(d.gl?.monthRevenue)}
          sub={periodLabel}
          icon={TrendingUp} color="bg-blue-100 text-blue-600"
        />
        <StatCard
          label="Accounts Receivable"
          value={formatCurrency(d.receivables?.openAmount)}
          sub={`${d.receivables?.openCount || 0} invoices outstanding`}
          icon={PesoSign} color="bg-green-100 text-green-600"
        />
        <StatCard
          label="Accounts Payable"
          value={formatCurrency(d.payables?.openAmount)}
          sub={`${d.payables?.openCount || 0} bills outstanding`}
          icon={ShoppingCart} color="bg-orange-100 text-orange-600"
        />
        <StatCard
          label="Total Expenses"
          value={formatCurrency(d.gl?.monthExpense)}
          sub={periodLabel}
          icon={TrendingDown} color="bg-red-100 text-red-600"
        />
        <StatCard
          label="Net Income"
          sub={periodLabel}
          value={formatCurrency(netIncome)}
          icon={netIncome >= 0 ? TrendingUp : TrendingDown}
          color={netIncome >= 0 ? 'bg-emerald-100 text-emerald-600' : 'bg-red-100 text-red-600'}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-1 sm:grid-cols-3 gap-6">
        {/* Chart */}
        <div className="card xl:col-span-2">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Profit &amp; Loss</h3>
            <span className="badge-blue">{periodLabel}</span>
          </div>
          <div className="card-body">
            <div className="flex flex-wrap items-end gap-2 mb-4">
              {PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => choosePreset(p.key)}
                  className={preset === p.key ? 'btn-primary text-xs px-3 py-1.5' : 'btn-secondary text-xs px-3 py-1.5'}
                >
                  {p.label}
                </button>
              ))}
              {preset === 'custom' && (
                <>
                  <input type="date" className="input text-xs py-1.5 w-auto" value={range.from} max={range.to || undefined}
                    onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
                  <span className="text-xs text-gray-400 pb-2">to</span>
                  <input type="date" className="input text-xs py-1.5 w-auto" value={range.to} min={range.from || undefined}
                    onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
                </>
              )}
              <Link href="/reports/income-statement" className="ml-auto text-xs font-semibold text-blue-600 hover:underline pb-2">
                View full Income Statement
              </Link>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData} barSize={48}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 13 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₱${(v/1000).toFixed(0)}k`} />
                <Tooltip formatter={(v) => formatCurrency(v)} />
                <Bar dataKey="amount" radius={[6, 6, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Alerts */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold text-gray-900">Alerts</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {d.receivables?.overdue > 0 && (
              <div className="flex items-start gap-3 p-4">
                <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Overdue Receivables</p>
                  <p className="text-xs text-red-500">{formatCurrency(d.receivables.overdue)} past due</p>
                </div>
              </div>
            )}
            {d.payables?.overdue > 0 && (
              <div className="flex items-start gap-3 p-4">
                <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Overdue Payables</p>
                  <p className="text-xs text-orange-500">{formatCurrency(d.payables.overdue)} past due</p>
                </div>
              </div>
            )}
            {d.gl?.draftEntries > 0 && (
              <div className="flex items-start gap-3 p-4">
                <Clock className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Draft Journal Entries</p>
                  <p className="text-xs text-yellow-600">{d.gl.draftEntries} entries pending review</p>
                </div>
              </div>
            )}
            {(!d.receivables?.overdue && !d.payables?.overdue && !d.gl?.draftEntries) && (
              <div className="flex items-center gap-3 p-4">
                <CheckCircle className="w-5 h-5 text-green-500" />
                <p className="text-sm text-gray-600">All clear! No pending alerts.</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick counts */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Active Customers', value: d.counts?.customers || 0, icon: Users, color: 'text-blue-600' },
          { label: 'Active Vendors',   value: d.counts?.vendors   || 0, icon: Building2, color: 'text-purple-600' },
          { label: 'Active Employees', value: d.counts?.employees || 0, icon: Users, color: 'text-green-600' },
        ].map((s) => (
          <div key={s.label} className="card p-5 text-center">
            <s.icon className={`w-7 h-7 mx-auto mb-2 ${s.color}`} />
            <p className="text-2xl font-bold text-gray-900">{s.value}</p>
            <p className="text-sm text-gray-500">{s.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
