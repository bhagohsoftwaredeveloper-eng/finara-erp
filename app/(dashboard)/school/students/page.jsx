'use client';
import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { school as sApi } from '@/lib/api';
import { formatDate } from '@/lib/auth';
import toast from 'react-hot-toast';
import FeeSchedule from '@/components/school/FeeSchedule';
import {
  Plus, Search, Users, ChevronRight, Loader2, X, Trash2, UserPlus,
} from 'lucide-react';

const STATUSES = ['ENROLLED', 'DROPPED', 'TRANSFERRED', 'GRADUATED', 'INACTIVE'];
const STATUS_BADGE = {
  ENROLLED: 'badge-green', DROPPED: 'badge-red', TRANSFERRED: 'badge-yellow',
  GRADUATED: 'badge-blue', INACTIVE: 'badge-yellow',
};

function StudentModal({ student, onClose, onSaved }) {
  const isEdit = !!student?.id;
  const [form, setForm] = useState(student || {
    lastName: '', firstName: '', middleName: '', suffix: '', lrn: '',
    birthDate: '', gender: '', address: '', contactPhone: '', email: '',
    scholarshipType: 'NONE', scholarshipPct: '',
  });
  const [guardians, setGuardians] = useState(
    student?.guardians?.length ? student.guardians : [{ name: '', relationship: 'Mother', phone: '', isPrimaryPayer: true }]
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
              <button type="button" onClick={() => setGuardians((g) => [...g, { name: '', relationship: '', phone: '', isPrimaryPayer: false }])}
                      className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                <UserPlus className="h-3 w-3" /> Add
              </button>
            </div>

            {guardians.map((g, i) => (
              <div key={i} className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
                <div className="md:col-span-4 form-group mb-0">
                  <label className="label">Name</label>
                  <input className="input" value={g.name} onChange={(e) => setGuardian(i, 'name', e.target.value)} />
                </div>
                <div className="md:col-span-3 form-group mb-0">
                  <label className="label">Relationship</label>
                  <input className="input" value={g.relationship || ''} onChange={(e) => setGuardian(i, 'relationship', e.target.value)} />
                </div>
                <div className="md:col-span-3 form-group mb-0">
                  <label className="label">Phone</label>
                  <input className="input" value={g.phone || ''} onChange={(e) => setGuardian(i, 'phone', e.target.value)} />
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
                      <td className="px-4 py-3 text-right">
                        <Link href={`/school/students/${s.id}`} className="text-blue-600 hover:underline inline-flex items-center gap-1 text-xs">
                          Open <ChevronRight className="h-3 w-3" />
                        </Link>
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
    </div>
  );
}
