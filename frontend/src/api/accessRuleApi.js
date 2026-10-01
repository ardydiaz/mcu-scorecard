import api from './axios';

// Access rules that add row access for users or departments (admins; Department Heads for their rows).
// `workbook` is the scorecard file's id; leaving it out uses the default file.

export async function getAccessRules() {
  const { data } = await api.get('/access-rules');
  return data;
}

// rule: { subjectType, userId | departmentCode, workbookId (null = all files), sheet (null = all),
//         matchType, matchValues[], permission, note }
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
export async function getRowIdStatus({ workbook, sheet }) {
  const { data } = await api.get('/access-rules/row-ids', { params: { workbook: workbook || undefined, sheet } });
  return data;
}

// Writes Row IDs into the Excel file (creates the hidden "Row ID" column the first time)
export async function assignRowIds({ workbook, sheet }) {
  const { data } = await api.post('/access-rules/row-ids/assign', { workbook: workbook ? Number(workbook) : undefined, sheet });
  return data;
}

// Rows for the "specific rows" picker: [{ rowId, row, name, type, lead, kra }]
export async function getRuleRows({ workbook, sheet }) {
  const { data } = await api.get('/access-rules/rows', { params: { workbook: workbook || undefined, sheet } });
  return data;
}

// { perspective: [], objective: [], kra: [], lead: [], support: [] }
export async function getRuleOptions({ workbook, sheet }) {
  const { data } = await api.get('/access-rules/options', { params: { workbook: workbook || undefined, sheet } });
  return data;
}
