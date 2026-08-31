import { apiFetch } from './client';

export const alertsApi = {
  list:    ()       => apiFetch('/api/alerts'),
  count:   ()       => apiFetch('/api/alerts/count'),
  dismiss: (slotId) => apiFetch(`/api/alerts/${slotId}/dismiss`, { method: 'POST' }),
};
