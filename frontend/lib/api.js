import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

const api = axios.create({
  baseURL: `${API_URL}/api`,
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Attach token on every request
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED' && !original._retry) {
      original._retry = true;
      try {
        const refresh = localStorage.getItem('refreshToken');
        const { data } = await axios.post(`${API_URL}/api/auth/refresh`, { refreshToken: refresh });
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch {
        localStorage.clear();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// ─── API helpers ─────────────────────────────────────────────
export const auth = {
  login: (data) => api.post('/auth/login', data),
  logout: () => api.post('/auth/logout'),
  me: () => api.get('/auth/me'),
  changePassword: (data) => api.put('/auth/change-password', data),
  listUsers: () => api.get('/auth/users'),
  createUser: (data) => api.post('/auth/users', data),
};

export const dashboard = {
  get: () => api.get('/dashboard'),
};

export const accounts = {
  list: (params) => api.get('/accounts', { params }),
  tree: () => api.get('/accounts/tree'),
  get: (id) => api.get(`/accounts/${id}`),
  create: (data) => api.post('/accounts', data),
  update: (id, data) => api.put(`/accounts/${id}`, data),
  remove: (id) => api.delete(`/accounts/${id}`),
};

export const journal = {
  list: (params) => api.get('/journal', { params }),
  get: (id) => api.get(`/journal/${id}`),
  create: (data) => api.post('/journal', data),
  update: (id, data) => api.put(`/journal/${id}`, data),
  post: (id) => api.post(`/journal/${id}/post`),
  void: (id, data) => api.post(`/journal/${id}/void`, data),
  trialBalance: (params) => api.get('/journal/trial-balance', { params }),
  incomeStatement: (params) => api.get('/journal/reports/income-statement', { params }),
  balanceSheet: (params) => api.get('/journal/reports/balance-sheet', { params }),
};

export const payable = {
  vendors: {
    list: (params) => api.get('/payable/vendors', { params }),
    create: (data) => api.post('/payable/vendors', data),
    update: (id, data) => api.put(`/payable/vendors/${id}`, data),
  },
  bills: {
    list: (params) => api.get('/payable', { params }),
    get: (id) => api.get(`/payable/${id}`),
    create: (data) => api.post('/payable', data),
    payment: (id, data) => api.post(`/payable/${id}/payment`, data),
    void: (id) => api.post(`/payable/${id}/void`),
    aging: () => api.get('/payable/aging'),
  },
};

export const receivable = {
  customers: {
    list: (params) => api.get('/receivable/customers', { params }),
    create: (data) => api.post('/receivable/customers', data),
    update: (id, data) => api.put(`/receivable/customers/${id}`, data),
  },
  invoices: {
    list: (params) => api.get('/receivable', { params }),
    get: (id) => api.get(`/receivable/${id}`),
    create: (data) => api.post('/receivable', data),
    payment: (id, data) => api.post(`/receivable/${id}/payment`, data),
    void: (id) => api.post(`/receivable/${id}/void`),
    aging: () => api.get('/receivable/aging'),
  },
};

export const payroll = {
  employees: {
    list: (params) => api.get('/payroll/employees', { params }),
    get: (id) => api.get(`/payroll/employees/${id}`),
    create: (data) => api.post('/payroll/employees', data),
    update: (id, data) => api.put(`/payroll/employees/${id}`, data),
  },
  periods: {
    list: (params) => api.get('/payroll/periods', { params }),
    create: (data) => api.post('/payroll/periods', data),
    update: (id, data) => api.put(`/payroll/periods/${id}`, data),
    compute: (id) => api.post(`/payroll/periods/${id}/compute`),
    approve: (id) => api.post(`/payroll/periods/${id}/approve`),
    items: (id) => api.get(`/payroll/periods/${id}/items`),
  },
  calculator: (params) => api.get('/payroll/calculator', { params }),
  bir2316: (employeeId, year) => api.get(`/payroll/bir2316/${employeeId}/${year}`),
};

export const bir = {
  vatSummary: (params) => api.get('/bir/vat-summary', { params }),
  ewtSummary: (params) => api.get('/bir/ewt-summary', { params }),
  withholdingSummary: (params) => api.get('/bir/withholding-summary', { params }),
  reliefExport: (params) => api.get('/bir/relief', { params }),
  alphalist: (params) => api.get('/bir/alphalist', { params }),
};

export const customReports = {
  list:    ()           => api.get('/custom-reports'),
  get:     (id)         => api.get(`/custom-reports/${id}`),
  run:     (id)         => api.get(`/custom-reports/${id}/run`),
  preview: (data)       => api.post('/custom-reports/preview', data),
  create:  (data)       => api.post('/custom-reports', data),
  update:  (id, data)   => api.put(`/custom-reports/${id}`, data),
  remove:  (id)         => api.delete(`/custom-reports/${id}`),
};

export const settings = {
  getAll:         ()       => api.get('/settings'),
  saveAll:        (data)   => api.post('/settings', data),
  resetDefaults:  ()       => api.post('/settings/reset-defaults'),
  dbStats:        ()       => api.get('/settings/db-stats'),
  backup:         ()       => api.get('/settings/backup', { responseType: 'blob' }),
  dbReset:        (data)   => api.post('/settings/db-reset', data),
  // User management
  listUsers:      ()       => api.get('/settings/users'),
  updateUser:     (id, d)  => api.put(`/settings/users/${id}`, d),
  deleteUser:     (id)     => api.delete(`/settings/users/${id}`),
  resetPassword:  (id, d)  => api.post(`/settings/users/${id}/reset-password`, d),
};

export default api;
