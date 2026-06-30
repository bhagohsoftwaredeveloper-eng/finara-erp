import axios from 'axios';

// Calls go to the SAME origin ('/api/...') and are proxied to the backend by
// Next.js rewrites (see next.config.js). This eliminates CORS entirely and
// keeps any backend URL out of the browser bundle, so it can never fall back
// to localhost. The backend URL is configured once, server-side, via the
// NEXT_PUBLIC_API_URL env var used in next.config.js.
const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30000,
});

// Attach token + active business on every request
api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('accessToken');
    if (token) config.headers.Authorization = `Bearer ${token}`;

    // Multi-business: read active businessId from localStorage
    // (businessContext.js writes here on every switch)
    const bizId = Number(localStorage.getItem('activeBusinessId'));
    if (bizId) config.headers['x-business-id'] = bizId;
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
        const { data } = await axios.post('/api/auth/refresh', { refreshToken: refresh });
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
  forgotPassword: (data) => api.post('/auth/forgot-password', data),
  resetPassword: (data) => api.post('/auth/reset-password', data),
  listUsers: () => api.get('/auth/users'),
  createUser: (data) => api.post('/auth/users', data),
};

export const audit = {
  list: (params) => api.get('/audit', { params }),
  filters: () => api.get('/audit/filters'),
};

export const search = {
  query: (q) => api.get('/search', { params: { q } }),
};

