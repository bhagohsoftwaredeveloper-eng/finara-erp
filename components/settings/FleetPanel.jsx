'use client';
import { useState, useEffect, useCallback } from 'react';
import { fleet as fleetApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { Plus, Edit2, Check, X, ToggleLeft, ToggleRight } from 'lucide-react';

// One list (Drivers or Vehicles): add a record, rename it, switch it on or off.
// Records are never deleted because tagged expenses and journal lines point at them.
function TagList({ title, hint, api, secondKey, secondLabel, secondRequired, codePlaceholder, secondPlaceholder }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [draft, setDraft]     = useState({ code: '', second: '' });
  const [editing, setEditing] = useState(null); // { id, code, second }

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows((await api.list()).data); }
    catch { toast.error(`Failed to load ${title.toLowerCase()}`); }
    finally { setLoading(false); }
  }, [api, title]);
  useEffect(() => { load(); }, [load]);

  const call = async (fn, okMsg) => {
    setSaving(true);
    try { await fn(); toast.success(okMsg); await load(); return true; }
    catch (err) { toast.error(err.response?.data?.error || 'Could not save'); return false; }
    finally { setSaving(false); }
  };

  const add = async (e) => {
    e.preventDefault();
    const ok = await call(() => api.create({ code: draft.code, [secondKey]: draft.second }), 'Added');
    if (ok) setDraft({ code: '', second: '' });
  };
  const saveEdit = async () => {
    const ok = await call(() => api.update(editing.id, { code: editing.code, [secondKey]: editing.second }), 'Updated');
    if (ok) setEditing(null);
  };
  const toggle = (r) => call(() => api.update(r.id, { isActive: !r.isActive }), r.isActive ? 'Deactivated' : 'Activated');

  return (
    <div className="space-y-3">
      <div>
        <h4 className="text-sm font-bold uppercase tracking-wide text-blue-600">{title}</h4>
        <p className="text-xs text-gray-400 mt-0.5">{hint}</p>
      </div>

      <form onSubmit={add} className="flex flex-wrap items-end gap-3 p-4 bg-gray-50 rounded-xl">
        <div className="form-group mb-0">
          <label className="label">Code *</label>
          <input className="input w-40" required maxLength={30} placeholder={codePlaceholder}
            value={draft.code} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))} />
        </div>
        <div className="form-group mb-0 flex-1 min-w-[12rem]">
          <label className="label">{secondLabel}{secondRequired ? ' *' : ''}</label>
          <input className="input" required={secondRequired} maxLength={150} placeholder={secondPlaceholder}
            value={draft.second} onChange={(e) => setDraft((d) => ({ ...d, second: e.target.value }))} />
        </div>
        <button type="submit" disabled={saving} className="btn-primary btn-sm"><Plus className="w-3.5 h-3.5" /> Add</button>
      </form>

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400">None yet.</p>
      ) : (
        <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
              {editing?.id === r.id ? (
                <>
                  <input className="input w-36" maxLength={30} value={editing.code}
                    onChange={(e) => setEditing((x) => ({ ...x, code: e.target.value }))} />
                  <input className="input flex-1 min-w-[10rem]" maxLength={150} value={editing.second}
                    onChange={(e) => setEditing((x) => ({ ...x, second: e.target.value }))} />
                  <button type="button" onClick={saveEdit} disabled={saving} className="text-green-600 p-1" title="Save"><Check className="w-4 h-4" /></button>
                  <button type="button" onClick={() => setEditing(null)} className="text-gray-400 p-1" title="Cancel"><X className="w-4 h-4" /></button>
                </>
              ) : (
                <>
                  <span className={`font-mono text-sm w-36 ${r.isActive ? 'text-gray-800' : 'text-gray-400'}`}>{r.code}</span>
                  <span className={`flex-1 text-sm ${r.isActive ? 'text-gray-600' : 'text-gray-300'}`}>{r[secondKey] || '—'}</span>
                  {!r.isActive && <span className="badge badge-gray">Inactive</span>}
                  <button type="button" onClick={() => setEditing({ id: r.id, code: r.code, second: r[secondKey] || '' })}
                    className="text-gray-400 hover:text-blue-600 p-1" title="Edit"><Edit2 className="w-4 h-4" /></button>
                  <button type="button" onClick={() => toggle(r)} disabled={saving}
                    className={r.isActive ? 'text-green-500' : 'text-gray-300'} title={r.isActive ? 'Deactivate' : 'Activate'}>
                    {r.isActive ? <ToggleRight className="w-7 h-7" /> : <ToggleLeft className="w-7 h-7" />}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function FleetPanel() {
  return (
    <div className="space-y-8">
      <p className="text-xs text-gray-400">
        Tag expense lines (vouchers, bills, journal entries) with a driver and/or a vehicle to see costs such as repairs and maintenance per driver or per vehicle.
        Inactive records stay on past transactions but no longer appear in the pickers.
      </p>
      <TagList title="Drivers" hint="One code per driver, e.g. DRV-001."
        api={fleetApi.drivers} secondKey="name" secondLabel="Name" secondRequired
        codePlaceholder="DRV-001" secondPlaceholder="Full name" />
      <TagList title="Vehicles" hint="The plate or truck number works well as the code."
        api={fleetApi.vehicles} secondKey="description" secondLabel="Description" secondRequired={false}
        codePlaceholder="ABC 123" secondPlaceholder="e.g. Isuzu Elf (optional)" />
    </div>
  );
}
