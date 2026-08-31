import { apiFetch } from './client';

export const authApi = {
  login:    (email, password) => apiFetch('/api/auth/login',    { method: 'POST', body: JSON.stringify({ email, password }) }),
  register: (data)            => apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
  me:       ()                => apiFetch('/api/auth/me'),
};
