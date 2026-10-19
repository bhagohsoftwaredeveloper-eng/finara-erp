'use client';
import { useState, useEffect, useCallback } from 'react';
import { salesSummary as api } from '@/lib/api';
import toast from 'react-hot-toast';
import { RefreshCw, Printer, FileSpreadsheet, Download, Plus, X, TrendingUp } from 'lucide-react';
import { formatCurrency } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import { exportToExcel, exportToCSV } from '@/lib/export';
import { todayPH } from '@/lib/arAging';
import { monthRanges, previousRange, rangeLabel, addDays } from '@/lib/salesRanges';

const GROUPS = [
  { value: 'day', label: 'Daily' }, { value: 'week', label: 'Weekly' }, { value: 'month', label: 'Monthly' },
  { value: 'quarter', label: 'Quarterly' }, { value: 'year', label: 'Yearly' },
];
const DIMENSIONS = [
  { value: 'account', label: 'Revenue account', col: 'Revenue Account' },
  { value: 'customer', label: 'Customer', col: 'Customer' },
  { value: 'item', label: 'Item / description', col: 'Item / Description' },
];
const PRESETS = [
  { value: 'months', label: 'Last 3 months' },
  { value: 'previous', label: 'This vs previous period' },
  { value: 'custom', label: 'Custom ranges' },
];

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v) => (v == null || v === '' ? '' : Number(v).toFixed(2));
const pct = (v) => (v == null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const monthOf = (date) => date.slice(0, 7);
const firstOfMonthsAgo = (n) => {
  const [y, m] = todayPH().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10);
};

const ChangeCell = ({ change, changePct }) => {
  if (change == null) return <span className="text-gray-300">—</span>;
  const cls = change > 0 ? 'text-green-600' : change < 0 ? 'text-red-600' : 'text-gray-500';
  return (
    <span className={cls}>
      {change > 0 ? '+' : ''}{formatCurrency(change)}
      {changePct != null && <span className="text-xs ml-1">({pct(changePct)})</span>}
    </span>
  );
};

function DownloadButtons({ disabled, onExcel, onCsv, onPrint }) {
  return (
    <div className="flex flex-wrap gap-2">
      <button className="btn-secondary btn-sm" disabled={disabled} onClick={onExcel}><FileSpreadsheet className="w-3.5 h-3.5" /> Excel</button>
      <button className="btn-secondary btn-sm" disabled={disabled} onClick={onCsv}><Download className="w-3.5 h-3.5" /> CSV</button>
      <button className="btn-secondary btn-sm" disabled={disabled} onClick={onPrint}><Printer className="w-3.5 h-3.5" /> Print / PDF</button>
    </div>
  );
}

