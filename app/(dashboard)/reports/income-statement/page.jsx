'use client';
import { useState, useEffect, useCallback } from 'react';
import { journal } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, ReferenceLine,
} from 'recharts';
import {
  TrendingUp, TrendingDown, Percent, RefreshCw,
  Printer, AlertCircle, ChevronDown, ChevronUp, ArrowUp, ArrowDown,
  Target, Activity,
} from 'lucide-react';
import PesoSign from '@/components/icons/PesoSign';
import { formatCurrency, formatDate } from '@/lib/auth';
import { printDocument, phpFmt } from '@/lib/print';

// ─── Constants ─────────────────────────────────────────────────
const CURRENT_YEAR  = new Date().getFullYear();
const CURRENT_MONTH = new Date().getMonth() + 1;
const YEARS = Array.from({ length: 5 }, (_, i) => CURRENT_YEAR - i);
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const QUARTERS = ['Q1 (Jan–Mar)','Q2 (Apr–Jun)','Q3 (Jul–Sep)','Q4 (Oct–Dec)'];

const PIE_COLORS = ['#22c55e','#3b82f6','#a855f7','#f97316','#ef4444','#06b6d4','#84cc16','#f59e0b'];

// ─── Tooltip ──────────────────────────────────────────────────
const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-sm">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span className="text-gray-500">{p.name}</span>
          <span className="font-medium" style={{ color: p.color }}>{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
};

