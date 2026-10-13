'use client';
import { useEffect, useMemo, useState } from 'react';
import { settings } from '@/lib/api';
import { formatCurrency } from '@/lib/auth';

// Physical-cash funds only — mirrors server/utils/cashDenomination.js.
// 1012 (GCash) and 1020 (bank) are never counted.
const PHYSICAL_CASH_ACCOUNTS = ['1010', '1011'];
const DEFAULT_DENOMS = [1000, 500, 200, 100, 50, 20, 10, 5, 1, 0.25];
const cents = (n) => Math.round(Number(n) * 100);

/**
 * State + validation for one denomination count.
 *
 *   const dn = useDenominationCount({ accountCode, amount, strict: true });
 *   // in submit: if (dn.error) { toast.error(dn.error); return; }
 *   //            payload.denominations = dn.lines;   (undefined when not required)
 *   // in JSX:    <DenominationCounter {...dn.counterProps} />
 *
 * `required` is true only when the business enabled counting AND the fund is
 * physical cash, so callers can wire it unconditionally.
 */
export function useDenominationCount({ accountCode, amount, strict = true, expected }) {
  const [cfg, setCfg] = useState({ enabled: false, denoms: DEFAULT_DENOMS });
  const [counts, setCounts] = useState({}); // { [denom]: qty string }

  useEffect(() => {
    let alive = true;
    settings.getAll()
      .then((r) => {
        if (!alive) return;
        // "1000,500,0.25" or a JSON array — same parsing as the server
        const parsed = String(r.data?.cashDenominations || '')
          .replace(/[\[\]\s]/g, '').split(',').filter(Boolean).map(Number);
        const denoms = parsed.length && parsed.every((d) => d > 0)
          ? [...new Set(parsed)].sort((a, b) => b - a)
          : DEFAULT_DENOMS;
        setCfg({ enabled: r.data?.cashDenominationEnabled === 'true', denoms });
      })
      .catch(() => { /* settings unreachable → feature stays off */ });
    return () => { alive = false; };
  }, []);

  const required = cfg.enabled && PHYSICAL_CASH_ACCOUNTS.includes(String(accountCode));

  const lines = useMemo(
    () => cfg.denoms
      .map((d) => ({ denom: d, qty: Math.floor(Number(counts[d]) || 0) }))
      .filter((l) => l.qty > 0),
    [cfg.denoms, counts],
  );
  const total = lines.reduce((s, l) => s + cents(l.denom) * l.qty, 0) / 100;
  const target = expected ?? amount;
  const diff = Number((total - Number(target || 0)).toFixed(2));

  let error = null;
  if (required) {
    if (lines.length === 0) error = 'Count the cash by denomination first';
    else if (strict && cents(total) !== cents(target)) {
      error = `Denomination total ${formatCurrency(total)} must equal ${formatCurrency(target)}`;
    }
  }

  return {
    required, lines: required ? lines : undefined, total, diff, error,
    counterProps: { denoms: cfg.denoms, counts, setCounts, total, target, diff, strict },
  };
}

export default function DenominationCounter({
  denoms, counts, setCounts, total, target, diff, strict = true, title = 'Cash Count by Denomination',
}) {
  const set = (d, v) => setCounts((p) => ({ ...p, [d]: v.replace(/[^\d]/g, '') }));
  const hasTarget = Number(target) > 0;
  const ok = cents(diff) === 0;

  return (
    <div className="border border-gray-200 rounded-xl p-4 space-y-3">
      <h4 className="text-sm font-semibold text-gray-700">{title}</h4>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
        {denoms.map((d) => {
          const qty = Math.floor(Number(counts[d]) || 0);
          return (
            <div key={d} className="flex items-center gap-2">
              <span className="w-16 text-right text-xs font-medium text-gray-600">
                ₱{d >= 1 ? d.toLocaleString() : d.toFixed(2)}
              </span>
              <span className="text-gray-400 text-xs">×</span>
              <input
                inputMode="numeric"
                className="input w-16 text-right py-1"
                placeholder="0"
                value={counts[d] ?? ''}
                onChange={(e) => set(d, e.target.value)}
                aria-label={`Count of ₱${d}`}
              />
              <span className="text-[11px] text-gray-400 w-20 text-right">
                {qty > 0 ? formatCurrency(cents(d) * qty / 100) : ''}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap justify-between gap-2 border-t border-gray-100 pt-2 text-sm">
        <span className="font-semibold">Counted: {formatCurrency(total)}</span>
        {hasTarget && (
          <span className={ok ? 'text-green-600' : strict ? 'text-red-600' : 'text-amber-600'}>
            {ok
              ? '✓ Matches'
              : `${diff > 0 ? 'Over' : 'Short'} by ${formatCurrency(Math.abs(diff))} (expected ${formatCurrency(target)})`}
          </span>
        )}
      </div>
    </div>
  );
}
