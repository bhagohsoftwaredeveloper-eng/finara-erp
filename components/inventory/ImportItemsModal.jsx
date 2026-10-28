'use client';
import { useState } from 'react';
import { inventory as inventoryApi } from '@/lib/api';
import { readSheetFile, downloadXlsx } from '@/lib/xlsx';
import { todayPH } from '@/lib/arAging';
import toast from 'react-hot-toast';
import { X, Download, FileSpreadsheet, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';

// Bulk upload of inventory items. The browser only reads the file and shows
// what the server says; every rule (columns, parsing, matching) lives in
// server/utils/inventoryImport.js.

const ACTION_BADGE = {
  create:    { label: 'New',       cls: 'badge-blue' },
  update:    { label: 'Update',    cls: 'badge-yellow' },
  unchanged: { label: 'No change', cls: 'badge-gray' },
  error:     { label: 'Error',     cls: 'badge-red' },
};
const MAX_LISTED = 300;

const show = (v) => (v == null || v === '' ? '—' : String(v));
// Errors first, then warnings, updates and new items, each in file order.
const rank = (r) => (r.action === 'error' ? 0 : r.warnings.length ? 1 : r.action === 'update' ? 2 : 3);
const problemText = (err) => (err?.response?.status === 413
  ? 'The file is too large to upload at once. Split it into smaller files.'
  : err?.response?.data?.error || err?.message || 'Something went wrong.');

// Every active item (or the empty template) as an .xlsx download.
export async function downloadItemsFile(template = false) {
  const { data } = await inventoryApi.items.export(template ? { template: 1 } : undefined);
  await downloadXlsx({
    filename: template ? 'inventory-items-template' : `inventory-items-${todayPH()}`,
    sheetName: 'Items',
    columns: data.columns,
    rows: data.rows,
    textKeys: ['sku'],
    moneyKeys: ['costPrice', 'sellingPrice'],
  });
}

export default function ImportItemsModal({ onClose, onImported }) {
  const [fileName, setFileName] = useState('');
  const [grid, setGrid]         = useState(null);
  const [mapping, setMapping]   = useState(null);
  const [check, setCheck]       = useState(null);  // the server's plan for check.mapping
  const [problem, setProblem]   = useState('');
  const [busy, setBusy]         = useState('');    // '' | 'reading' | 'checking' | 'importing' | 'template'

  const runCheck = async (g, m) => {
    setBusy('checking');
    setProblem('');
    if (m) setMapping(m);
    try {
      const { data } = await inventoryApi.items.import({ grid: g, mapping: m, dryRun: true });
      setCheck(data);
      setMapping(data.mapping);
    } catch (err) {
      setProblem(problemText(err));
    } finally { setBusy(''); }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // choosing the same file again re-reads it
    if (!file) return;
    setFileName(file.name);
    setGrid(null); setMapping(null); setCheck(null); setProblem('');
    setBusy('reading');
    let g;
    try {
      g = await readSheetFile(file);
    } catch (err) {
      setProblem(err.message);
      setBusy('');
      return;
    }
    setGrid(g);
    await runCheck(g, null);
  };

  // Choosing a field already used by another column moves it here.
  const remap = (col, key) => {
    const next = mapping.map((k, i) => (i === col ? key || null : key && k === key ? null : k));
    runCheck(grid, next);
  };

  const commit = async () => {
    setBusy('importing');
    setProblem('');
    try {
      const { data } = await inventoryApi.items.import({ grid, mapping, dryRun: false });
      toast.success(`Imported: ${data.created} new, ${data.updated} updated`
        + (data.categoriesCreated ? `, ${data.categoriesCreated} categories added` : ''));
      onImported();
    } catch (err) {
      if (err.response?.status === 422 && err.response.data?.rows) setCheck(err.response.data);
      setProblem(problemText(err));
    } finally { setBusy(''); }
  };

  const template = async () => {
    setBusy('template');
    try { await downloadItemsFile(true); }
    catch (err) { toast.error(problemText(err)); }
    finally { setBusy(''); }
  };

  const s = check?.summary;
  const fresh = !!check && JSON.stringify(check.mapping) === JSON.stringify(mapping);
  const toImport = s ? s.create + s.update : 0;
  const canImport = fresh && !busy && s.errors === 0 && toImport > 0;
  const listed = (check?.rows || [])
    .filter((r) => r.action !== 'unchanged' || r.warnings.length)
    .sort((a, b) => rank(a) - rank(b) || a.row - b.row);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex justify-center items-start overflow-y-auto">
      <div className="bg-white w-full max-w-4xl shadow-2xl flex flex-col" style={{ borderRadius: '0 0 1rem 1rem', maxHeight: '88vh', animation: 'topDrawerIn .28s cubic-bezier(.4,0,.2,1)' }}>
        <div className="flex items-center justify-between px-6 py-4 border-b flex-shrink-0">
          <h2 className="font-bold text-gray-900">Upload Items</h2>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-sm text-gray-600 max-w-xl">
              Choose an Excel (.xlsx) or CSV file with a header row. Rows are matched by Product Code:
              existing items are updated and new codes are added. Blank cells never erase anything,
              and stock quantities are not changed.
            </p>
            <button type="button" onClick={template} disabled={!!busy} className="btn-secondary flex items-center gap-2 whitespace-nowrap">
              <Download className="w-4 h-4" /> Template
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className={`btn-secondary flex items-center gap-2 ${busy ? 'opacity-60 pointer-events-none' : 'cursor-pointer'}`}>
              <FileSpreadsheet className="w-4 h-4" />
              {fileName || 'Choose file'}
              <input type="file" accept=".xlsx,.csv" className="hidden" onChange={onFile} disabled={!!busy} />
            </label>
            {busy && busy !== 'template' && (
              <span className="text-sm text-gray-500 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                {busy === 'reading' ? 'Reading the file…' : busy === 'checking' ? 'Checking…' : 'Importing…'}
              </span>
            )}
          </div>

          {problem && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" /> {problem}
            </div>
          )}

          {check && (
            <>
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Columns</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {check.header.map((h, i) => (h ? (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="w-40 truncate font-mono text-xs text-gray-600" title={h}>{h}</span>
                      <span className="text-gray-300">→</span>
                      <select className="input py-1 text-sm flex-1" value={mapping?.[i] || ''} disabled={!!busy}
                        onChange={(e) => remap(i, e.target.value)}>
                        <option value="">Ignore</option>
                        {check.fields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                    </div>
                  ) : null))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 text-sm">
                <span className="badge badge-blue">{s.create} new</span>
                <span className="badge badge-yellow">{s.update} to update</span>
                <span className="badge badge-gray">{s.unchanged} unchanged</span>
                {s.errors > 0 && <span className="badge badge-red">{s.errors} with errors</span>}
                {s.warnings > 0 && <span className="badge badge-yellow">{s.warnings} with warnings</span>}
              </div>
              {check.newCategories.length > 0 && (
                <p className="text-sm text-gray-600">New categories: {check.newCategories.join(', ')}</p>
              )}

              {listed.length > 0 && (
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-500 uppercase">
                        <th className="px-3 py-2 text-left w-14">Row</th>
                        <th className="px-3 py-2 text-left">Item</th>
                        <th className="px-3 py-2 text-left w-24">Result</th>
                        <th className="px-3 py-2 text-left">Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {listed.slice(0, MAX_LISTED).map((r) => (
                        <tr key={r.row} className="align-top">
                          <td className="px-3 py-2 text-gray-500">{r.row}</td>
                          <td className="px-3 py-2">
                            <div className="font-mono text-xs text-gray-500">{show(r.sku)}</div>
                            <div className="font-medium text-gray-900">{show(r.name)}</div>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`badge ${ACTION_BADGE[r.action].cls}`}>{ACTION_BADGE[r.action].label}</span>
                          </td>
                          <td className="px-3 py-2 space-y-0.5">
                            {r.errors.map((m, i) => <div key={`e${i}`} className="text-red-600">{m}</div>)}
                            {r.warnings.map((m, i) => <div key={`w${i}`} className="text-amber-600">{m}</div>)}
                            {r.changes.map((c, i) => (
                              <div key={`c${i}`} className="text-gray-600">{c.field}: {show(c.from)} → {show(c.to)}</div>
                            ))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {listed.length > MAX_LISTED && (
                    <p className="px-3 py-2 text-xs text-gray-500 border-t">
                      Showing the first {MAX_LISTED} of {listed.length} rows.
                    </p>
                  )}
                </div>
              )}
              {check.ignoredHeaders.length > 0 && (
                <p className="text-xs text-gray-400">Ignored columns: {check.ignoredHeaders.join(', ')}</p>
              )}
            </>
          )}
        </div>

        <div className="flex justify-end items-center gap-2 px-6 py-4 border-t flex-shrink-0">
          {check && s.errors > 0 && (
            <span className="text-sm text-red-600 mr-auto">Fix the errors in the file, then choose it again.</span>
          )}
          <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
          <button type="button" onClick={commit} disabled={!canImport} className="btn-primary flex items-center gap-2">
            {busy === 'importing' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Import {toImport || ''} item{toImport === 1 ? '' : 's'}
          </button>
        </div>
      </div>
    </div>
  );
}
