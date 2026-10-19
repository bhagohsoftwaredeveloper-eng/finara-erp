'use client';
import { useState, useEffect, useCallback } from 'react';
import { financialReports as api } from '@/lib/api';
import toast from 'react-hot-toast';
import { RefreshCw, Printer, FileSpreadsheet, Download, Plus, X, TrendingUp, Truck } from 'lucide-react';
import { formatCurrency } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import { exportToExcel, exportToCSV } from '@/lib/export';
import { todayPH } from '@/lib/arAging';
import { monthRanges, previousRange, rangeLabel, addDays } from '@/lib/salesRanges';
import { flattenStatement } from '@/lib/plRows';
import { TagSelect, useFleetTags } from '@/components/ui/CostTags';

const PRESETS = [
  { value: 'months', label: 'Last 3 months' },
  { value: 'previous', label: 'This vs previous period' },
  { value: 'custom', label: 'Custom ranges' },
];

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v) => (v == null || v === '' ? '' : Number(v).toFixed(2));
const pct = (v) => (v == null ? '' : `${v > 0 ? '+' : ''}${v.toFixed(1)}%`);
const monthOf = (date) => date.slice(0, 7);
const yearStart = () => `${todayPH().slice(0, 4)}-01-01`;
const firstOfMonthsAgo = (n) => {
  const [y, m] = todayPH().split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 - n, 1)).toISOString().slice(0, 10);
};

