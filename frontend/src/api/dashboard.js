import { apiFetch } from './client';

export const dashboardApi = {
  metrics:    () => apiFetch('/api/dashboard'),
  noShowRate: () => apiFetch('/api/dashboard/no-show-rate'),
};
