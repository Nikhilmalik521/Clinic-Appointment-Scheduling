// Central fetch wrapper — reads token from localStorage, builds full URL.
// In dev, Vite proxies /api/* to the backend. In production, uses VITE_API_URL.

const API_BASE = import.meta.env.VITE_API_URL || '';

export async function apiFetch(path, options = {}) {
  const token = localStorage.getItem('clinic_token');

  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });

  // For CSV responses (non-JSON)
  if (res.headers.get('content-type')?.includes('text/csv')) {
    if (!res.ok) throw new Error('CSV export failed');
    return res;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || (Array.isArray(data.errors) ? data.errors.join(', ') : '') || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}
