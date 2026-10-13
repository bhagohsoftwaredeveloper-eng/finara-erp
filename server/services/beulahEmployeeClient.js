// Read-only client for Beulah's Employee Info API (a separate Laravel app).
// Same Sanctum token/host as the Beulah Payroll lock-status API — see
// BEULAH_PAYROLL_BASE_URL / BEULAH_PAYROLL_API_TOKEN.
const TIMEOUT_MS = 5000;

function baseUrl() {
  const url = process.env.BEULAH_PAYROLL_BASE_URL;
  if (!url) throw new Error('BEULAH_PAYROLL_BASE_URL is not configured');
  return url.replace(/\/$/, '');
}

function authHeaders() {
  const token = process.env.BEULAH_PAYROLL_API_TOKEN;
  if (!token) throw new Error('BEULAH_PAYROLL_API_TOKEN is not configured');
  return { Authorization: `Bearer ${token}`, Accept: 'application/json' };
}

async function request(path) {
  const res = await fetch(`${baseUrl()}${path}`, {
    headers: authHeaders(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    const err = new Error(`Beulah Employee API ${path} responded ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const body = await res.json();
  return body.data;
}

function listEmployees() {
  return request('/employees');
}

function getEmployee(id) {
  return request(`/employees/${id}`);
}

module.exports = { listEmployees, getEmployee };
