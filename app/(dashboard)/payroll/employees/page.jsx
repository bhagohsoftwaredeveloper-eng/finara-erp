'use client';
import { useState, useEffect, useCallback } from 'react';
import { payroll as pApi } from '@/lib/api';
import toast from 'react-hot-toast';
import {
  Search, Users, CheckCircle2, Building2, X, Clock,
  Briefcase, Hash, RefreshCw, AlertCircle,
} from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/auth';

// ─── Employee Profile Drawer (read-only) ──────────────────────
function EmployeeDrawer({ employee, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-md bg-white h-full flex flex-col shadow-2xl z-10 overflow-hidden">
        <div className="p-6 bg-gradient-to-br from-blue-700 to-indigo-700 text-white">
          <div className="flex items-start justify-between mb-4">
            <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center text-white font-bold text-xl flex-shrink-0">
              {employee.name?.[0] || '?'}
            </div>
            <button onClick={onClose} className="text-white/70 hover:text-white">
              <X className="w-5 h-5" />
            </button>
          </div>
          <h3 className="text-xl font-bold">{employee.name}</h3>
          <div className="flex gap-2 mt-3 flex-wrap">
            <span className="badge bg-white/15 text-white text-xs font-mono">{employee.employee_number || '—'}</span>
            <span className={`badge text-xs ${employee.is_active ? 'bg-green-400/25 text-green-100' : 'bg-red-400/25 text-red-100'}`}>
              {employee.is_active ? 'Active' : 'Inactive'}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="p-5 space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Directory Details</p>
            {[
              [Briefcase, employee.department, 'Department'],
              [Hash, employee.gender, 'Gender'],
              [Clock, `${employee.shift_start || '—'} – ${employee.shift_end || '—'}`, 'Shift'],
            ].map(([Icon, value, label], i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-4 h-4 text-gray-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-400">{label}</p>
                  <p className="text-sm font-medium text-gray-800">{value || '—'}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="p-5 border-t border-gray-100">
            <p className="text-xs text-gray-400">Daily Rate</p>
            <p className="text-2xl font-bold text-gray-900">{formatCurrency(employee.daily_rate)}</p>
          </div>
        </div>

        <div className="p-4 border-t border-gray-200 text-xs text-gray-400 text-center">
          Sourced from the Beulah employee directory · read-only
        </div>
      </div>
    </div>
  );
}

// ─── Main Employee Directory Page ─────────────────────────────
export default function EmployeeDirectoryPage() {
  const [employees, setEmployees] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [hardError, setHardError] = useState(false);
  const [search, setSearch]       = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState('active');
  const [drawer, setDrawer]       = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setHardError(false);
    pApi.employeeDirectory.list()
      .then((r) => setEmployees(r.data || []))
      .catch(() => { setHardError(true); toast.error('Failed to load employee directory'); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const depts = [...new Set(employees.map((e) => e.department).filter(Boolean))];

  const filtered = employees.filter((e) => {
    if (activeFilter === 'active' && !e.is_active) return false;
    if (activeFilter === 'inactive' && e.is_active) return false;
    if (deptFilter && e.department !== deptFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!e.name?.toLowerCase().includes(q) && !e.employee_number?.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const activeCount = employees.filter((e) => e.is_active).length;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Employee Directory</h1>
          <p className="page-subtitle">
            {filtered.length} employee{filtered.length !== 1 ? 's' : ''} · {activeCount} active · read-only, sourced from Beulah
          </p>
        </div>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          { label: 'Total Employees', value: employees.length, sub: 'in directory', color: 'bg-blue-100 text-blue-600', icon: <Users className="w-5 h-5" /> },
          { label: 'Active', value: activeCount, sub: 'currently active', color: 'bg-green-100 text-green-600', icon: <CheckCircle2 className="w-5 h-5" /> },
          { label: 'Departments', value: depts.length, sub: 'represented', color: 'bg-orange-100 text-orange-600', icon: <Building2 className="w-5 h-5" /> },
        ].map((s) => (
          <div key={s.label} className="card p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${s.color}`}>{s.icon}</div>
            <div>
              <p className="text-xs text-gray-500">{s.label}</p>
              <p className="text-xl font-bold text-gray-900 leading-tight">{s.value}</p>
              <p className="text-xs text-gray-400">{s.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filter bar */}
      <div className="card">
        <div className="card-body py-3 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input className="input pl-9" placeholder="Search name or employee no..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <select className="select w-40" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">All Departments</option>
            {depts.map((d) => <option key={d}>{d}</option>)}
          </select>

          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[['active', 'Active'], ['all', 'All'], ['inactive', 'Inactive']].map(([k, label]) => (
              <button key={k} onClick={() => setActiveFilter(k)}
                className={`px-3 py-2 text-xs font-medium transition-colors ${activeFilter === k ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mr-3" />Loading employee directory...
        </div>
      ) : hardError ? (
        <div className="card p-12 text-center">
          <AlertCircle className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">Couldn't load the employee directory</p>
          <button className="btn-secondary mt-4" onClick={load}>Retry</button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Users className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No employees found</p>
        </div>
      ) : (
        <div className="card">
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Employee</th><th>Department</th><th>Gender</th>
                  <th className="text-right">Daily Rate</th><th>Shift</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((emp) => (
                  <tr key={emp.id} className="cursor-pointer hover:bg-blue-50/30" onClick={() => setDrawer(emp)}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-xs flex-shrink-0">
                          {emp.name?.[0] || '?'}
                        </div>
                        <div>
                          <p className="font-medium text-gray-900 text-sm">{emp.name}</p>
                          <p className="text-xs text-gray-400 font-mono">{emp.employee_number || '—'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="text-gray-500 text-sm">{emp.department || '—'}</td>
                    <td className="text-gray-500 text-sm capitalize">{emp.gender || '—'}</td>
                    <td className="text-right font-semibold text-gray-900">{formatCurrency(emp.daily_rate)}</td>
                    <td className="text-gray-500 text-xs">{emp.shift_start || '—'} – {emp.shift_end || '—'}</td>
                    <td><span className={`badge ${emp.is_active ? 'badge-green' : 'badge-gray'}`}>{emp.is_active ? 'Active' : 'Inactive'}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
            {filtered.length} employee{filtered.length !== 1 ? 's' : ''}
          </div>
        </div>
      )}

      {drawer && <EmployeeDrawer employee={drawer} onClose={() => setDrawer(null)} />}
    </div>
  );
}