// ─── Line Row ─────────────────────────────────────────────────
function LineItem({ label, value, indent = 0, bold = false, total = false, negative = false, sub = null, pct = null }) {
  const isPositive = value >= 0;
  const display    = negative ? -value : value;

  return (
    <div className={`flex items-baseline justify-between py-2 ${total ? 'border-t border-gray-200 mt-1' : ''}`}
      style={{ paddingLeft: indent * 24 + 16, paddingRight: 16 }}>
      <div className="flex-1">
        <span className={`text-sm ${bold ? 'font-bold text-gray-900' : 'text-gray-600'} ${total ? 'text-base' : ''}`}>
          {label}
        </span>
        {sub && <span className="text-xs text-gray-400 ml-2">{sub}</span>}
      </div>
      <div className="flex items-center gap-3">
        {pct !== null && (
          <span className="text-xs text-gray-400 w-14 text-right">{pct.toFixed(1)}%</span>
        )}
        <span className={`font-mono text-sm text-right w-32 ${bold || total ? 'font-bold text-base' : ''} ${
          total && display > 0 ? 'text-green-600' :
          total && display < 0 ? 'text-red-600'  :
          'text-gray-800'
        }`}>
          {display < 0 ? `(${formatCurrency(Math.abs(display))})` : formatCurrency(display)}
        </span>
      </div>
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────
function Section({ title, accounts, total, totalLabel, color, startCollapsed = false, totalRevenue }) {
  const [collapsed, setCollapsed] = useState(startCollapsed);
  return (
    <div>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className={`w-full flex items-center justify-between px-4 py-2.5 rounded-xl ${color.bg} border ${color.border} hover:opacity-90 transition-opacity`}
      >
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronDown className={`w-4 h-4 ${color.text}`} /> : <ChevronUp className={`w-4 h-4 ${color.text}`} />}
          <span className={`text-xs font-bold uppercase tracking-wide ${color.text}`}>{title}</span>
          <span className="badge bg-white/60 text-gray-600 text-xs">{accounts.length} accounts</span>
        </div>
        <span className={`font-mono text-sm font-bold ${color.text}`}>{formatCurrency(total)}</span>
      </button>

      {!collapsed && accounts.length > 0 && (
        <div className="mt-1 divide-y divide-gray-50/80">
          {accounts.map((acct) => {
            const pct = totalRevenue > 0 ? (acct.balance / totalRevenue) * 100 : 0;
            return (
              <LineItem
                key={acct.id}
                label={acct.name}
                value={acct.balance}
                indent={1}
                sub={`(${acct.code})`}
                pct={Math.abs(pct)}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon: Icon, color, borderColor, pct, pctLabel }) {
  const isPositive = typeof value === 'number' ? value >= 0 : true;
  return (
    <div className={`card p-4 border-l-4 ${borderColor}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <p className="text-xs text-gray-500 mb-1">{label}</p>
          <p className={`text-xl font-bold ${color}`}>
            {typeof value === 'number' ? formatCurrency(value) : value}
          </p>
          {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
          {pct !== undefined && (
            <p className={`text-xs mt-1 font-medium flex items-center gap-1 ${pct >= 0 ? 'text-green-500' : 'text-red-500'}`}>
              {pct >= 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
              {Math.abs(pct).toFixed(1)}% {pctLabel}
            </p>
          )}
        </div>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${color.replace('text-','bg-').replace('600','100').replace('500','100')}`}>
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────
export default function IncomeStatementPage() {
  const [period, setPeriod] = useState('month');   // 'month' | 'quarter' | 'year' | 'custom'
  const [year,   setYear]   = useState(CURRENT_YEAR);
  const [month,  setMonth]  = useState(CURRENT_MONTH);
  const [quarter,setQuarter]= useState(Math.ceil(CURRENT_MONTH / 3));
  const [from,   setFrom]   = useState(`${CURRENT_YEAR}-01-01`);
  const [to,     setTo]     = useState(new Date().toISOString().split('T')[0]);
  const [data,   setData]   = useState(null);
  const [loading,setLoading]= useState(false);
  const [chartMode, setChartMode] = useState('bar'); // 'bar' | 'pie'

  const getParams = () => {
    if (period === 'month') {
      const start = `${year}-${String(month).padStart(2,'0')}-01`;
      const end   = new Date(year, month, 0).toISOString().split('T')[0];
      return { from: start, to: end };
    }
    if (period === 'quarter') {
      const startM = (quarter - 1) * 3 + 1;
      const endM   = quarter * 3;
      const start  = `${year}-${String(startM).padStart(2,'0')}-01`;
      const end    = new Date(year, endM, 0).toISOString().split('T')[0];
      return { from: start, to: end };
    }
    if (period === 'year') return { from: `${year}-01-01`, to: `${year}-12-31` };
    return { from, to };
  };

  const load = useCallback(() => {
    setLoading(true);
    journal.incomeStatement(getParams())
      .then((r) => setData(r.data))
      .catch(() => toast.error('Failed to load income statement'))
      .finally(() => setLoading(false));
  }, [period, year, month, quarter, from, to]);

  useEffect(() => { load(); }, [load]);

  const periodLabel = () => {
    if (period === 'month')   return `${MONTHS[month - 1]} ${year}`;
    if (period === 'quarter') return `${QUARTERS[quarter - 1]} ${year}`;
    if (period === 'year')    return `Full Year ${year}`;
    return `${formatDate(from)} – ${formatDate(to)}`;
  };

  const revenue    = data?.totalRevenue   || 0;
  const cogs       = data?.totalCOGS      || 0;
  const grossProfit= revenue - cogs;
  const opex       = data?.totalOpex      || 0;
  const opIncome   = grossProfit - opex;
  const otherInc   = data?.totalOtherIncome || 0;
  const otherExp   = data?.totalOtherExpense|| 0;
  const netIncome  = opIncome + otherInc - otherExp;

  const grossMargin = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
  const netMargin   = revenue > 0 ? (netIncome   / revenue) * 100 : 0;
  const opMargin    = revenue > 0 ? (opIncome    / revenue) * 100 : 0;

  const revenueAccounts = data?.revenueAccounts   || [];
  const cogsAccounts    = data?.cogsAccounts       || [];
  const opexAccounts    = data?.opexAccounts        || [];
  const otherIncAccounts= data?.otherIncomeAccounts || [];
  const otherExpAccounts= data?.otherExpAccounts    || [];

  // Waterfall data for bar chart
  const waterfallData = [
    { name: 'Revenue',       value: revenue,     fill: '#22c55e' },
    { name: 'COGS',          value: -cogs,        fill: '#ef4444' },
    { name: 'Gross Profit',  value: grossProfit,  fill: grossProfit >= 0 ? '#3b82f6' : '#f97316' },
    { name: 'OpEx',          value: -opex,        fill: '#f97316' },
    { name: 'Op. Income',    value: opIncome,     fill: opIncome >= 0 ? '#6366f1' : '#ef4444' },
    { name: 'Net Income',    value: netIncome,    fill: netIncome >= 0 ? '#22c55e' : '#ef4444' },
  ];

  const handlePrint = () => {
    const makeRows = (accts) => accts.map((a) => `
      <tr>
        <td class="mono blue small">${a.code || a.accountCode || ''}</td>
        <td>${a.name || a.accountName || ''}</td>
        <td class="right mono">${phpFmt(a.balance)}</td>
      </tr>`).join('');

    const sectionBlock = (title, accts, total, color = '') => `
      <tr class="section-row"><td colspan="3">${title}</td></tr>
      ${makeRows(accts)}
      <tr style="background:#f8faff;font-weight:700;font-size:9.5px">
        <td colspan="2" class="right gray">Total ${title}</td>
        <td class="right mono ${color}">${phpFmt(total)}</td>
      </tr>`;

    const body = `
      <div class="sum-row">
        <div class="sum-box sum-green"><div class="sum-lbl">Revenue</div><div class="sum-val">${phpFmt(revenue)}</div></div>
        <div class="sum-box ${grossProfit >= 0 ? '' : 'sum-red'}"><div class="sum-lbl">Gross Profit</div><div class="sum-val">${phpFmt(grossProfit)}</div></div>
        <div class="sum-box ${netIncome >= 0 ? 'sum-green' : 'sum-red'}"><div class="sum-lbl">Net Income</div><div class="sum-val">${phpFmt(netIncome)}</div></div>
        <div class="sum-box"><div class="sum-lbl">Gross Margin</div><div class="sum-val">${grossMargin.toFixed(1)}%</div></div>
        <div class="sum-box"><div class="sum-lbl">Net Margin</div><div class="sum-val">${netMargin.toFixed(1)}%</div></div>
      </div>
      <table>
        <thead><tr><th>Code</th><th>Account</th><th class="right">Amount (₱)</th></tr></thead>
        <tbody>
          ${sectionBlock('Revenue', revenueAccounts, revenue, 'green')}
          ${cogsAccounts.length ? sectionBlock('Cost of Goods Sold', cogsAccounts, cogs, 'red') : ''}
          <tr style="background:#eff6ff;font-weight:800;font-size:11px">
            <td colspan="2" class="right">GROSS PROFIT</td>
            <td class="right mono ${grossProfit >= 0 ? 'green' : 'red'}">${phpFmt(grossProfit)}</td>
          </tr>
          ${sectionBlock('Operating Expenses', opexAccounts, opex, 'red')}
          <tr style="background:#eff6ff;font-weight:800;font-size:11px">
            <td colspan="2" class="right">OPERATING INCOME</td>
            <td class="right mono ${opIncome >= 0 ? 'green' : 'red'}">${phpFmt(opIncome)}</td>
          </tr>
          ${otherIncAccounts.length ? sectionBlock('Other Income', otherIncAccounts, otherInc, 'green') : ''}
          ${otherExpAccounts.length ? sectionBlock('Other Expenses', otherExpAccounts, otherExp, 'red') : ''}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="2" class="right">NET INCOME / (LOSS)</td>
            <td class="right mono ${netIncome >= 0 ? 'green' : 'red'}">${phpFmt(netIncome)}</td>
          </tr>
        </tfoot>
      </table>`;

    printDocument('Income Statement', `${periodLabel()} · Profit & Loss`, body);
  };

  // Pie: expense breakdown
  const pieData = [
    ...cogsAccounts.map((a) => ({ name: a.name, value: a.balance })),
    ...opexAccounts.map((a) => ({ name: a.name, value: a.balance })),
  ].filter((d) => d.value > 0);

  return (
    <div className="space-y-5 print:space-y-3">
      {/* Header */}
      <div className="page-header print:hidden">
        <div>
          <h1 className="page-title">Income Statement</h1>
          <p className="page-subtitle">Statement of Profit & Loss · {periodLabel()}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePrint} disabled={!data} className="btn-secondary">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={load} disabled={loading} className="btn-secondary">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </div>

      {/* Print header */}
      <div className="hidden print:block text-center border-b-2 border-gray-800 pb-4 mb-4">
        <p className="text-xl font-bold">Income Statement (Profit & Loss)</p>
        <p className="text-sm text-gray-600">{periodLabel()}</p>
      </div>

      {/* Period filters */}
      <div className="card print:hidden">
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[['month','Month'],['quarter','Quarter'],['year','Full Year'],['custom','Custom']].map(([k, l]) => (
              <button key={k} onClick={() => setPeriod(k)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${period === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {l}
              </button>
            ))}
          </div>

          {period !== 'custom' && (
            <select className="select w-28" value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {YEARS.map((y) => <option key={y}>{y}</option>)}
            </select>
          )}
          {period === 'month' && (
            <select className="select w-36" value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          )}
          {period === 'quarter' && (
            <select className="select w-44" value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
              {QUARTERS.map((q, i) => <option key={q} value={i + 1}>{q}</option>)}
            </select>
          )}
          {period === 'custom' && (
            <>
              <input type="date" className="input w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
              <span className="text-gray-400 text-sm">to</span>
              <input type="date" className="input w-36" value={to}   onChange={(e) => setTo(e.target.value)} min={from} />
            </>
          )}
          <span className="text-xs bg-blue-50 text-blue-600 rounded-lg px-3 py-1.5 font-medium">{periodLabel()}</span>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />
          Computing income statement...
        </div>
      ) : data ? (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-2 xl:grid-cols-2 lg:grid-cols-4 gap-4 print:hidden">
            <KpiCard label="Total Revenue"  value={revenue}     sub="gross income"      icon={TrendingUp}   color="text-green-600"  borderColor="border-green-500" />
            <KpiCard label="Gross Profit"   value={grossProfit} sub={`${grossMargin.toFixed(1)}% margin`} icon={PesoSign} color={grossProfit >= 0 ? 'text-blue-600' : 'text-red-600'} borderColor={grossProfit >= 0 ? 'border-blue-500' : 'border-red-500'} />
            <KpiCard label="Operating Income" value={opIncome}  sub={`${opMargin.toFixed(1)}% margin`}   icon={Activity}   color={opIncome >= 0 ? 'text-indigo-600' : 'text-red-600'}  borderColor={opIncome >= 0 ? 'border-indigo-500' : 'border-red-500'} />
            <KpiCard label="Net Income"     value={netIncome}   sub={`${netMargin.toFixed(1)}% net margin`} icon={netIncome >= 0 ? TrendingUp : TrendingDown} color={netIncome >= 0 ? 'text-green-600' : 'text-red-600'} borderColor={netIncome >= 0 ? 'border-green-500' : 'border-red-500'} />
          </div>

          {/* Margin indicators */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 print:hidden">
            {[
              { label: 'Gross Margin', pct: grossMargin, color: grossMargin >= 40 ? 'bg-green-500' : grossMargin >= 20 ? 'bg-yellow-400' : 'bg-red-400' },
              { label: 'Op. Margin',   pct: opMargin,    color: opMargin   >= 15 ? 'bg-green-500' : opMargin   >= 5  ? 'bg-yellow-400' : 'bg-red-400' },
              { label: 'Net Margin',   pct: netMargin,   color: netMargin  >= 10 ? 'bg-green-500' : netMargin  >= 3  ? 'bg-yellow-400' : 'bg-red-400' },
            ].map((m) => (
              <div key={m.label} className="card p-4">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-xs font-semibold text-gray-600">{m.label}</span>
                  <span className={`text-sm font-bold ${m.pct >= 0 ? 'text-gray-900' : 'text-red-600'}`}>{m.pct.toFixed(1)}%</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-2">
                  <div className={`${m.color} h-2 rounded-full transition-all`}
                    style={{ width: `${Math.min(Math.abs(m.pct), 100)}%` }} />
                </div>
                <div className="flex justify-between text-xs text-gray-400 mt-1">
                  <span>0%</span><span>50%+</span>
                </div>
              </div>
            ))}
          </div>

          {/* Charts row */}
          <div className="grid grid-cols-1 xl:grid-cols-1 sm:grid-cols-3 gap-4 print:hidden">
            <div className="xl:col-span-2 card p-5">
              <div className="flex items-center justify-between mb-4">
                <p className="text-sm font-semibold text-gray-700">P&L Waterfall</p>
                <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                  {[['bar','Waterfall'],['pie','Expense Mix']].map(([k, l]) => (
                    <button key={k} onClick={() => setChartMode(k)}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors ${chartMode === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {chartMode === 'bar' ? (
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={waterfallData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `₱${(v / 1000).toFixed(0)}K`} />
                    <ReferenceLine y={0} stroke="#9ca3af" />
                    <Tooltip content={<CustomTooltip />} />
                    <Bar dataKey="value" name="Amount" radius={[4, 4, 0, 0]}>
                      {waterfallData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={85} paddingAngle={2} dataKey="value">
                      {pieData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => formatCurrency(v)} />
                    <Legend formatter={(v) => <span className="text-xs text-gray-600">{v}</span>} />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Revenue vs Expense summary */}
            <div className="card p-5 space-y-3">
              <p className="text-sm font-semibold text-gray-700">Summary</p>
              {[
                { label: 'Revenue',         value: revenue,     color: 'bg-green-500', pct: 100 },
                { label: 'Cost of Sales',   value: cogs,        color: 'bg-red-400',   pct: revenue > 0 ? (cogs / revenue) * 100 : 0 },
                { label: 'Operating Exp.',  value: opex,        color: 'bg-orange-400',pct: revenue > 0 ? (opex / revenue) * 100 : 0 },
                { label: 'Other Income',    value: otherInc,    color: 'bg-blue-400',  pct: revenue > 0 ? (otherInc / revenue) * 100 : 0 },
                { label: 'Other Expense',   value: otherExp,    color: 'bg-purple-400',pct: revenue > 0 ? (otherExp / revenue) * 100 : 0 },
              ].map((s) => (
                <div key={s.label} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className={`w-2 h-2 rounded-full ${s.color}`} />
                      <span className="text-gray-600">{s.label}</span>
                    </div>
                    <span className="font-medium text-gray-800">{formatCurrency(s.value)}</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1">
                    <div className={`${s.color} h-1 rounded-full`} style={{ width: `${Math.min(s.pct, 100).toFixed(1)}%` }} />
                  </div>
                </div>
              ))}
              <div className={`border-t border-gray-200 pt-2 flex justify-between font-bold text-sm ${netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                <span>Net Income / (Loss)</span>
                <span>{netIncome < 0 ? `(${formatCurrency(Math.abs(netIncome))})` : formatCurrency(netIncome)}</span>
              </div>
            </div>
          </div>

          {/* ── Formal Income Statement ── */}
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-r from-gray-800 to-gray-900 px-6 py-4 print:bg-gray-800">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-bold text-lg">Statement of Profit & Loss</p>
                  <p className="text-gray-300 text-sm">For the period: {periodLabel()}</p>
                </div>
                <p className="text-gray-400 text-xs">Philippine ERP · PFRS-compliant format</p>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Revenue */}
              <Section
                title="Revenue / Net Sales"
                accounts={revenueAccounts}
                total={revenue}
                totalLabel="Total Revenue"
                totalRevenue={revenue}
                color={{ bg: 'bg-green-50', border: 'border-green-200', text: 'text-green-700' }}
              />
              <LineItem label="Total Revenue" value={revenue} bold total />

              {/* Cost of Sales */}
              {cogsAccounts.length > 0 && (
                <>
                  <Section
                    title="Cost of Sales / COGS"
                    accounts={cogsAccounts}
                    total={cogs}
                    totalRevenue={revenue}
                    color={{ bg: 'bg-red-50', border: 'border-red-200', text: 'text-red-700' }}
                    startCollapsed={false}
                  />
                  <LineItem label="Gross Profit" value={grossProfit} bold total
                    sub={`(${grossMargin.toFixed(1)}% margin)`} pct={grossMargin} />
                </>
              )}

              <div className="border-t border-dashed border-gray-200" />

              {/* Operating Expenses */}
              {opexAccounts.length > 0 && (
                <>
                  <Section
                    title="Operating Expenses"
                    accounts={opexAccounts}
                    total={opex}
                    totalRevenue={revenue}
                    color={{ bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700' }}
                    startCollapsed={false}
                  />
                  <LineItem label="Income from Operations" value={opIncome} bold total
                    sub={`(${opMargin.toFixed(1)}% margin)`} />
                </>
              )}

              {/* Other income/expense */}
              {(otherIncAccounts.length > 0 || otherExpAccounts.length > 0) && (
                <>
                  <div className="border-t border-dashed border-gray-200" />
                  {otherIncAccounts.length > 0 && (
                    <Section
                      title="Other Income"
                      accounts={otherIncAccounts}
                      total={otherInc}
                      totalRevenue={revenue}
                      color={{ bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-700' }}
                      startCollapsed={true}
                    />
                  )}
                  {otherExpAccounts.length > 0 && (
                    <Section
                      title="Other Expenses"
                      accounts={otherExpAccounts}
                      total={otherExp}
                      totalRevenue={revenue}
                      color={{ bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-700' }}
                      startCollapsed={true}
                    />
                  )}
                </>
              )}

              {/* Net Income box */}
              <div className={`rounded-2xl p-5 border-2 ${netIncome >= 0 ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'} mt-4`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className={`text-lg font-bold ${netIncome >= 0 ? 'text-green-800' : 'text-red-800'}`}>
                      {netIncome >= 0 ? 'Net Income' : 'Net Loss'}
                    </p>
                    <p className={`text-xs mt-0.5 ${netIncome >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {periodLabel()} · Net margin: {netMargin.toFixed(2)}%
                    </p>
                  </div>
                  <p className={`text-3xl font-bold ${netIncome >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {netIncome < 0 ? `(${formatCurrency(Math.abs(netIncome))})` : formatCurrency(netIncome)}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Print footer */}
          <div className="hidden print:block text-center text-xs text-gray-400 mt-4 pt-4 border-t border-gray-200">
            <p>Generated on {formatDate(new Date().toISOString())} · Philippine ERP Accounting System</p>
            <p>All amounts in Philippine Peso (₱) · Prepared in accordance with PFRS for SMEs</p>
          </div>
        </>
      ) : (
        <div className="card p-12 text-center">
          <TrendingUp className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500">No income statement data</p>
          <p className="text-xs text-gray-400 mt-1">Post revenue and expense journal entries to see the P&L</p>
        </div>
      )}
    </div>
  );
}
