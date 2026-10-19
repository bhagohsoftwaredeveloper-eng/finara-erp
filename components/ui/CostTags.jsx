'use client';
import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { fleet as fleetApi } from '@/lib/api';
import toast from 'react-hot-toast';

// Driver / Vehicle cost tags for expense lines.
//   const fleet = useFleetTags();                       // loads the active lists once per form
//   <CostTagSelects fleet={fleet} driverId vehicleId onDriver onVehicle />
// Both pickers can create a new record on the spot ("+ New driver…").

const NEW = '__new__';
const KINDS = {
  driver:  { word: 'Driver',  second: 'Name',        secondKey: 'name',        secondRequired: true },
  vehicle: { word: 'Vehicle', second: 'Description', secondKey: 'description', secondRequired: false },
};
const optionLabel = (kind, r) => (kind === 'driver'
  ? `${r.code} · ${r.name}`
  : `${r.code}${r.description ? ` · ${r.description}` : ''}`);

export function useFleetTags() {
  const [drivers, setDrivers]   = useState([]);
  const [vehicles, setVehicles] = useState([]);

  const load = useCallback(() => {
    fleetApi.drivers.list({ active: 'true' }).then((r) => setDrivers(r.data)).catch(() => {});   // pickers stay empty
    fleetApi.vehicles.list({ active: 'true' }).then((r) => setVehicles(r.data)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async (kind, payload) => {
    const { data } = await (kind === 'driver' ? fleetApi.drivers.create(payload) : fleetApi.vehicles.create(payload));
    (kind === 'driver' ? setDrivers : setVehicles)((prev) => [...prev, data].sort((a, b) => a.code.localeCompare(b.code)));
    return data;
  };

  return { drivers, vehicles, add, reload: load };
}

function QuickAdd({ kind, fleet, onCreated, onClose }) {
  const cfg = KINDS[kind];
  const [code, setCode]     = useState('');
  const [second, setSecond] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!code.trim()) { toast.error('Enter a code'); return; }
    if (cfg.secondRequired && !second.trim()) { toast.error(`Enter the ${cfg.second.toLowerCase()}`); return; }
    setSaving(true);
    try {
      const row = await fleet.add(kind, { code, [cfg.secondKey]: second });
      toast.success(`${cfg.word} ${row.code} added`);
      onCreated(row);
    } catch (err) {
      toast.error(err.response?.data?.error || `Failed to add ${cfg.word.toLowerCase()}`);
      setSaving(false);
    }
  };
  const onEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } };

  // Portalled so it never nests a <form> inside the voucher/bill form it was opened from.
  return createPortal(
    <div className="fixed inset-0 z-[70] bg-black/40 flex items-start justify-center pt-24" onMouseDown={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-3" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="text-base font-semibold text-gray-900">New {cfg.word.toLowerCase()}</h3>
        <div className="form-group">
          <label className="label">Code *</label>
          <input className="input" autoFocus maxLength={30} value={code} onChange={(e) => setCode(e.target.value)} onKeyDown={onEnter}
            placeholder={kind === 'driver' ? 'e.g. DRV-001' : 'e.g. ABC 123'} />
        </div>
        <div className="form-group">
          <label className="label">{cfg.second}{cfg.secondRequired ? ' *' : ''}</label>
          <input className="input" maxLength={kind === 'driver' ? 100 : 150} value={second} onChange={(e) => setSecond(e.target.value)} onKeyDown={onEnter}
            placeholder={kind === 'driver' ? 'Full name' : 'e.g. Isuzu Elf (optional)'} />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary btn-sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Add'}</button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function TagSelect({ kind, value, onChange, fleet, disabled, className = 'select text-sm' }) {
  const rows = kind === 'driver' ? fleet.drivers : fleet.vehicles;
  const [adding, setAdding] = useState(false);
  const word = KINDS[kind].word;

  return (
    <>
      <select className={className} disabled={disabled} value={value || ''}
        onChange={(e) => (e.target.value === NEW ? setAdding(true) : onChange(e.target.value ? Number(e.target.value) : null))}>
        <option value="">— {word} (opt.) —</option>
        {rows.map((r) => <option key={r.id} value={r.id}>{optionLabel(kind, r)}</option>)}
        {value && !rows.some((r) => r.id === Number(value)) && <option value={value}>{word} #{value} (inactive)</option>}
        {!disabled && <option value={NEW}>+ New {word.toLowerCase()}…</option>}
      </select>
      {adding && (
        <QuickAdd kind={kind} fleet={fleet} onClose={() => setAdding(false)}
          onCreated={(row) => { setAdding(false); onChange(row.id); }} />
      )}
    </>
  );
}

export default function CostTagSelects({ fleet, driverId, vehicleId, onDriver, onVehicle, disabled }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-gray-400">Tag</span>
      <div className="w-52"><TagSelect kind="driver" fleet={fleet} value={driverId} onChange={onDriver} disabled={disabled} /></div>
      <div className="w-52"><TagSelect kind="vehicle" fleet={fleet} value={vehicleId} onChange={onVehicle} disabled={disabled} /></div>
    </div>
  );
}