// ─── Tab 1: by period ─────────────────────────────────────────
function PeriodTab() {
  const [from, setFrom]       = useState(firstOfMonthsAgo(2));
  const [to, setTo]           = useState(todayPH());
  const [groupBy, setGroupBy] = useState('month');
  const [data, setData]       = useState(null);
  const [busy, setBusy]       = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    try {
      setData((await api.get({ mode: 'period', from, to, groupBy })).data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not generate the summary');
      setData(null);
    } finally { setBusy(false); }
  }, [from, to, groupBy]);
  useEffect(() => { generate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const groupLabel = GROUPS.find((g) => g.value === groupBy)?.label;
  const columns = [
    { key: 'label', label: 'Period' }, { key: 'count', label: '# Sales' },
    { key: 'net', label: 'Net Sales (ex-VAT)', format: num }, { key: 'vat', label: 'VAT', format: num },
    { key: 'total', label: 'Total (incl. VAT)', format: num },
  ];
  const fileRows = data ? [...data.rows, { label: 'TOTAL', ...data.totals }] : [];
  const fileName = `Sales-by-${groupBy}-${from}-to-${to}`;

  const print = () => {
    const body = `
      <table>
        <thead><tr><th>Period</th><th class="right"># Sales</th><th class="right">Net Sales (ex-VAT)</th><th class="right">VAT</th><th class="right">Total</th></tr></thead>
        <tbody>${data.rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="right">${r.count}</td><td class="right">${phpFmt(r.net)}</td><td class="right">${phpFmt(r.vat)}</td><td class="right bold">${phpFmt(r.total)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>TOTAL</td><td class="right">${data.totals.count}</td><td class="right">${phpFmt(data.totals.net)}</td><td class="right">${phpFmt(data.totals.vat)}</td><td class="right">${phpFmt(data.totals.total)}</td></tr></tfoot>
      </table>
      <p class="small gray" style="margin-top:8px;">Invoices and cash sales, excluding voided documents.</p>`;
    printDocument(`Sales Summary — ${groupLabel}`, `${dateFmt(from)} — ${dateFmt(to)}`, body);
  };

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="card-body flex flex-wrap items-end gap-3">
          <div className="form-group">
            <label className="label">From</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label">To</label>
            <input type="date" className="input" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label">Group by</label>
            <select className="select" value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.label}</option>)}
            </select>
          </div>
          <button className="btn-primary" onClick={generate} disabled={busy}>
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Generating…' : 'Generate'}
          </button>
          <div className="ml-auto">
            <DownloadButtons disabled={!data} onExcel={() => exportToExcel(fileRows, columns, fileName, 'Sales Summary')}
              onCsv={() => exportToCSV(fileRows, columns, fileName)} onPrint={print} />
          </div>
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-5 border-l-4 border-l-gray-400">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Sales</p>
              <p className="text-2xl font-bold text-gray-900">{data.totals.count}</p>
            </div>
            <div className="card p-5 border-l-4 border-l-green-500">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Net Sales (ex-VAT)</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.totals.net)}</p>
            </div>
            <div className="card p-5 border-l-4 border-l-blue-500">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total (incl. VAT)</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.totals.total)}</p>
            </div>
          </div>
          <div className="card overflow-x-auto">
            <table className="table w-full">
              <thead><tr>
                <th className="pl-4">Period</th><th className="text-right"># Sales</th>
                <th className="text-right">Net Sales (ex-VAT)</th><th className="text-right">VAT</th><th className="text-right pr-4">Total</th>
              </tr></thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key} className={`border-b border-gray-100 ${r.count === 0 ? 'text-gray-300' : ''}`}>
                    <td className="pl-4 py-2">{r.label}</td>
                    <td className="text-right">{r.count}</td>
                    <td className="text-right">{formatCurrency(r.net)}</td>
                    <td className="text-right">{formatCurrency(r.vat)}</td>
                    <td className="text-right pr-4 font-semibold">{formatCurrency(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold bg-gray-50">
                  <td className="pl-4 py-2">Total</td><td className="text-right">{data.totals.count}</td>
                  <td className="text-right">{formatCurrency(data.totals.net)}</td>
                  <td className="text-right">{formatCurrency(data.totals.vat)}</td>
                  <td className="text-right pr-4">{formatCurrency(data.totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tab 2: comparative ───────────────────────────────────────
function CompareTab() {
  const [dimension, setDimension] = useState('account');
  const [preset, setPreset]       = useState('months');
  const [endMonth, setEndMonth]   = useState(monthOf(todayPH()));
  const [count, setCount]         = useState(3);
  const [from, setFrom]           = useState(`${monthOf(todayPH())}-01`);
  const [to, setTo]               = useState(todayPH());
  const [custom, setCustom]       = useState([
    { from: firstOfMonthsAgo(1), to: addDays(firstOfMonthsAgo(0), -1) },
    { from: firstOfMonthsAgo(0), to: todayPH() },
  ]);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const ranges = () => {
    if (preset === 'months') return monthRanges(endMonth, count);
    if (preset === 'previous') {
      const prev = previousRange(from, to);
      return [{ ...prev, label: rangeLabel(prev.from, prev.to) }, { from, to, label: rangeLabel(from, to) }];
    }
    return custom.map((r) => ({ ...r, label: rangeLabel(r.from, r.to) }));
  };

  const generate = useCallback(async () => {
    const rs = ranges();
    if (rs.some((r) => !r.from || !r.to || r.from > r.to)) { toast.error('Check the dates: each range needs a start that is not after its end'); return; }
    setBusy(true);
    try {
      setData((await api.get({
        mode: 'compare', dimension,
        ranges: rs.map((r) => `${r.from}:${r.to}`).join(','),
        labels: rs.map((r) => r.label.replace(/,/g, ' ')).join(','),
      })).data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not generate the comparison');
      setData(null);
    } finally { setBusy(false); }
  }, [dimension, preset, endMonth, count, from, to, custom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { generate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const dim = DIMENSIONS.find((d) => d.value === dimension);
  const multi = data && data.ranges.length > 1;

  const columns = data ? [
    { key: 'label', label: dim.col },
    ...data.ranges.map((r, i) => ({ key: `v${i}`, label: r.label, format: num })),
    { key: 'total', label: 'Total', format: num },
    ...(multi ? [{ key: 'change', label: 'Change', format: num }, { key: 'changePct', label: 'Change %', format: (v) => (v == null ? '' : v.toFixed(1)) }] : []),
  ] : [];
  const flat = (r) => ({ ...r, ...Object.fromEntries(r.values.map((v, i) => [`v${i}`, v])) });
  const fileRows = data ? [...data.rows.map(flat), flat({ label: 'TOTAL', ...data.totals })] : [];
  const fileName = `Sales-by-${dimension}-comparative`;

  const print = () => {
    const head = `<th>${esc(dim.col)}</th>${data.ranges.map((r) => `<th class="right">${esc(r.label)}</th>`).join('')}<th class="right">Total</th>${multi ? '<th class="right">Change</th><th class="right">%</th>' : ''}`;
    const line = (r, cls = '') => `<tr><td>${esc(r.label)}</td>${r.values.map((v) => `<td class="right">${phpFmt(v)}</td>`).join('')}<td class="right bold">${phpFmt(r.total)}</td>${multi ? `<td class="right">${r.change == null ? '' : phpFmt(r.change)}</td><td class="right">${esc(pct(r.changePct))}</td>` : ''}</tr>`;
    const foot = `<tr><td>TOTAL</td>${data.totals.values.map((v) => `<td class="right">${phpFmt(v)}</td>`).join('')}<td class="right">${phpFmt(data.totals.total)}</td>${multi ? `<td class="right">${data.totals.change == null ? '' : phpFmt(data.totals.change)}</td><td class="right">${esc(pct(data.totals.changePct))}</td>` : ''}</tr>`;
    const body = `<table><thead><tr>${head}</tr></thead><tbody>${data.rows.map((r) => line(r)).join('')}</tbody><tfoot>${foot}</tfoot></table>
      <p class="small gray" style="margin-top:8px;">Net sales excluding VAT; invoices and cash sales, voided documents excluded. Change compares the last column with the one before it.</p>`;
    printDocument(`Sales by ${dim.label} — Comparative`, data.ranges.map((r) => r.label).join(' · '), body);
  };

  const setCustomRange = (i, patch) => setCustom((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="card-body space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="form-group">
              <label className="label">View by</label>
              <select className="select" value={dimension} onChange={(e) => setDimension(e.target.value)}>
                {DIMENSIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Compare</label>
              <select className="select" value={preset} onChange={(e) => setPreset(e.target.value)}>
                {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>

            {preset === 'months' && (
              <>
                <div className="form-group">
                  <label className="label">Ending month</label>
                  <input type="month" className="input" value={endMonth} onChange={(e) => e.target.value && setEndMonth(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="label">Months</label>
                  <select className="select" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                    <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
                  </select>
                </div>
              </>
            )}
            {preset === 'previous' && (
              <>
                <div className="form-group">
                  <label className="label">From</label>
                  <input type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="label">To</label>
                  <input type="date" className="input" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
                </div>
              </>
            )}

            <button className="btn-primary" onClick={generate} disabled={busy}>
              <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Generating…' : 'Generate'}
            </button>
            <div className="ml-auto">
              <DownloadButtons disabled={!data} onExcel={() => exportToExcel(fileRows, columns, fileName, 'Comparative')}
                onCsv={() => exportToCSV(fileRows, columns, fileName)} onPrint={print} />
            </div>
          </div>

          {preset === 'custom' && (
            <div className="space-y-2">
              {custom.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-gray-500 w-16">Range {i + 1}</span>
                  <input type="date" className="input w-44" value={r.from} onChange={(e) => setCustomRange(i, { from: e.target.value })} />
                  <span className="text-gray-400">to</span>
                  <input type="date" className="input w-44" value={r.to} onChange={(e) => setCustomRange(i, { to: e.target.value })} />
                  {custom.length > 1 && (
                    <button type="button" className="p-1.5 text-red-400 hover:text-red-600" title="Remove range"
                      onClick={() => setCustom((cs) => cs.filter((_, idx) => idx !== i))}><X className="w-4 h-4" /></button>
                  )}
                </div>
              ))}
              {custom.length < 3 && (
                <button type="button" className="btn-secondary btn-sm"
                  onClick={() => setCustom((cs) => [...cs, { from: todayPH(), to: todayPH() }])}>
                  <Plus className="w-3.5 h-3.5" /> Add range
                </button>
              )}
              <p className="text-xs text-gray-400">Order the ranges oldest to newest. Change compares the last one with the one before it.</p>
            </div>
          )}
        </div>
      </div>

      {data && (
        <div className="card overflow-x-auto">
          <table className="table w-full">
            <thead><tr>
              <th className="pl-4">{dim.col}</th>
              {data.ranges.map((r) => <th key={r.label + r.from} className="text-right">{r.label}</th>)}
              <th className="text-right">Total</th>
              {multi && <th className="text-right pr-4">Change</th>}
            </tr></thead>
            <tbody>
              {data.rows.length === 0 && (
                <tr><td colSpan={data.ranges.length + 3} className="text-center py-10 text-gray-400">No sales in these ranges.</td></tr>
              )}
              {data.rows.map((r) => (
                <tr key={r.key} className="border-b border-gray-100">
                  <td className="pl-4 py-2 text-sm">{r.label}</td>
                  {r.values.map((v, i) => <td key={i} className={`text-right ${v === 0 ? 'text-gray-300' : ''}`}>{formatCurrency(v)}</td>)}
                  <td className="text-right font-semibold">{formatCurrency(r.total)}</td>
                  {multi && <td className="text-right pr-4"><ChangeCell change={r.change} changePct={r.changePct} /></td>}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-bold bg-gray-50">
                <td className="pl-4 py-2">Total net sales</td>
                {data.totals.values.map((v, i) => <td key={i} className="text-right">{formatCurrency(v)}</td>)}
                <td className="text-right">{formatCurrency(data.totals.total)}</td>
                {multi && <td className="text-right pr-4"><ChangeCell change={data.totals.change} changePct={data.totals.changePct} /></td>}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function SalesSummaryPage() {
  const [tab, setTab] = useState('period');
  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales Summary</h1>
          <p className="page-subtitle">Invoices and cash sales, net of VAT, voided documents excluded</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {[{ key: 'period', label: 'By Period' }, { key: 'compare', label: 'Comparative' }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {t.key === 'compare' && <TrendingUp className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />}{t.label}
          </button>
        ))}
      </div>

      {/* Both tabs stay mounted so switching does not lose what was generated. */}
      <div className={tab === 'period' ? '' : 'hidden'}><PeriodTab /></div>
      <div className={tab === 'compare' ? '' : 'hidden'}><CompareTab /></div>
    </div>
  );
}
