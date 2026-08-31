import { apiFetch } from './client';

export const slotsApi = {
  list:    (params = {}) => {
    const q = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.append(k, v); });
    const s = q.toString();
    return apiFetch(`/api/slots${s ? '?' + s : ''}`);
  },
  get:     (id)  => apiFetch(`/api/slots/${id}`),
  create:  (data) => apiFetch('/api/slots',       { method: 'POST',   body: JSON.stringify(data) }),
  update:  (id, data) => apiFetch(`/api/slots/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  archive: (id)  => apiFetch(`/api/slots/${id}/archive`, { method: 'POST' }),
  restore: (id)  => apiFetch(`/api/slots/${id}/restore`, { method: 'POST' }),
  bulk:    (data) => apiFetch('/api/slots/bulk',  { method: 'POST',   body: JSON.stringify(data) }),
};

export const scheduleApi = {
  exportCsv: (date, providerId) => {
    const q = new URLSearchParams({ date });
    if (providerId) q.append('providerId', providerId);
    return apiFetch(`/api/schedule/export?${q}`);
  },
};
