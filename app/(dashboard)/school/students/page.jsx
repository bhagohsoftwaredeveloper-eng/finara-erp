'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { school as sApi } from '@/lib/api';
import { formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import FeeSchedule from '@/components/school/FeeSchedule';
import {
  Plus, Search, Users, ChevronRight, Loader2, X, Trash2, UserPlus,
  Eye, Pencil, PauseCircle, PlayCircle,
} from 'lucide-react';

const STATUSES = ['APPLICANT', 'ADMITTED', 'ENROLLED', 'ACTIVE', 'SUSPENDED', 'COMPLETED', 'GRADUATED', 'TRANSFERRED', 'WITHDRAWN', 'INACTIVE'];
const STATUS_BADGE = {
  ENROLLED: 'badge-green', ACTIVE: 'badge-green', WITHDRAWN: 'badge-red', SUSPENDED: 'badge-red',
  TRANSFERRED: 'badge-yellow', GRADUATED: 'badge-blue', COMPLETED: 'badge-blue', INACTIVE: 'badge-yellow',
};

// Slides down from the top: a quick read of one student without leaving the list.
function StudentDrawer({ studentId, onClose }) {
  const [s, setS] = useState(null);
  useEffect(() => {
    sApi.students.get(studentId).then((r) => setS(r.data))
      .catch((err) => { toast.error(err.response?.data?.error || 'Could not load the student'); onClose(); });
  }, [studentId, onClose]);

  const field = (label, value) => (
    <div>
      <p className="text-xs uppercase tracking-wide text-gray-500">{label}</p>
      <p className="text-sm">{value || <span className="text-gray-400">—</span>}</p>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="absolute inset-x-0 top-0 max-h-[85vh] overflow-y-auto bg-white dark:bg-gray-900 shadow-2xl border-b dark:border-gray-700">
        <div className="max-w-5xl mx-auto px-5 py-4">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="text-lg font-semibold">{s ? s.fullName : 'Loading…'}</h3>
              {s && (
                <p className="text-xs text-gray-500">
                  <span className="font-mono">{s.studentNo}</span>
                  <span className={`badge ml-2 ${STATUS_BADGE[s.status] || 'badge-blue'}`}>{s.status}</span>
                </p>
              )}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700" title="Close"><X className="h-5 w-5" /></button>
          </div>

          {!s ? <div className="py-10 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" /></div> : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
                {field('LRN', s.lrn)}
                {field('Birth date', s.birthDate && formatDate(s.birthDate))}
                {field('Gender', s.gender)}
                {field('Scholarship', s.scholarshipType === 'PARTIAL'
                  ? `Partial ${Number(s.scholarshipPct)}%` : s.scholarshipType === 'FULL' ? 'Full' : 'None')}
                {field('Contact', s.contactPhone)}
                {field('Email', s.email)}
                <div className="col-span-2">{field('Address', s.address)}</div>
              </div>

              <h4 className="text-sm font-semibold mb-2">Guardians</h4>
              {s.guardians?.length ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-5">
                  {s.guardians.map((g) => (
                    <div key={g.id} className="border dark:border-gray-700 rounded-lg px-3 py-2 text-sm">
                      <span className="font-medium">{g.name}</span>
                      {g.relationship && <span className="text-gray-500"> · {g.relationship}</span>}
                      {g.isPrimaryPayer && <span className="badge badge-blue ml-2">Primary payer</span>}
                      <p className="text-xs text-gray-500">{[g.phone, g.email].filter(Boolean).join(' · ') || '—'}</p>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400 mb-5">None on file.</p>}

              <h4 className="text-sm font-semibold mb-2">Enrollment</h4>
              {s.enrollments?.length ? (
                <table className="w-full text-sm mb-4">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                      <th className="py-2">School year</th><th>Grade / Section</th><th>Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y dark:divide-gray-700">
                    {s.enrollments.map((e) => (
                      <tr key={e.id}>
                        <td className="py-2">{e.schoolYear?.code}</td>
                        <td>{e.gradeLevel?.name}{e.section ? ` — ${e.section.name}` : ''}</td>
                        <td>{e.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="text-sm text-gray-400 mb-4">Not enrolled.</p>}

              <Link href={`/school/students/${s.id}`} className="text-blue-600 hover:underline text-sm inline-flex items-center gap-1">
                Open full record and ledger <ChevronRight className="h-3 w-3" />
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// One modal for the two destructive actions, so neither fires on a stray click.
function ConfirmModal({ title, body, confirmLabel, danger, askReason, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); try { await onConfirm(reason); } finally { setBusy(false); } };
  return (
    <div className="modal-overlay">
      <div className="modal max-w-md">
        <div className="modal-header"><h3 className="text-lg font-semibold">{title}</h3></div>
        <div className="modal-body space-y-3 text-sm">
          <p>{body}</p>
          {askReason && (
            <input className="input" placeholder="Reason (optional)" value={reason}
                   onChange={(e) => setReason(e.target.value)} />
          )}
        </div>
        <div className="modal-footer">
          <button onClick={onCancel} className="btn-secondary">Cancel</button>
          <button onClick={go} disabled={busy} className={danger ? 'btn-danger' : 'btn-primary'}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function StudentModal({ student, onClose, onSaved }) {
  const isEdit = !!student?.id;
  const [form, setForm] = useState(student || {
    lastName: '', firstName: '', middleName: '', suffix: '', lrn: '',
    birthDate: '', gender: '', address: '', contactPhone: '', email: '',
    scholarshipType: 'NONE', scholarshipPct: '',
  });
  const [guardians, setGuardians] = useState(
    student?.guardians?.length ? student.guardians : [{ name: '', relationship: 'Mother', phone: '', email: '', isPrimaryPayer: true }]
  );
  const [saving, setSaving] = useState(false);
  // Fee preview for new registrations only — nothing here is saved on the student.
  const [feeYear, setFeeYear] = useState(null);
  const [feeLevels, setFeeLevels] = useState([]);
  const [feeLevelId, setFeeLevelId] = useState('');
  useEffect(() => {
    if (isEdit) return;
    Promise.all([sApi.schoolYears.list(), sApi.gradeLevels.list()])
      .then(([y, l]) => {
        setFeeYear(y.data.find((x) => x.isCurrent) || null);
        setFeeLevels(l.data.filter((x) => x.isActive));
      })
      .catch(() => {});
  }, [isEdit]);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const setGuardian = (i, k, v) =>
    setGuardians((g) => g.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  const makePrimary = (i) =>
    setGuardians((g) => g.map((x, j) => ({ ...x, isPrimaryPayer: j === i })));

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        lrn: form.lrn || undefined,
        birthDate: form.birthDate || undefined,
        scholarshipType: form.scholarshipType || 'NONE',
        scholarshipPct: form.scholarshipType === 'PARTIAL' ? Number(form.scholarshipPct) : undefined,
        guardians: guardians.filter((g) => g.name.trim()),
      };
      if (isEdit) {
        await sApi.students.update(student.id, payload);
        await sApi.students.guardians(student.id, { guardians: payload.guardians });
      } else {
        await sApi.students.create(payload);
      }
      toast.success(isEdit ? 'Student updated' : 'Student registered');
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save this student');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal max-w-2xl">
        <div className="modal-header">
          <h3 className="text-lg font-semibold">{isEdit ? 'Edit Student' : 'Register Student'}</h3>
          <button onClick={onClose} className="text-gray-400 text-2xl leading-none">&times;</button>
        </div>
        <form onSubmit={submit}>
          <div className="modal-body space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="label">Last Name *</label>
                <input className="input" required value={form.lastName} onChange={set('lastName')} />
              </div>
              <div className="form-group">
                <label className="label">First Name *</label>
                <input className="input" required value={form.firstName} onChange={set('firstName')} />
              </div>
              <div className="form-group">
                <label className="label">Middle Name</label>
                <input className="input" value={form.middleName || ''} onChange={set('middleName')} />
              </div>
              <div className="form-group">
                <label className="label">Suffix</label>
                <input className="input" value={form.suffix || ''} onChange={set('suffix')} placeholder="Jr., III" />
              </div>
              <div className="form-group">
                <label className="label">LRN</label>
                <input
                  className="input font-mono" value={form.lrn || ''} onChange={set('lrn')}
                  placeholder="12 digits" maxLength={12} pattern="\d{12}"
                  title="DepEd Learner Reference Number — exactly 12 digits"
                />
              </div>
              <div className="form-group">
                <label className="label">Birth Date</label>
                <input className="input" type="date"
                       value={form.birthDate ? String(form.birthDate).slice(0, 10) : ''}
                       onChange={set('birthDate')} />
              </div>
              <div className="form-group">
                <label className="label">Gender</label>
                <select className="input" value={form.gender || ''} onChange={set('gender')}>
                  <option value="">—</option>
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                </select>
              </div>
              <div className="form-group">
                <label className="label">Contact Number</label>
                <input className="input" value={form.contactPhone || ''} onChange={set('contactPhone')} />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="form-group">
                <label className="label">Student Type</label>
                <select className="input" value={form.scholarshipType || 'NONE'} onChange={set('scholarshipType')}>
                  <option value="NONE">Regular (paying)</option>
                  <option value="FULL">Full Scholar</option>
                  <option value="PARTIAL">Partial Scholar</option>
                </select>
              </div>
              {form.scholarshipType === 'PARTIAL' && (
                <div className="form-group">
                  <label className="label">Tuition discount (%) *</label>
                  <input className="input" type="number" min="1" max="99" step="0.01" required
                         value={form.scholarshipPct ?? ''} onChange={set('scholarshipPct')} placeholder="e.g. 50" />
                </div>
              )}
            </div>
            {form.scholarshipType && form.scholarshipType !== 'NONE' && (
              <p className="text-xs text-gray-500 -mt-2">
                Applied to tuition when this student is enrolled; registration and miscellaneous fees are still charged.
              </p>
            )}

            <div className="form-group">
              <label className="label">Address</label>
              <textarea className="input resize-none" rows={2} value={form.address || ''} onChange={set('address')} />
            </div>

            <hr className="border-gray-100 dark:border-gray-800" />
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Parents / Guardians</p>
              <button type="button" onClick={() => setGuardians((g) => [...g, { name: '', relationship: '', phone: '', email: '', isPrimaryPayer: false }])}
                      className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <UserPlus className="h-3 w-3" /> Add
              </button>
            </div>

            {guardians.map((g, i) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                <div className="md:col-span-3 form-group mb-0">
                  <label className="label">Name</label>
                  <input className="input" value={g.name} onChange={(e) => setGuardian(i, 'name', e.target.value)} />
                </div>
                <div className="md:col-span-2 form-group mb-0">
                  <label className="label">Relationship</label>
                  <input className="input" value={g.relationship || ''} onChange={(e) => setGuardian(i, 'relationship', e.target.value)} />
                </div>
                <div className="md:col-span-2 form-group mb-0">
                  <label className="label">Phone</label>
                  <input className="input" value={g.phone || ''} onChange={(e) => setGuardian(i, 'phone', e.target.value)} />
                </div>
                <div className="md:col-span-3 form-group mb-0">
                  <label className="label">Email</label>
                  <input className="input" type="email" placeholder="name@email.com" value={g.email || ''}
                         onChange={(e) => setGuardian(i, 'email', e.target.value)} />
                </div>
                <div className="md:col-span-2 flex items-center gap-2 pb-2">
                  <label className="flex items-center gap-1.5 text-xs cursor-pointer">
                    <input type="radio" name="payer" checked={!!g.isPrimaryPayer} onChange={() => makePrimary(i)} />
                    Payer
                  </label>
                  {guardians.length > 1 && (
                    <button type="button" onClick={() => setGuardians((x) => x.filter((_, j) => j !== i))}
                            className="text-gray-400 hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
          {!isEdit && feeYear && (
            <div className="modal-body pt-0 space-y-3">
              <div className="form-group max-w-xs">
                <label className="label">Grade level applying for (fee preview)</label>
                <select className="input" value={feeLevelId} onChange={(e) => setFeeLevelId(e.target.value)}>
                  <option value="">Select…</option>
                  {feeLevels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
              <FeeSchedule schoolYear={feeYear} gradeLevelId={feeLevelId} />
            </div>
          )}
          <div className="modal-footer">
            <button type="button" onClick={onClose} className="btn-secondary">Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? 'Saving…' : isEdit ? 'Save changes' : 'Register student'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function StudentsPage() {
  const [data, setData] = useState({ items: [], total: 0, pages: 1 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [viewId, setViewId] = useState(null);
  const [confirm, setConfirm] = useState(null); // { kind: 'suspend' | 'delete', student }
  const closeDrawer = useCallback(() => setViewId(null), []);

  // The list row has no guardians, and the edit form saves them back, so fetch
  // the full record first — otherwise saving would wipe the guardians.
  const openEdit = async (s) => {
    try {
      const { data: full } = await sApi.students.get(s.id);
      setModal(full);
    } catch (err) { toast.error(err.response?.data?.error || 'Could not load the student'); }
  };

  const reinstate = async (s) => {
    try { await sApi.students.reinstate(s.id); toast.success(`${s.fullName} reinstated`); load(); }
    catch (err) { toast.error(err.response?.data?.error || 'Could not reinstate'); }
  };

  const runConfirm = async (reason) => {
    const { kind, student } = confirm;
    try {
      if (kind === 'suspend') { await sApi.students.suspend(student.id, { reason }); toast.success(`${student.fullName} suspended`); }
      else { await sApi.students.remove(student.id); toast.success(`${student.fullName} deleted`); }
      setConfirm(null); load();
    } catch (err) { toast.error(err.response?.data?.error || 'That did not work'); setConfirm(null); }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await sApi.students.list({
        search: search || undefined,
        status: status || undefined,
        page, limit: 25,
      });
      setData(data);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not load students');
    } finally {
      setLoading(false);
    }
  }, [search, status, page]);

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Students</h1>
          <p className="page-subtitle">{data.total} on file</p>
        </div>
        <button onClick={() => setModal({})} className="btn-primary flex items-center gap-2">
          <Plus className="h-4 w-4" /> Register student
        </button>
      </div>

      {data.summary && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {[
            ['Total Students', data.summary.total, 'text-gray-900 dark:text-gray-100'],
            ['Regular', data.summary.regular, 'text-blue-600'],
            ['Full Scholars', data.summary.fullScholar, 'text-green-600'],
            ['Partial Scholars', data.summary.partialScholar, 'text-amber-600'],
          ].map(([label, value, color]) => (
            <div key={label} className="card">
              <div className="card-body py-4">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</p>
                <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card mb-4">
        <div className="card-body flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
            <input className="input pl-9" placeholder="Name, student number, or LRN…"
                   value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <select className="input w-auto" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">All statuses</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div className="card">
        <div className="card-body p-0">
          {loading ? (
            <div className="text-center py-12 text-gray-500">
              <Loader2 className="h-6 w-6 animate-spin mx-auto" />
            </div>
          ) : data.items.length === 0 ? (
            <div className="text-center py-16 text-gray-500">
              <Users className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p className="font-medium">No students found</p>
              <p className="text-sm">Register one, or import a roster from Setup.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b dark:border-gray-700">
                    <th className="px-4 py-3">Student No.</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">LRN</th>
                    <th className="px-4 py-3">Grade / Section</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  {data.items.map((s) => (
                    <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="px-4 py-3 font-mono text-xs">{s.studentNo}</td>
                      <td className="px-4 py-3 font-medium">
                        {s.fullName}
                        {s.scholarshipType === 'FULL' && <span className="badge badge-green ml-2">Full Scholar</span>}
                        {s.scholarshipType === 'PARTIAL' && <span className="badge badge-yellow ml-2">Partial {Number(s.scholarshipPct)}%</span>}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{s.lrn || '—'}</td>
                      <td className="px-4 py-3">
                        {s.currentEnrollment
                          ? `${s.currentEnrollment.gradeLevel.name}${s.currentEnrollment.section ? ` — ${s.currentEnrollment.section.name}` : ''}`
                          : <span className="text-gray-400">Not enrolled</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`badge ${STATUS_BADGE[s.status] || 'badge-blue'}`}>{s.status}</span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button onClick={() => setViewId(s.id)} title="View"
                                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600">
                            <Eye className="h-4 w-4" />
                          </button>
                          <button onClick={() => openEdit(s)} title="Edit"
                                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-blue-600">
                            <Pencil className="h-4 w-4" />
                          </button>
                          {s.status === 'SUSPENDED' ? (
                            <button onClick={() => reinstate(s)} title="Reinstate"
                                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-green-600">
                              <PlayCircle className="h-4 w-4" />
                            </button>
                          ) : (
                            <button onClick={() => setConfirm({ kind: 'suspend', student: s })} title="Suspend"
                                    className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-amber-600">
                              <PauseCircle className="h-4 w-4" />
                            </button>
                          )}
                          <button onClick={() => setConfirm({ kind: 'delete', student: s })} title="Delete"
                                  className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-red-600">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {data.pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <span className="text-gray-500">Page {page} of {data.pages}</span>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
            <button className="btn-secondary" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)}>Next</button>
          </div>
        </div>
      )}

      {modal && <StudentModal student={modal.id ? modal : null} onClose={() => setModal(null)}
                              onSaved={() => { setModal(null); load(); }} />}
      {viewId && <StudentDrawer studentId={viewId} onClose={closeDrawer} />}
      {confirm && (
        <ConfirmModal
          title={confirm.kind === 'suspend' ? 'Suspend student' : 'Delete student'}
          body={confirm.kind === 'suspend'
            ? `Suspend ${confirm.student.fullName}? Their record and balances stay; you can reinstate them any time.`
            : `Delete ${confirm.student.fullName} (${confirm.student.studentNo})? This only works for students with no enrollment or billing history, and cannot be undone.`}
          confirmLabel={confirm.kind === 'suspend' ? 'Suspend' : 'Delete'}
          danger={confirm.kind === 'delete'}
          askReason={confirm.kind === 'suspend'}
          onCancel={() => setConfirm(null)}
          onConfirm={runConfirm}
        />
      )}
    </div>
  );
}
