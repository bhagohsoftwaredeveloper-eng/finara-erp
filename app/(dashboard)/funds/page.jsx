'use client';
import { useState, useEffect, useCallback } from 'react';
import { funds as api, expenses as expApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { RefreshCw, Printer, FileSpreadsheet, Download, Wallet, Megaphone, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatCurrency, getUser } from '@/lib/auth';
import { printDocument, phpFmt, dateFmt } from '@/lib/print';
import { exportToExcel, exportToCSV } from '@/lib/export';
import { todayPH } from '@/lib/arAging';

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const num = (v) => (v == null || v === '' ? '' : Number(v).toFixed(2));
const monthStart = () => `${todayPH().slice(0, 7)}-01`;
const prevMonth = () => {
  const [y, m] = todayPH().split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};
const MANAGE_ROLES = ['ADMIN', 'MANAGER', 'SUPER_ADMIN'];

// ─── A fund's summary for a date range (shared by both tabs) ──
function FundSummary({ fund, title, refreshKey, children }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo]     = useState(todayPH());
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);

  const generate = useCallback(async () => {
    setBusy(true);
    try {
      setData((await api.summary({ fund, from, to })).data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not generate the fund summary');
      setData(null);
    } finally { setBusy(false); }
  }, [fund, from, to]);
  useEffect(() => { generate(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fileName = `${fund}-fund-${from}-to-${to}`;
  const ledgerCols = [
    { key: 'date', label: 'Date' }, { key: 'entryNo', label: 'Entry' }, { key: 'reference', label: 'Reference' },
    { key: 'description', label: 'Description' }, { key: 'in', label: 'In', format: num },
    { key: 'out', label: 'Out', format: num }, { key: 'balance', label: 'Balance', format: num },
  ];
  const ledgerRows = data ? [
    { description: 'Opening balance', balance: data.opening },
    ...data.rows,
    { description: 'Closing balance', in: data.totalIn, out: data.totalOut, balance: data.closing },
  ] : [];

  const print = () => {
    const breakdown = (name, list) => list.length === 0 ? '' : `
      <div class="section-title">${name}</div>
      <table><tbody>${list.map((d) => `<tr><td>${esc(d.label)}</td><td class="right">${phpFmt(d.amount)}</td></tr>`).join('')}</tbody></table>`;
    const body = `
      <table>
        <thead><tr><th>Fund account</th><th class="right">Opening</th><th class="right">In</th><th class="right">Out</th><th class="right">Closing</th></tr></thead>
        <tbody>${data.accounts.map((a) => `<tr><td>${esc(a.code)} · ${esc(a.name)}</td><td class="right">${phpFmt(a.opening)}</td><td class="right">${phpFmt(a.in)}</td><td class="right">${phpFmt(a.out)}</td><td class="right bold">${phpFmt(a.closing)}</td></tr>`).join('')}</tbody>
        <tfoot><tr><td>TOTAL</td><td class="right">${phpFmt(data.opening)}</td><td class="right">${phpFmt(data.totalIn)}</td><td class="right">${phpFmt(data.totalOut)}</td><td class="right">${phpFmt(data.closing)}</td></tr></tfoot>
      </table>
      ${breakdown('Where the money went', data.disbursements)}
      ${breakdown('Where the money came from', data.replenishments)}
      <div class="section-title">Ledger</div>
      <table>
        <thead><tr><th>Date</th><th>Entry</th><th>Reference</th><th>Description</th><th class="right">In</th><th class="right">Out</th><th class="right">Balance</th></tr></thead>
        <tbody>
          <tr><td colspan="6" class="gray">Opening balance</td><td class="right bold">${phpFmt(data.opening)}</td></tr>
          ${data.rows.map((r) => `<tr><td>${dateFmt(r.date)}</td><td class="mono">${esc(r.entryNo)}</td><td>${esc(r.reference || '')}</td><td>${esc(r.description)}</td><td class="right">${r.in ? phpFmt(r.in) : ''}</td><td class="right">${r.out ? phpFmt(r.out) : ''}</td><td class="right">${phpFmt(r.balance)}</td></tr>`).join('')}
        </tbody>
      </table>`;
    printDocument(title, `${dateFmt(from)} — ${dateFmt(to)}`, body);
  };

  return (
    <div className="space-y-5">
      {data && (
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ['Opening balance', data.opening, 'border-l-gray-400', ''],
          ['Money in', data.totalIn, 'border-l-green-500', ''],
          ['Money out', data.totalOut, 'border-l-red-500', ''],
          ['Closing balance', data.closing, data.closing < 0 ? 'border-l-red-600' : 'border-l-blue-500', data.closing < 0 ? 'text-red-600' : ''],
        ].map(([lbl, v, border, text]) => (
          <div key={lbl} className={`card p-5 border-l-4 ${border}`}>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">{lbl}</p>
            <p className={`text-2xl font-bold text-gray-900 ${text}`}>{formatCurrency(v)}</p>
          </div>
        ))}
      </div>
      )}

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
          <button className="btn-primary" onClick={generate} disabled={busy}>
            <RefreshCw className={`w-4 h-4 ${busy ? 'animate-spin' : ''}`} /> {busy ? 'Generating…' : 'Generate'}
          </button>
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn-secondary btn-sm" disabled={!data} onClick={() => exportToExcel(ledgerRows, ledgerCols, fileName, 'Fund')}><FileSpreadsheet className="w-3.5 h-3.5" /> Excel</button>
            <button className="btn-secondary btn-sm" disabled={!data} onClick={() => exportToCSV(ledgerRows, ledgerCols, fileName)}><Download className="w-3.5 h-3.5" /> CSV</button>
            <button className="btn-secondary btn-sm" disabled={!data} onClick={print}><Printer className="w-3.5 h-3.5" /> Print / PDF</button>
          </div>
        </div>
      </div>

      {data && data.missingCodes.length > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>No account {data.missingCodes.join(', ')} in the chart of accounts{fund === 'marketing' ? ' yet. Create it in the settings below.' : '. It is left out of this summary.'}</span>
        </div>
      )}

      {children}

      {data && (
        <>
          {data.accounts.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="table w-full">
                <thead><tr>
                  <th className="pl-4">Fund account</th><th className="text-right">Opening</th>
                  <th className="text-right">In</th><th className="text-right">Out</th><th className="text-right pr-4">Closing</th>
                </tr></thead>
                <tbody>
                  {data.accounts.map((a) => (
                    <tr key={a.id} className="border-b border-gray-100">
                      <td className="pl-4 py-2 text-sm"><span className="font-mono text-gray-500 mr-2">{a.code}</span>{a.name}</td>
                      <td className="text-right">{formatCurrency(a.opening)}</td>
                      <td className="text-right">{formatCurrency(a.in)}</td>
                      <td className="text-right">{formatCurrency(a.out)}</td>
                      <td className={`text-right pr-4 font-semibold ${a.closing < 0 ? 'text-red-600' : ''}`}>{formatCurrency(a.closing)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {[['Where the money went', data.disbursements, 'bg-red-400'], ['Where the money came from', data.replenishments, 'bg-green-400']].map(([lbl, list, bar]) => {
              const total = list.reduce((s, d) => s + d.amount, 0);
              return (
                <div key={lbl} className="card">
                  <div className="card-header"><h3 className="font-semibold text-gray-900 text-sm">{lbl}</h3></div>
                  <div className="card-body space-y-2">
                    {list.length === 0 && <p className="text-sm text-gray-400">Nothing in this period.</p>}
                    {list.map((d) => (
                      <div key={d.label}>
                        <div className="flex justify-between text-sm"><span className="text-gray-700">{d.label}</span><span className="font-medium">{formatCurrency(d.amount)}</span></div>
                        <div className="h-1.5 bg-gray-100 rounded-full mt-1 overflow-hidden"><div className={`h-full ${bar}`} style={{ width: `${total ? (d.amount / total) * 100 : 0}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="card overflow-x-auto">
            <div className="card-header"><h3 className="font-semibold text-gray-900 text-sm">Ledger</h3></div>
            <table className="table w-full">
              <thead><tr>
                <th className="pl-4">Date</th><th>Entry</th><th>Reference</th><th>Description</th>
                <th className="text-right">In</th><th className="text-right">Out</th><th className="text-right pr-4">Balance</th>
              </tr></thead>
              <tbody>
                <tr className="bg-gray-50"><td colSpan={6} className="pl-4 py-2 text-gray-500 text-sm">Opening balance</td><td className="text-right pr-4 font-semibold">{formatCurrency(data.opening)}</td></tr>
                {data.rows.length === 0 && <tr><td colSpan={7} className="text-center py-8 text-gray-400">No movement in this period.</td></tr>}
                {data.rows.map((r, i) => (
                  <tr key={`${r.entryNo}-${i}`} className="border-b border-gray-100">
                    <td className="pl-4 py-2 text-sm">{dateFmt(r.date)}</td>
                    <td className="font-mono text-xs text-gray-500">{r.entryNo}</td>
                    <td className="text-sm">{r.reference || '—'}</td>
                    <td className="text-sm text-gray-600">{r.description}</td>
                    <td className="text-right">{r.in ? formatCurrency(r.in) : ''}</td>
                    <td className="text-right">{r.out ? formatCurrency(r.out) : ''}</td>
                    <td className={`text-right pr-4 font-semibold ${r.balance < 0 ? 'text-red-600' : ''}`}>{formatCurrency(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Marketing Fund: settings and the monthly allocation ──────
function MarketingControls({ canManage, onChanged }) {
  const [cfg, setCfg]               = useState(null);
  const [categories, setCategories] = useState([]);
  const [saving, setSaving]         = useState(false);
  const [month, setMonth]           = useState(prevMonth());
  const [preview, setPreview]       = useState(null);
  const [posting, setPosting]       = useState(false);

  const loadCfg = useCallback(() => api.config().then((r) => setCfg(r.data)).catch(() => toast.error('Could not load the fund settings')), []);
  useEffect(() => {
    loadCfg();
    expApi.categories().then((r) => setCategories(r.data)).catch(() => {}); // the list just stays empty
  }, [loadCfg]);

  const loadPreview = useCallback(async () => {
    try { setPreview((await api.allocationPreview(month)).data); }
    catch (err) { setPreview(null); toast.error(err.response?.data?.error || 'Could not work out the allocation'); }
  }, [month]);
  useEffect(() => { loadPreview(); }, [loadPreview, cfg]);

  if (!cfg) return null;
  const m = cfg.marketing;
  const setM = (patch) => setCfg((c) => ({ ...c, marketing: { ...c.marketing, ...patch } }));
  const toggleCategory = (value) => setM({ categories: m.categories.includes(value) ? m.categories.filter((c) => c !== value) : [...m.categories, value] });

  const save = async () => {
    setSaving(true);
    try {
      setCfg((await api.saveConfig({ marketing: m })).data);
      toast.success('Marketing Fund settings saved');
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save');
    } finally { setSaving(false); }
  };

  const createAccount = async () => {
    try {
      const { data } = await api.createMarketingAccount();
      toast.success(data.created ? `Account ${data.account.accountCode} Marketing Fund created` : 'The account already exists');
      await loadPreview();
      onChanged();
    } catch (err) { toast.error(err.response?.data?.error || 'Could not create the account'); }
  };

  const allocate = async () => {
    if (!confirm(`Set aside ${formatCurrency(preview.amount)} (${preview.percent}% of ${month} net income of ${formatCurrency(preview.netIncome)}) for marketing?`)) return;
    setPosting(true);
    try {
      const { data } = await api.allocate(month);
      toast.success(`Allocated ${formatCurrency(data.amount)} (${data.entryNo})`);
      await loadPreview();
      onChanged();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not post the allocation');
    } finally { setPosting(false); }
  };

  const fundAccountMissing = preview?.accountsMissing?.includes(m.accountCode);
  const canPost = canManage && m.enabled && preview && preview.amount > 0 && !preview.alreadyAllocated && preview.accountsMissing.length === 0;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      {/* Settings */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-gray-900 text-sm">Marketing Fund settings</h3></div>
        <div className="card-body space-y-4">
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" disabled={!canManage} checked={m.enabled} onChange={(e) => setM({ enabled: e.target.checked })} />
            <span className="text-sm font-medium text-gray-700">Use a Marketing Fund</span>
          </label>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="form-group mb-0">
              <label className="label">% of net income</label>
              <input type="number" min="0" max="100" step="0.5" className="input" disabled={!canManage}
                value={m.percent} onChange={(e) => setM({ percent: e.target.value })} />
            </div>
            <div className="form-group mb-0">
              <label className="label">Fund account</label>
              <input className="input font-mono" disabled={!canManage} value={m.accountCode} onChange={(e) => setM({ accountCode: e.target.value })} />
            </div>
            <div className="form-group mb-0">
              <label className="label">Set aside from</label>
              <input className="input font-mono" disabled={!canManage} value={m.sourceAccountCode} onChange={(e) => setM({ sourceAccountCode: e.target.value })} />
            </div>
          </div>
          <div>
            <p className="label">Expense categories paid from the fund</p>
            <div className="flex flex-wrap gap-2">
              {categories.map((c) => (
                <button key={c.value} type="button" disabled={!canManage} onClick={() => toggleCategory(c.value)}
                  className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${m.categories.includes(c.value) ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300'}`}>
                  {c.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1">A voucher in one of these categories is paid from the fund unless another payment account is chosen.</p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
              {fundAccountMissing && <button className="btn-secondary btn-sm" onClick={createAccount}>Create account {m.accountCode} “Marketing Fund”</button>}
            </div>
          )}
        </div>
      </div>

      {/* Allocation */}
      <div className="card">
        <div className="card-header"><h3 className="font-semibold text-gray-900 text-sm">Set aside {m.percent}% of a month’s net income</h3></div>
        <div className="card-body space-y-4">
          <div className="form-group mb-0 w-48">
            <label className="label">Month</label>
            <input type="month" className="input" value={month} max={todayPH().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </div>
          {preview && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Net income for {month}</span><span className={`font-medium ${preview.netIncome < 0 ? 'text-red-600' : ''}`}>{formatCurrency(preview.netIncome)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">{preview.percent}% to the Marketing Fund</span><span className="text-lg font-bold">{formatCurrency(preview.amount)}</span></div>
              <p className="text-xs text-gray-400">Posts: debit {preview.fundAccountCode} Marketing Fund, credit {preview.sourceAccountCode}, dated {dateFmt(preview.to)}.</p>
              {preview.alreadyAllocated && (
                <p className="flex items-center gap-1.5 text-green-700"><CheckCircle2 className="w-4 h-4" /> Already allocated ({preview.alreadyAllocated.entryNo}).</p>
              )}
              {!preview.alreadyAllocated && preview.amount === 0 && <p className="text-amber-700">There is no net income to set aside for this month.</p>}
              {!m.enabled && <p className="text-amber-700">Switch on “Use a Marketing Fund” and save to allocate.</p>}
              {preview.accountsMissing.length > 0 && <p className="text-amber-700">Missing account {preview.accountsMissing.join(', ')} in the chart of accounts.</p>}
            </div>
          )}
          {canManage ? (
            <button className="btn-primary" onClick={allocate} disabled={!canPost || posting}>
              <Megaphone className="w-4 h-4" /> {posting ? 'Posting…' : 'Post allocation'}
            </button>
          ) : (
            <p className="text-xs text-gray-400">Only an admin or manager can post the allocation.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────
export default function FundsPage() {
  const [tab, setTab] = useState('revolving');
  const [refreshKey, setRefreshKey] = useState(0);
  const user = typeof window !== 'undefined' ? getUser() : null;
  const canManage = !!user && MANAGE_ROLES.includes(user.role);

  return (
    <div className="space-y-5">
      <div className="page-header">
        <div>
          <h1 className="page-title">Funds</h1>
          <p className="page-subtitle">The revolving (petty cash) fund and the marketing fund, read from posted journal entries</p>
        </div>
      </div>

      <div className="flex gap-2 border-b border-gray-200">
        {[{ key: 'revolving', label: 'Revolving Fund', icon: Wallet }, { key: 'marketing', label: 'Marketing Fund', icon: Megaphone }].map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.key ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />{t.label}
          </button>
        ))}
      </div>

      <div className={tab === 'revolving' ? '' : 'hidden'}>
        <FundSummary fund="revolving" title="Revolving Fund Summary" refreshKey={0} />
      </div>
      <div className={tab === 'marketing' ? '' : 'hidden'}>
        <FundSummary fund="marketing" title="Marketing Fund Summary" refreshKey={refreshKey}>
          <MarketingControls canManage={canManage} onChanged={() => setRefreshKey((k) => k + 1)} />
        </FundSummary>
      </div>
    </div>
  );
}
