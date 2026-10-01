import api from './axios';

// Admin-only: access rules that add row access for users or departments

export async function getAccessRules() {
  const { data } = await api.get('/access-rules');
  return data;
}

// rule: { subjectType, userId | departmentCode, sheet (null = all), matchType, matchValues[], permission, note }
export async function createAccessRule(rule) {
  const { data } = await api.post('/access-rules', rule);
  return data;
}

export async function updateAccessRule(id, rule) {
  const { data } = await api.put(`/access-rules/${id}`, rule);
  return data;
}

export async function deleteAccessRule(id) {
  await api.delete(`/access-rules/${id}`);
}

// { hasColumn, column, dataRows, withId, missing: [rows], duplicates: [{ id, rows }] }
export async function getRowIdStatus(sheet) {
  const { data } = await api.get('/access-rules/row-ids', { params: { sheet } });
  return data;
}

// Writes Row IDs into the Excel file (creates the hidden "Row ID" column the first time)
export async function assignRowIds(sheet) {
  const { data } = await api.post('/access-rules/row-ids/assign', { sheet });
  return data;
}

// Rows for the "specific rows" picker: [{ rowId, row, name, type, lead, kra }]
export async function getRuleRows(sheet) {
  const { data } = await api.get('/access-rules/rows', { params: { sheet } });
  return data;
}

// { perspective: [], objective: [], kra: [], lead: [], support: [] }
export async function getRuleOptions(sheet) {
  const { data } = await api.get('/access-rules/options', { params: { sheet } });
  return data;
}
