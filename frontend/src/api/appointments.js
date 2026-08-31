import { apiFetch } from './client';

const qs = (params) => {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== '') q.append(k, v); });
  const s = q.toString();
  return s ? `?${s}` : '';
};

export const appointmentsApi = {
  list: (params = {}) => apiFetch(`/api/appointments${qs(params)}`),
  get:  (id)           => apiFetch(`/api/appointments/${id}`),
  history: (id)        => apiFetch(`/api/appointments/${id}/history`),

  request:  (id, patientName) => apiFetch(`/api/appointments/${id}/request`,  { method: 'POST', body: JSON.stringify({ patientName }) }),
  confirm:  (id)              => apiFetch(`/api/appointments/${id}/confirm`,   { method: 'POST' }),
  checkin:  (id)              => apiFetch(`/api/appointments/${id}/checkin`,   { method: 'POST' }),
  complete: (id)              => apiFetch(`/api/appointments/${id}/complete`,  { method: 'POST' }),
  noshow:   (id)              => apiFetch(`/api/appointments/${id}/noshow`,    { method: 'POST' }),
  cancel:   (id, reason)      => apiFetch(`/api/appointments/${id}/cancel`,    { method: 'POST', body: JSON.stringify({ reason }) }),

  addCareTeam:    (id, providerId) => apiFetch(`/api/appointments/${id}/care-team`,             { method: 'POST',   body: JSON.stringify({ providerId }) }),
  removeCareTeam: (id, providerId) => apiFetch(`/api/appointments/${id}/care-team/${providerId}`, { method: 'DELETE' }),

  getNotes:  (id)                  => apiFetch(`/api/appointments/${id}/notes`),
  addNote:   (id, noteText)        => apiFetch(`/api/appointments/${id}/notes`,  { method: 'POST', body: JSON.stringify({ noteText }) }),
  editNote:  (id, noteId, noteText) => apiFetch(`/api/appointments/note/${noteId}`, { method: 'PUT', body: JSON.stringify({ noteText }) }),
};
