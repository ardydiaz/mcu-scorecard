import axios from 'axios';
import { appConfig } from '../auth/msalConfig';
import { clearToken, getToken } from '../auth/authService';

export const UNAUTHORIZED_EVENT = 'auth:unauthorized';

const api = axios.create({
  baseURL: appConfig.apiUrl,
  headers: { 'Content-Type': 'application/json' },
});

// Attach the app JWT unless the caller set its own header (the Microsoft login call does)
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token && !config.headers.Authorization) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, drop the token and let AuthProvider sign the user out. A deactivated account's
// message is passed along so the login page can show it.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      clearToken();
      const data = error.response.data || {};
      const detail = data.code === 'ACCOUNT_DISABLED' ? data.message : '';
      window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT, { detail }));
    }
    return Promise.reject(error);
  }
);

// Pulls a readable message out of an axios error
export function getErrorMessage(error) {
  return error.response?.data?.message || error.message || 'Something went wrong';
}

export default api;
