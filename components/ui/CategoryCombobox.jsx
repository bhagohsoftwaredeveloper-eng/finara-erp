'use client';
/**
 * CategoryCombobox — type to search a list, or quick-add a new entry.
 *
 * Props:
 *   value     – selected option `value` ('' when none)
 *   onChange  – fn(value)
 *   options   – [{ value, label, sub? }]
 *   onCreate  – async fn(label) → { value, label, sub? }; enables "+ Add" when
 *               the typed text matches no existing option
 *   placeholder, disabled, className
 */
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Plus, Search, Loader2 } from 'lucide-react';
import DropdownPanel from './DropdownPanel';

export default function CategoryCombobox({
  value, onChange, options = [], onCreate,
  placeholder = '— Select category —', disabled = false, className = '',
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const panelRef = useRef(null);

  const selected = options.find((o) => o.value === value);
  // A value not in the list (e.g. a voucher saved before the category was
  // removed) still shows as itself rather than going blank.
  const display = selected?.label || value || '';

  const q = search.trim().toLowerCase();
  const filtered = q
    ? options.filter((o) => o.label.toLowerCase().includes(q) || o.sub?.toLowerCase().includes(q))
    : options;
  const exact = q && options.some((o) => o.label.toLowerCase() === q);
  const canCreate = !!onCreate && q.length >= 2 && !exact;

  const close = () => { setOpen(false); setSearch(''); };

  useEffect(() => {
    const handler = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target) && !panelRef.current?.contains(e.target)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const openPanel = () => {
    if (disabled) return;
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const pick = (v) => { onChange(v); close(); };

  const create = async () => {
    if (!canCreate || busy) return;
    setBusy(true);
    try {
      const made = await onCreate(search.trim());
      if (made?.value) pick(made.value);
    } finally { setBusy(false); }
  };

  const onKeyDown = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'Enter' && open) {
      e.preventDefault(); // never submit the surrounding form from the search box
      if (filtered.length === 1) pick(filtered[0].value);
      else if (!filtered.length && canCreate) create();
    }
  };

  return (
    <div ref={wrapRef} className={`relative ${className}`} onKeyDown={onKeyDown}>
      <button
        type="button" onClick={openPanel} disabled={disabled}
        className={`input w-full flex items-center justify-between text-left gap-2 ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
      >
        <span className={`truncate text-sm ${display ? 'text-gray-900' : 'text-gray-400'}`}>
          {display || placeholder}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <DropdownPanel
          anchorRef={wrapRef} panelRef={panelRef} minHeight={240} maxHeight={320} minWidth={240}
          className="bg-white border border-gray-200 rounded-xl shadow-xl"
        >
          <div className="p-2 border-b border-gray-100 sticky top-0 bg-white">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
              <input
                ref={inputRef} type="text"
                className="w-full pl-8 pr-2 py-1.5 text-xs border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                placeholder={onCreate ? 'Type to search or add new…' : 'Type to search…'}
                value={search} onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          {canCreate && (
            <button
              type="button" onClick={create} disabled={busy}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-blue-700 bg-blue-50 hover:bg-blue-100 border-b border-blue-100 disabled:opacity-60"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              <span>Add <strong>“{search.trim()}”</strong> as new category</span>
            </button>
          )}

          {filtered.length === 0 && !canCreate && (
            <div className="px-3 py-4 text-xs text-gray-400 text-center">No matching category</div>
          )}

          {filtered.map((o) => (
            <button
              key={o.value} type="button" onClick={() => pick(o.value)}
              className={`w-full px-3 py-2 text-left hover:bg-gray-50 ${o.value === value ? 'bg-blue-50' : ''}`}
            >
              <div className="text-sm text-gray-900">{o.label}</div>
              {o.sub && <div className="text-[11px] text-gray-400 leading-tight">{o.sub}</div>}
            </button>
          ))}
        </DropdownPanel>
      )}
    </div>
  );
}