// Positive is good for income lines, bad for expense lines; colour only the bottom lines
// (profit) where up is unambiguously good, and keep the rest neutral.
const ChangeCell = ({ row }) => {
  if (row.change == null) return <span className="text-gray-300">—</span>;
  const good = row.type === 'summary';
  const cls = !good ? 'text-gray-600' : row.change > 0 ? 'text-green-600' : row.change < 0 ? 'text-red-600' : 'text-gray-500';
  return (
    <span className={cls}>
      {row.change > 0 ? '+' : ''}{formatCurrency(row.change)}
      {row.changePct != null && <span className="text-xs ml-1">({pct(row.changePct)})</span>}
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

// One statement, on screen and as downloads. `showTotal` adds a Total column (not meaningful
// for a comparison of periods); `showChange` adds the change of the newest column vs the one before it.
function useStatementOutput(data, { showTotal, showChange, title, subtitle, fileName }) {
  const rows = data ? flattenStatement(data, { showChange }) : [];

  const columns = data ? [
    { key: 'label', label: 'Account' },
    ...data.columns.map((c, i) => ({ key: `v${i}`, label: c.label, format: num })),
    ...(showTotal ? [{ key: 'total', label: 'Total', format: num }] : []),
    ...(showChange ? [{ key: 'change', label: 'Change', format: num }, { key: 'changePct', label: 'Change %', format: (v) => (v == null ? '' : v.toFixed(1)) }] : []),
  ] : [];
  const fileRows = rows.map((r) => ({
    ...r, label: r.type === 'header' ? r.label.toUpperCase() : r.label,
    ...Object.fromEntries((r.values || []).map((v, i) => [`v${i}`, v])),
  }));

  const print = () => {
    const head = `<th>Account</th>${data.columns.map((c) => `<th class="right">${esc(c.label)}</th>`).join('')}${showTotal ? '<th class="right">Total</th>' : ''}${showChange ? '<th class="right">Change</th><th class="right">%</th>' : ''}`;
    const body = rows.map((r) => {
      if (r.type === 'header') return `<tr><td colspan="${1 + data.columns.length + (showTotal ? 1 : 0) + (showChange ? 2 : 0)}" class="bold" style="background:#f3f4f6;">${esc(r.label)}</td></tr>`;
      const bold = r.type === 'account' ? '' : ' bold';
      return `<tr><td class="${bold.trim()}" style="${r.type === 'account' ? 'padding-left:16px;' : ''}">${esc(r.label)}</td>
        ${r.values.map((v) => `<td class="right${bold}">${phpFmt(v)}</td>`).join('')}
        ${showTotal ? `<td class="right${bold}">${phpFmt(r.total)}</td>` : ''}
        ${showChange ? `<td class="right${bold}">${r.change == null ? '' : phpFmt(r.change)}</td><td class="right${bold}">${esc(pct(r.changePct))}</td>` : ''}</tr>`;
    }).join('');
    printDocument(title, subtitle, `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
      <p class="small gray" style="margin-top:8px;">Posted journal entries only. ${showChange ? 'Change compares the last column with the one before it.' : ''}</p>`);
  };

  return { rows, onExcel: () => exportToExcel(fileRows, columns, fileName, 'Profit and Loss'), onCsv: () => exportToCSV(fileRows, columns, fileName), onPrint: print };
}

function StatementTable({ data, rows, showTotal, showChange }) {
  const span = 1 + data.columns.length + (showTotal ? 1 : 0) + (showChange ? 1 : 0);
  return (
    <div className="card overflow-x-auto">
      <table className="table w-full">
        <thead><tr>
          <th className="pl-4">Account</th>
          {data.columns.map((c) => <th key={c.key} className="text-right whitespace-nowrap">{c.label}</th>)}
          {showTotal && <th className="text-right">Total</th>}
          {showChange && <th className="text-right pr-4">Change</th>}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => {
            if (r.type === 'header') {
              return <tr key={i} className="bg-gray-50"><td colSpan={span} className="pl-4 py-2 text-xs font-bold uppercase tracking-wide text-gray-500">{r.label}</td></tr>;
            }
            const strong = r.type !== 'account';
            return (
              <tr key={i} className={`border-b border-gray-100 ${r.type === 'summary' ? 'bg-blue-50/50 font-bold' : r.type === 'total' ? 'font-semibold' : ''}`}>
                <td className={`py-2 ${r.type === 'account' ? 'pl-8 text-sm text-gray-700' : 'pl-4'}`}>{r.label}</td>
                {r.values.map((v, j) => (
                  <td key={j} className={`text-right ${strong ? '' : v === 0 ? 'text-gray-300' : ''}`}>{formatCurrency(v)}</td>
                ))}
                {showTotal && <td className="text-right font-semibold">{formatCurrency(r.total)}</td>}
                {showChange && <td className="text-right pr-4"><ChangeCell row={r} /></td>}
              </tr>
            );
          })}
          {rows.length <= 1 && (
            <tr><td colSpan={span} className="text-center py-10 text-gray-400">No posted revenue or expenses in this selection.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Tab 1: by driver / vehicle ───────────────────────────────
function TagTab() {
  const fleet = useFleetTags();
  const [dimension, setDimension] = useState('driver');
  const [from, setFrom]           = useState(yearStart());
  const [to, setTo]               = useState(todayPH());
  const [filterId, setFilterId]   = useState(null);
  const [data, setData]           = useState(null);
  const [busy, setBusy]           = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    try {
      setData((await api.profitLoss({
        mode: 'tag', dimension, from, to,
        ...(filterId && { [dimension === 'driver' ? 'driverId' : 'vehicleId']: filterId }),
      })).data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not generate the report');
      setData(null);
    } finally { setBusy(false); }
  }, [dimension, from, to, filterId]);
  useEffect(() => { generate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const word = dimension === 'driver' ? 'driver' : 'vehicle';
  const out = useStatementOutput(data, {
    showTotal: true, showChange: false,
    title: `Profit & Loss by ${word}`, subtitle: `${dateFmt(from)} — ${dateFmt(to)}`,
    fileName: `Profit-and-Loss-by-${word}-${from}-to-${to}`,
  });

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="card-body flex flex-wrap items-end gap-3">
          <div className="form-group">
            <label className="label">Columns by</label>
            <select className="select" value={dimension} onChange={(e) => { setDimension(e.target.value); setFilterId(null); }}>
              <option value="driver">Driver</option>
              <option value="vehicle">Vehicle</option>
            </select>
          </div>
          <div className="form-group">
            <label className="label">From</label>
            <input type="date" className="input" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="label">To</label>
            <input type="date" className="input" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} />
          </div>
          <div className="form-group w-56">
            <label className="label">Only this {word}</label>
            <TagSelect key={dimension} kind={dimension} fleet={fleet} value={filterId} onChange={setFilterId} className="select" />
          </div>
          <button className="btn-primary" onClick={generate} disabled={busy}>
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Generating…' : 'Generate'}
          </button>
          <div className="ml-auto"><DownloadButtons disabled={!data} onExcel={out.onExcel} onCsv={out.onCsv} onPrint={out.onPrint} /></div>
        </div>
      </div>

      {data && <StatementTable data={data} rows={out.rows} showTotal showChange={false} />}
      {data && data.columns.length === 1 && data.columns[0].key === 'untagged' && (
        <p className="text-xs text-gray-500">
          Nothing is tagged with a {word} in this period yet, so everything is under “Untagged”. Tag expense lines on
          Expense Vouchers, Vendor Bills or Journal Entries to see costs per {word}.
        </p>
      )}
    </div>
  );
}

// ─── Tab 2: comparative ───────────────────────────────────────
function CompareTab() {
  const [preset, setPreset]     = useState('months');
  const [endMonth, setEndMonth] = useState(monthOf(todayPH()));
  const [count, setCount]       = useState(3);
  const [from, setFrom]         = useState(`${monthOf(todayPH())}-01`);
  const [to, setTo]             = useState(todayPH());
  const [custom, setCustom]     = useState([
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
      setData((await api.profitLoss({
        mode: 'compare', ranges: rs.map((r) => `${r.from}:${r.to}`).join(','), labels: rs.map((r) => r.label.replace(/,/g, ' ')).join(','),
      })).data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not generate the comparison');
      setData(null);
    } finally { setBusy(false); }
  }, [preset, endMonth, count, from, to, custom]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { generate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const multi = !!data && data.columns.length > 1;
  const out = useStatementOutput(data, {
    showTotal: false, showChange: multi,
    title: 'Profit & Loss — Comparative', subtitle: data ? data.columns.map((c) => c.label).join(' · ') : '',
    fileName: 'Profit-and-Loss-comparative',
  });
  const setCustomRange = (i, patch) => setCustom((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  return (
    <div className="space-y-5">
      <div className="card">
        <div className="card-body space-y-4">
          <div className="flex flex-wrap items-end gap-3">
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
            <div className="ml-auto"><DownloadButtons disabled={!data} onExcel={out.onExcel} onCsv={out.onCsv} onPrint={out.onPrint} /></div>
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

      {data && <StatementTable data={data} rows={out.rows} showTotal={false} showChange={multi} />}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function ProfitLossPage() {
  const [tab, setTab] = useState('tag');
  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Profit &amp; Loss</h1>
          <p className="page-subtitle">From posted journal entries: per driver or vehicle, or compared across periods</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {[{ key: 'tag', label: 'By Driver / Vehicle', icon: Truck }, { key: 'compare', label: 'Comparative', icon: TrendingUp }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />{t.label}
          </button>
        ))}
      </div>

      {/* Both tabs stay mounted so switching does not lose what was generated. */}
      <div className={tab === 'tag' ? '' : 'hidden'}><TagTab /></div>
      <div className={tab === 'compare' ? '' : 'hidden'}><CompareTab /></div>
    </div>
  );
}
