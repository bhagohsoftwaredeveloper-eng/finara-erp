'use client';
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, X } from 'lucide-react';
import { remittance as remittanceApi } from '@/lib/api';
import { formatCurrency } from '@/lib/auth';
import NumberInput from '@/components/NumberInput';

const fmt = (n) => formatCurrency(Number(n || 0));
const num = (v) => Number(v) || 0;
const blankCheck = () => ({ checkNo: '', bank: '', amount: '' });

// Server rows -> editable state ({ [method]: { amount, checks } })
const toState = (rows) => Object.fromEntries(rows.map((r) => [r.method, {
  amount: r.amount != null ? String(r.amount) : '',
  checks: (r.checks || []).map((c) => ({ checkNo: c.checkNo, bank: c.bank || '', amount: String(c.amount) })),
}]));

/**
 * End-of-day turn-over of "good as cash" payments: checks, GCash, Maya, bank
 * transfer, card and online. Each type shows what the books recorded today next
 * to what is being remitted, so a missing check or an unposted transfer shows
 * up as a difference. Physical cash is handled by the denomination counts.
 */
export default function GoodAsCashRemit({ date, methods, readOnly, onSaved }) {
  const [state, setState] = useState(() => toState(methods.rows));
  const [busy, setBusy] = useState(false);

  // Re-sync when the server data (or date) changes
  useEffect(() => { setState(toState(methods.rows)); }, [methods, date]);

  const patch = (m, p) => setState((s) => ({ ...s, [m]: { ...s[m], ...p } }));
  const setCheck = (m, i, k, v) =>
    patch(m, { checks: state[m].checks.map((c, idx) => (idx === i ? { ...c, [k]: v } : c)) });

  // A type with itemised checks takes its amount from the checks
  const amountOf = (r) => {
    const s = state[r.method] || { amount: '', checks: [] };
    return r.method === 'Check' && s.checks.length
      ? s.checks.reduce((t, c) => t + num(c.amount), 0)
      : num(s.amount);
  };

  const totalExpected = methods.rows.reduce((t, r) => t + r.expected, 0);
  const totalRemitted = methods.rows.reduce((t, r) => t + amountOf(r), 0);

  const matchRecorded = () =>
    setState((s) => Object.fromEntries(methods.rows.map((r) => [
      r.method,
      r.method === 'Check' && s[r.method]?.checks.length
        ? s[r.method]
        : { ...s[r.method], amount: r.expected ? String(r.expected) : '' },
    ])));

  const save = async () => {
    setBusy(true);
    try {
      await remittanceApi.daily.saveMethods({
        date,
        items: methods.rows.map((r) => ({
          method: r.method,
          amount: amountOf(r),
          checks: r.method === 'Check'
            ? (state[r.method]?.checks || []).filter((c) => c.checkNo || num(c.amount))
            : undefined,
        })),
      });
      toast.success('Good-as-cash turn-over saved');
      onSaved();
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Could not save');
    } finally { setBusy(false); }
  };

  return (
    <div className="card">
      <div className="card-header flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-900">Good as Cash — Turned in by Payment Type</h2>
          <p className="text-xs text-gray-400 font-normal">
            Cash collected today: {fmt(methods.cashRecorded)} (counted by denomination)
          </p>
        </div>
        {!readOnly && (
          <button type="button" onClick={matchRecorded} className="btn-secondary btn-sm">
            Fill with recorded amounts
          </button>
        )}
      </div>
      <div className="card-body pt-3 space-y-3">

      <div className="border border-gray-200 rounded-xl overflow-hidden">
        <table className="table table-compact">
          <thead>
            <tr>
              <th>Payment type</th>
              <th className="w-28 text-right">Recorded</th>
              <th className="w-32 text-right">Turned in</th>
              <th className="w-24 text-right">Diff.</th>
            </tr>
          </thead>
          <tbody>
            {methods.rows.map((r) => {
              const s = state[r.method] || { amount: '', checks: [] };
              const itemised = r.method === 'Check';
              const amt = amountOf(r);
              const diff = Number((amt - r.expected).toFixed(2));
              const touched = amt > 0 || r.expected > 0;
              return (
                <tr key={r.method} className="align-top">
                  <td className="text-sm">
                    <div className="font-medium">{r.method}</div>
                    {itemised && (
                      <div className="mt-2 space-y-1.5">
                        {s.checks.map((c, i) => (
                          <div key={i} className="flex flex-wrap items-center gap-1.5">
                            <input className="input text-xs w-28" placeholder="Check no." value={c.checkNo}
                              disabled={readOnly} onChange={(e) => setCheck(r.method, i, 'checkNo', e.target.value)} />
                            <input className="input text-xs w-24" placeholder="Bank" value={c.bank}
                              disabled={readOnly} onChange={(e) => setCheck(r.method, i, 'bank', e.target.value)} />
                            <NumberInput className="input text-xs text-right w-24" placeholder="0.00" value={c.amount}
                              disabled={readOnly} onChange={(v) => setCheck(r.method, i, 'amount', v)} />
                            {!readOnly && (
                              <button type="button" aria-label="Remove check"
                                onClick={() => patch(r.method, { checks: s.checks.filter((_, idx) => idx !== i) })}
                                className="p-1 text-gray-300 hover:text-red-500"><X className="w-4 h-4" /></button>
                            )}
                          </div>
                        ))}
                        {!readOnly && (
                          <button type="button" className="text-xs text-blue-600 inline-flex items-center gap-1"
                            onClick={() => patch(r.method, { checks: [...s.checks, blankCheck()] })}>
                            <Plus className="w-3 h-3" /> Add check
                          </button>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="text-right text-sm">{fmt(r.expected)}</td>
                  <td className="text-right">
                    {itemised && s.checks.length ? (
                      <span className="text-sm font-medium">{fmt(amt)}</span>
                    ) : (
                      <NumberInput className="input text-xs text-right" placeholder="0.00" value={s.amount}
                        disabled={readOnly} onChange={(v) => patch(r.method, { amount: v })} />
                    )}
                  </td>
                  <td className={`text-right text-sm font-medium ${
                    !touched ? 'text-gray-300' : diff === 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {!touched ? '—' : diff === 0 ? '✓' : `${diff > 0 ? '+' : '−'}${fmt(Math.abs(diff))}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="font-semibold">
              <td>Total</td>
              <td className="text-right">{fmt(totalExpected)}</td>
              <td className="text-right">{fmt(totalRemitted)}</td>
              <td className={`text-right ${Number((totalRemitted - totalExpected).toFixed(2)) === 0 ? 'text-green-600' : 'text-red-600'}`}>
                {fmt(Math.abs(totalRemitted - totalExpected))}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {!readOnly && (
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} className="btn-primary">
            {busy ? 'Saving…' : methods.savedAt ? 'Update Turn-over' : 'Save Turn-over'}
          </button>
          {methods.savedAt && (
            <span className="text-xs text-gray-400">Saved{methods.savedBy ? ` by ${methods.savedBy}` : ''}</span>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