export const attachments = {
  list: (entity, entityId) => api.get(`/attachments/${entity}/${entityId}`),
  upload: (entity, entityId, file) => {
    const fd = new FormData();
    fd.append('file', file);
    return api.post(`/attachments/${entity}/${entityId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  downloadUrl: (id) => `/api/attachments/${id}/download`,
  remove: (id) => api.delete(`/attachments/${id}`),
};

export const purchaseOrders = {
  list:    (params)   => api.get('/purchase-orders', { params }),
  get:     (id)       => api.get(`/purchase-orders/${id}`),
  create:  (data)     => api.post('/purchase-orders', data),
  update:  (id, data) => api.put(`/purchase-orders/${id}`, data),
  send:    (id)       => api.post(`/purchase-orders/${id}/send`),
  receive: (id, data) => api.post(`/purchase-orders/${id}/receive`, data),
  toBill:  (id, data) => api.post(`/purchase-orders/${id}/convert-to-bill`, data),
  cancel:  (id)       => api.post(`/purchase-orders/${id}/cancel`),
  remove:  (id)       => api.delete(`/purchase-orders/${id}`),
};

export const assets = {
  list:        (params)   => api.get('/assets', { params }),
  get:         (id)       => api.get(`/assets/${id}`),
  create:      (data)     => api.post('/assets', data),
  update:      (id, data) => api.put(`/assets/${id}`, data),
  schedule:    (id)       => api.get(`/assets/${id}/schedule`),
  runDepreciation: (id, data) => api.post(`/assets/${id}/depreciate`, data),
  dispose:     (id, data) => api.post(`/assets/${id}/dispose`, data),
  summary:     ()         => api.get('/assets/summary'),
  remove:      (id)       => api.delete(`/assets/${id}`),
};

export const bank = {
  accounts: {
    list:   ()         => api.get('/bank/accounts'),
    create: (data)     => api.post('/bank/accounts', data),
    update: (id, data) => api.put(`/bank/accounts/${id}`, data),
    remove: (id)       => api.delete(`/bank/accounts/${id}`),
  },
  transactions: {
    list:   (params)   => api.get('/bank/transactions', { params }),
    create: (data)     => api.post('/bank/transactions', data),
    remove: (id)       => api.delete(`/bank/transactions/${id}`),
  },
  reconciliations: {
    list:     (params)   => api.get('/bank/reconciliations', { params }),
    get:      (id)       => api.get(`/bank/reconciliations/${id}`),
    create:   (data)     => api.post('/bank/reconciliations', data),
    toggle:   (id, txnId)=> api.post(`/bank/reconciliations/${id}/toggle/${txnId}`),
    complete: (id)       => api.post(`/bank/reconciliations/${id}/complete`),
  },
};

export const budget = {
  list:     (params)   => api.get('/budget', { params }),
  get:      (id)       => api.get(`/budget/${id}`),
  create:   (data)     => api.post('/budget', data),
  update:   (id, data) => api.put(`/budget/${id}`, data),
  vsActual: (id, params) => api.get(`/budget/${id}/vs-actual`, { params }),
  remove:   (id)       => api.delete(`/budget/${id}`),
};

export const notifications = {
  status:          ()   => api.get('/notifications/status'),
  emailInvoice:    (id) => api.post(`/notifications/invoice/${id}`),
  overdueReminders:()   => api.post('/notifications/overdue-reminders'),
};

export const recurring = {
  list:    (params)   => api.get('/recurring', { params }),
  get:     (id)       => api.get(`/recurring/${id}`),
  create:  (data)     => api.post('/recurring', data),
  update:  (id, data) => api.put(`/recurring/${id}`, data),
  runDue:  ()         => api.post('/recurring/run-due'),
  runNow:  (id)       => api.post(`/recurring/${id}/run`),
  toggle:  (id)       => api.post(`/recurring/${id}/toggle`),
  remove:  (id)       => api.delete(`/recurring/${id}`),
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
  quotations: {
    list:    (params)   => api.get('/quotations', { params }),
    get:     (id)       => api.get(`/quotations/${id}`),
    create:  (data)     => api.post('/quotations', data),
    update:  (id, data) => api.put(`/quotations/${id}`, data),
    remove:  (id)       => api.delete(`/quotations/${id}`),
    send:    (id)       => api.post(`/quotations/${id}/send`),
    accept:  (id)       => api.post(`/quotations/${id}/accept`),
    reject:  (id)       => api.post(`/quotations/${id}/reject`),
    convert: (id, data) => api.post(`/quotations/${id}/convert`, data),
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

export const inventory = {
  // Categories
  categories: {
    list:   ()         => api.get('/inventory/categories'),
    create: (data)     => api.post('/inventory/categories', data),
    update: (id, data) => api.put(`/inventory/categories/${id}`, data),
    remove: (id)       => api.delete(`/inventory/categories/${id}`),
  },
  // Items
  items: {
    list:   (params)   => api.get('/inventory', { params }),
    get:    (id)       => api.get(`/inventory/${id}`),
    create: (data)     => api.post('/inventory', data),
    update: (id, data) => api.put(`/inventory/${id}`, data),
    remove: (id)       => api.delete(`/inventory/${id}`),
  },
  // Transactions
  transactions: {
    list:   (params)   => api.get('/inventory/transactions', { params }),
    create: (data)     => api.post('/inventory/transactions', data),
  },
  // Reports
  reports: {
    stockOnHand:      (params) => api.get('/inventory/reports/stock-on-hand', { params }),
    valuation:        (params) => api.get('/inventory/reports/valuation', { params }),
    lowStock:         ()       => api.get('/inventory/reports/low-stock'),
    movementSummary:  (params) => api.get('/inventory/reports/movement-summary', { params }),
  },
};

export const expenses = {
  categories: ()           => api.get('/expenses/categories'),
  summary:    ()           => api.get('/expenses/summary'),
  list:       (params)     => api.get('/expenses', { params }),
  get:        (id)         => api.get(`/expenses/${id}`),
  create:     (data)       => api.post('/expenses', data),
  update:     (id, data)   => api.put(`/expenses/${id}`, data),
  submit:     (id, data)   => api.post(`/expenses/${id}/submit`, data),
  approve:    (id, data)   => api.post(`/expenses/${id}/approve`, data),
  pay:        (id, data)   => api.post(`/expenses/${id}/pay`, data),
  reject:     (id, data)   => api.post(`/expenses/${id}/reject`, data),
  remove:     (id)         => api.delete(`/expenses/${id}`),
};

export const remittance = {
  summary:    ()           => api.get('/remittance/summary'),
  list:       (params)     => api.get('/remittance', { params }),
  get:        (id)         => api.get(`/remittance/${id}`),
  calculate:  (data)       => api.post('/remittance/calculate', data),
  create:     (data)       => api.post('/remittance', data),
  update:     (id, data)   => api.put(`/remittance/${id}`, data),
  markFiled:  (id, data)   => api.post(`/remittance/${id}/file`, data),
  markPaid:   (id, data)   => api.post(`/remittance/${id}/pay`, data),
  remove:     (id)         => api.delete(`/remittance/${id}`),

  // Daily Remittance
  daily: {
    calculate: (date)      => api.get('/remittance/daily/calculate', { params: { date } }),
    list:      (params)    => api.get('/remittance/daily', { params }),
    get:       (id)        => api.get(`/remittance/daily/${id}`),
    create:    (data)      => api.post('/remittance/daily', data),
    update:    (id, data)  => api.put(`/remittance/daily/${id}`, data),
    submit:    (id, data)  => api.post(`/remittance/daily/${id}/submit`, data),
    approve:   (id, data)  => api.post(`/remittance/daily/${id}/approve`, data),
    remove:    (id)        => api.delete(`/remittance/daily/${id}`),
  },
};

export const businesses = {
  list:        ()           => api.get('/businesses'),
  get:         (id)         => api.get(`/businesses/${id}`),
  create:      (data)       => api.post('/businesses', data),
  update:      (id, data)   => api.put(`/businesses/${id}`, data),
  listUsers:   (id)         => api.get(`/businesses/${id}/users`),
  grantUser:   (id, userId) => api.post(`/businesses/${id}/users`, { userId }),
  revokeUser:  (id, userId) => api.delete(`/businesses/${id}/users/${userId}`),
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
