import api from './axios';

// Admin-only: the Excel files found in the SharePoint scorecard folder

// [{ id, name, status: draft|published|hidden, isDefault, missing, lastModifiedAt, webUrl }];
// `refresh` checks the folder now instead of using the last check (at most a minute old)
export async function getAdminWorkbooks({ refresh = false } = {}) {
  const { data } = await api.get('/workbooks', { params: { refresh: refresh ? 1 : undefined } });
  return data;
}

export async function setWorkbookStatus(id, status) {
  const { data } = await api.put(`/workbooks/${id}/status`, { status });
  return data;
}

// Writes Row IDs into every scorecard sheet of the file; { rowIds: [{ sheet, assigned, createdColumn, column } | { sheet, error }] }
export async function assignWorkbookRowIds(id) {
  const { data } = await api.post(`/workbooks/${id}/row-ids`, {});
  return data;
}

export async function setDefaultWorkbook(id) {
  const { data } = await api.put(`/workbooks/${id}/default`, {});
  return data;
}
