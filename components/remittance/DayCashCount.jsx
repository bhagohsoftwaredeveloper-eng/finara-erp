'use client';
import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { CheckCircle2, Circle, Loader2 } from 'lucide-react';
import { remittance as remittanceApi } from '@/lib/api';
import { formatCurrency } from '@/lib/auth';
import DenominationCounter, { useDenominationCount } from '@/components/ui/DenominationCounter';
import GoodAsCashRemit from '@/components/remittance/GoodAsCashRemit';

const fmt = (n) => formatCurrency(Number(n || 0));

// One count form (a fund at a stage). Remounted via `key` when fund/stage/date
// changes so its state always starts from what is saved for that combination.
function CountEditor({ date, fund, stage, readOnly, onSaved }) {
  const existing = stage === 'OPENING' ? fund.opening : fund.closing;
  const dn = useDenominationCount({
    accountCode: fund.accountCode,
    amount: 0,
    strict: false,
    expected: stage === 'CLOSING' ? fund.expected : undefined,
  });
  const { setCounts } = dn.counterProps;
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCounts(existing
      ? Object.fromEntries((existing.lines || []).map((l) => [l.denom, String(l.qty)]))
      : {});
  }, [existing, setCounts]);

  const usePrevious = () => {
    setCounts(Object.fromEntries((fund.previousClosing.lines || []).map((l) => [l.denom, String(l.qty)])));
  };

  const save = async () => {
    if (dn.error) { toast.error(dn.error); return; }
    setBusy(true);
    try {
      await remittanceApi.daily.saveCount({
        date, stage, accountCode: fund.accountCode, denominations: dn.lines,
      });
      toast.success(`${stage === 'OPENING' ? 'Opening' : 'Closing'} count saved`);
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not save count');
    } finally { setBusy(false); }
  };

  if (!dn.counterProps.denoms) return null;

  return (
    <div className="space-y-3">
      <DenominationCounter
        {...dn.counterProps}
        title={stage === 'OPENING'
          ? `Start of day — count the ${fund.label}`
          : `End of day — count the ${fund.label} before remitting`}
      />
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : existing ? 'Update Count' : 'Save Count'}
          </button>
          {stage === 'OPENING' && !existing && fund.previousClosing && (
            <button type="button" onClick={usePrevious} className="btn-secondary">
              Use last closing count ({fmt(fund.previousClosing.total)})
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const SOURCE_NOTE = {
  COUNTED: 'counted at start of day',
  PREVIOUS_CLOSING: 'no opening count yet — using last closing count',
  NONE: 'no opening count yet — counted as ₱0',
};

/**
 * Start-of-day and end-of-day cash count for Cash on Hand and Petty Cash.
 * Expected closing cash = opening + cash put in − cash spent (from the GL), so
 * the cashier never types it. Renders nothing when counting is switched off.
 */
export default function DayCashCount({ date, readOnly = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [accountCode, setAccountCode] = useState('1010');
  const [stage, setStage] = useState('OPENING');

  const load = useCallback(async () => {
    try {
      const res = await remittanceApi.daily.counts(date);
      setData(res.data);
    } catch { setData(null); }
    finally { setLoading(false); }
  }, [date]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  if (loading) {
    return <div className="card"><div className="card-body flex items-center gap-2 text-sm text-gray-400">
      <Loader2 className="w-4 h-4 animate-spin" /> Loading cash count…
    </div></div>;
  }
  if (!data?.enabled) return null;

  const fund = data.funds.find((f) => f.accountCode === accountCode) || data.funds[0];
  const closing = fund.closing;
  const over = fund.variance;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
    <div className="card">
      <div className="card-header">
        <h2 className="font-semibold text-gray-900">Cash Count — Start &amp; End of Day</h2>
      </div>
      <div className="card-body pt-3 space-y-4">
        {/* Fund tabs */}
        <div className="flex gap-2">
          {data.funds.map((f) => (
            <button key={f.accountCode} type="button" onClick={() => setAccountCode(f.accountCode)}
              className={`px-3 py-1.5 rounded-lg border text-sm font-medium ${
                f.accountCode === fund.accountCode
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-400'}`}>
              {f.label} <span className="font-mono text-xs opacity-80">({f.accountCode})</span>
            </button>
          ))}
        </div>

        {/* The day at a glance */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="text-xs text-gray-500">Opening</div>
            <div className="font-semibold">{fmt(fund.openingTotal)}</div>
            <div className="text-[11px] text-gray-400 leading-tight">{SOURCE_NOTE[fund.openingSource]}</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="text-xs text-gray-500">+ Cash in</div>
            <div className="font-semibold text-green-700">{fmt(fund.cashIn)}</div>
          </div>
          <div className="bg-gray-50 rounded-xl p-3">
            <div className="text-xs text-gray-500">− Cash out</div>
            <div className="font-semibold text-red-700">{fmt(fund.cashOut)}</div>
          </div>
          <div className="bg-blue-50 rounded-xl p-3">
            <div className="text-xs text-gray-500">= Expected closing</div>
            <div className="font-bold text-blue-700">{fmt(fund.expected)}</div>
          </div>
          <div className={`rounded-xl p-3 ${
            !closing ? 'bg-gray-50' : over === 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <div className="text-xs text-gray-500">Closing counted</div>
            {closing ? (
              <>
                <div className="font-bold">{fmt(closing.total)}</div>
                <div className={`text-[11px] font-medium ${over === 0 ? 'text-green-700' : 'text-red-700'}`}>
                  {over === 0 ? '✓ Balanced' : `${over > 0 ? 'Over' : 'Short'} by ${fmt(Math.abs(over))}`}
                </div>
              </>
            ) : <div className="text-gray-400">Not counted yet</div>}
          </div>
        </div>

        {/* Stage switch */}
        <div className="flex gap-2">
          {[['OPENING', 'Start of day', fund.opening], ['CLOSING', 'End of day (remit)', fund.closing]].map(
            ([s, label, row]) => (
              <button key={s} type="button" onClick={() => setStage(s)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-sm ${
                  stage === s ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium'
                              : 'border-gray-200 text-gray-600 hover:border-blue-400'}`}>
                {row ? <CheckCircle2 className="w-4 h-4 text-green-600" /> : <Circle className="w-4 h-4 text-gray-300" />}
                {label}
              </button>
            ))}
        </div>

        <CountEditor
          key={`${date}:${fund.accountCode}:${stage}`}
          date={date} fund={fund} stage={stage} readOnly={readOnly} onSaved={load}
        />

      </div>
    </div>

    {data.methods && (
      <GoodAsCashRemit date={date} methods={data.methods} readOnly={readOnly} onSaved={load} />
    )}
    </div>
  );
}
