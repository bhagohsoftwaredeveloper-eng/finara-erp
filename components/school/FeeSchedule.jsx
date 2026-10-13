'use client';
import { useEffect, useState } from 'react';
import { school as sApi } from '@/lib/api';
import { formatCurrency } from '@/lib/auth';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Fee breakdown for one grade level in one school year, read straight from the
 * fee structure so it matches what the assessment will charge.
 * ONE_TIME lines are due upon enrollment; ANNUAL lines are spread monthly.
 */
export default function FeeSchedule({ schoolYear, gradeLevelId, installments = 10 }) {
  const [structure, setStructure] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setStructure(null);
    if (!schoolYear?.id || !gradeLevelId) return;
    let cancelled = false;
    setLoading(true);
    sApi.feeStructures.list({ schoolYearId: schoolYear.id })
      .then(({ data }) => {
        if (!cancelled) setStructure(data.find((s) => s.gradeLevelId === Number(gradeLevelId)) || null);
      })
      .catch(() => { if (!cancelled) setStructure(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [schoolYear?.id, gradeLevelId]);

  if (!schoolYear?.id || !gradeLevelId) return null;
  if (loading) return <p className="text-sm text-gray-400">Loading fees…</p>;
  if (!structure) {
    return <p className="text-sm text-amber-600">No fee schedule set for this grade level yet (School → Setup → Fee Structures).</p>;
  }

  const oneTime = structure.lines.filter((l) => l.billingBasis === 'ONE_TIME');
  const annual = structure.lines.filter((l) => l.billingBasis === 'ANNUAL');
  const annualTotal = annual.reduce((t, l) => t + Number(l.amount), 0);
  const count = Math.max(1, Number(installments) || 1);
  const first = schoolYear.startDate ? new Date(schoolYear.startDate).getUTCMonth() : null;
  const range = first === null || count === 1 ? ''
    : ` (${MONTH_NAMES[first]} – ${MONTH_NAMES[(first + count - 1) % 12]})`;

  const Row = ({ label, value, bold }) => (
    <div className={`flex justify-between text-sm ${bold ? 'font-semibold' : ''}`}>
      <span className={bold ? '' : 'text-gray-600 dark:text-gray-400'}>{label}</span>
      <span className="tabular-nums">{formatCurrency(value)}</span>
    </div>
  );

  return (
    <div className="rounded-lg border p-4 space-y-1 bg-gray-50 dark:bg-gray-800/50 dark:border-gray-700">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">
        Fee schedule — {structure.gradeLevel?.name}
      </p>
      <Row label="Annual Fees" value={structure.totalAmount} bold />
      {oneTime.map((l) => <Row key={l.id} label={`${l.feeType.name} (upon enrollment)`} value={l.amount} />)}
      {annual.length > 0 && (
        <Row label={`Monthly Fee × ${count}${range}`} value={annualTotal / count} />
      )}
    </div>
  );
}
