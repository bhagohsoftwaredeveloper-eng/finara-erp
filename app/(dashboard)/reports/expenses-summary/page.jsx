'use client';
import { useState, useEffect, useCallback } from 'react';
import { financialReports as api, accounts as acctApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { RefreshCw, Printer, FileSpreadsheet, Download } from 'lucide-react';
import { formatCurrency } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import { exportToExcel, exportToCSV } from '@/lib/export';
import { todayPH } from '@/lib/arAging';
import AccountSelect from '@/components/ui/AccountSelect';
import { TagSelect, useFleetTags } from '@/components/ui/CostTags';

const GROUPS = [
  { value: 'account', label: 'Account', col: 'Expense Account' },
  { value: 'driver', label: 'Driver', col: 'Driver' },
  { value: 'vehicle', label: 'Vehicle', col: 'Vehicle' },
  { value: 'month', label: 'Month', col: 'Month' },
];

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v) => (v == null || v === '' ? '' : Number(v).toFixed(2));
const yearStart = () => `${todayPH().slice(0, 4)}-01-01`;

export default function ExpensesSummaryPage() {
  const fleet = useFleetTags();
  const [accounts, setAccounts]   = useState([]);
  const [from, setFrom]           = useState(yearStart());
  const [to, setTo]               = useState(todayPH());
  const [groupBy, setGroupBy]     = useState('account');
  const [accountId, setAccountId] = useState('');
  const [driverId, setDriverId]   = useState(null);
  const [vehicleId, setVehicleId] = useState(null);
  const [data, setData]           = useState(null);
  const [busy, setBusy]           = useState(false);

  useEffect(() => {
    acctApi.list({ active: true }).then((r) => setAccounts(r.data)).catch(() => {}); // filter stays empty
  }, []);

  const generate = useCallback(async () => {
    setBusy(true);
    try {
      setData((await api.expensesSummary({
        from, to, groupBy,
        ...(accountId && { accountId }), ...(driverId && { driverId }), ...(vehicleId && { vehicleId }),
      })).data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not generate the summary');
      setData(null);
    } finally { setBusy(false); }
  }, [from, to, groupBy, accountId, driverId, vehicleId]);
  useEffect(() => { generate(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const group = GROUPS.find((g) => g.value === groupBy);
  const filterNote = [
    accountId && accounts.find((a) => String(a.id) === String(accountId)) && `Account: ${accounts.find((a) => String(a.id) === String(accountId)).accountName}`,
    driverId && fleet.drivers.find((d) => d.id === driverId) && `Driver: ${fleet.drivers.find((d) => d.id === driverId).code}`,
    vehicleId && fleet.vehicles.find((v) => v.id === vehicleId) && `Vehicle: ${fleet.vehicles.find((v) => v.id === vehicleId).code}`,
  ].filter(Boolean).join(' · ');

  const columns = [
    { key: 'label', label: group.col }, { key: 'count', label: '# Entries' },
    { key: 'amount', label: 'Amount', format: num }, { key: 'pct', label: '% of Total', format: (v) => (v == null ? '' : v.toFixed(1)) },
  ];
  const fileRows = data ? [...data.rows, { label: 'TOTAL', count: data.rows.reduce((s, r) => s + r.count, 0), amount: data.total, pct: data.total === 0 ? null : 100 }] : [];
  const fileName = `Expenses-by-${groupBy}-${from}-to-${to}`;

  const print = () => {
    const body = `
      ${filterNote ? `<p class="small gray">${esc(filterNote)}</p>` : ''}
      <table>
        <thead><tr><th>${esc(group.col)}</th><th class="right"># Entries</th><th class="right">Amount</th><th class="right">% of Total</th></tr></thead>
        <tbody>${data.rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="right">${r.count}</td><td class="right">${phpFmt(r.amount)}</td><td class="right">${r.pct == null ? '' : `${r.pct.toFixed(1)}%`}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>TOTAL</td><td class="right">${data.rows.reduce((s, r) => s + r.count, 0)}</td><td class="right">${phpFmt(data.total)}</td><td></td></tr></tfoot>
      </table>
      <p class="small gray" style="margin-top:8px;">Net expenses (debits less credits) from posted journal entries.</p>`;
    printDocument(`Expenses Summary by ${group.label}`, `${dateFmt(from)} — ${dateFmt(to)}`, body);
  };

  const expenseAccounts = accounts.filter((a) => a.accountType === 'EXPENSE');

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Expenses Summary</h1>
          <p className="page-subtitle">All expenses from posted journal entries, grouped by account, driver, vehicle or month</p>
        </div>
      </div>

      <div className="card">
        <div className="card-body space-y-3">
          <div className="flex flex-wrap items-end gap-3">
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
            <div className="ml-auto flex flex-wrap gap-2">
              <button className="btn-secondary btn-sm" disabled={!data} onClick={() => exportToExcel(fileRows, columns, fileName, 'Expenses')}><FileSpreadsheet className="w-3.5 h-3.5" /> Excel</button>
              <button className="btn-secondary btn-sm" disabled={!data} onClick={() => exportToCSV(fileRows, columns, fileName)}><Download className="w-3.5 h-3.5" /> CSV</button>
              <button className="btn-secondary btn-sm" disabled={!data} onClick={print}><Printer className="w-3.5 h-3.5" /> Print / PDF</button>
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-gray-100">
            <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide pb-2">Only</span>
            <div className="form-group w-64">
              <label className="label">Account (e.g. Repairs &amp; Maintenance)</label>
              <AccountSelect value={accountId} onChange={(v) => setAccountId(v || '')} accounts={expenseAccounts} placeholder="— All expense accounts —" />
            </div>
            <div className="form-group w-52">
              <label className="label">Driver</label>
              <TagSelect kind="driver" fleet={fleet} value={driverId} onChange={setDriverId} className="select" />
            </div>
            <div className="form-group w-52">
              <label className="label">Vehicle</label>
              <TagSelect kind="vehicle" fleet={fleet} value={vehicleId} onChange={setVehicleId} className="select" />
            </div>
          </div>
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="card p-5 border-l-4 border-l-red-500">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Total Expenses</p>
              <p className="text-2xl font-bold text-gray-900">{formatCurrency(data.total)}</p>
            </div>
            <div className="card p-5 border-l-4 border-l-gray-400">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{group.label === 'Month' ? 'Months' : `${group.label}s`}</p>
              <p className="text-2xl font-bold text-gray-900">{data.rows.length}</p>
            </div>
            <div className="card p-5 border-l-4 border-l-blue-500">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Journal entries</p>
              <p className="text-2xl font-bold text-gray-900">{data.rows.reduce((s, r) => s + r.count, 0)}</p>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <table className="table w-full">
              <thead><tr>
                <th className="pl-4">{group.col}</th><th className="text-right"># Entries</th>
                <th className="text-right">Amount</th><th className="text-right pr-4 w-64">% of Total</th>
              </tr></thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr><td colSpan={4} className="text-center py-10 text-gray-400">No posted expenses in this selection.</td></tr>
                )}
                {data.rows.map((r) => (
                  <tr key={r.key} className="border-b border-gray-100">
                    <td className="pl-4 py-2 text-sm">{r.label}</td>
                    <td className="text-right">{r.count}</td>
                    <td className="text-right font-semibold">{formatCurrency(r.amount)}</td>
                    <td className="pr-4">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-red-400" style={{ width: `${Math.max(0, Math.min(100, r.pct || 0))}%` }} />
                        </div>
                        <span className="text-xs text-gray-500 w-12 text-right">{r.pct == null ? '' : `${r.pct.toFixed(1)}%`}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {data.rows.length > 0 && (
                <tfoot>
                  <tr className="font-bold bg-gray-50">
                    <td className="pl-4 py-2">Total</td>
                    <td className="text-right">{data.rows.reduce((s, r) => s + r.count, 0)}</td>
                    <td className="text-right">{formatCurrency(data.total)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {(groupBy === 'driver' || groupBy === 'vehicle') && data.rows.length === 1 && data.rows[0].key === 'untagged' && (
            <p className="text-xs text-gray-500">
              Nothing is tagged with a {groupBy} in this period yet. Tag expense lines on Expense Vouchers, Vendor Bills or Journal Entries to see costs per {groupBy}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
