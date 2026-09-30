import api from './axios';

/**
 * Reports a user action the server can't see by itself: 'page.view' or 'excel.open'.
 * Fire-and-forget: never throws and never blocks the page.
 */
export function logActivity(action, target, details) {
  api.post('/audit-logs/activity', { action, target, details }).catch(() => {});
}

const params = ({ q, action, userId, from, to } = {}) => ({
  q: q || undefined,
  action: action || undefined,
  userId: userId || undefined,
  from: from || undefined,
  to: to || undefined,
});

// Admin-only. Returns { data, total, page, limit, actions: { key: label } }, newest first
export async function getAuditLogs({ page = 1, limit = 50, ...filters } = {}) {
  const { data } = await api.get('/audit-logs', { params: { page, limit, ...params(filters) } });
  return data;
}

// Downloads the filtered log as a CSV file
export async function downloadAuditCsv(filters = {}) {
  const response = await api.get('/audit-logs/export', { params: params(filters), responseType: 'blob' });
  const name = /filename="([^"]+)"/.exec(response.headers['content-disposition'] || '')?.[1] || 'audit-log.csv';
  const url = URL.createObjectURL(response.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
