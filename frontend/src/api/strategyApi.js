import api from './axios';

// Every call takes `workbook`: the scorecard file's id (from getWorkbooks). Leaving it out uses
// the default file.

// Scorecard files the user may open: [{ id, name, status, isDefault, lastModifiedAt }]
export async function getWorkbooks() {
  const { data } = await api.get('/strategy/workbooks');
  return data;
}

// Visible sheets in workbook order: scorecard sheets only, or every sheet with `all`
export async function getSheets({ workbook, all = false } = {}) {
  const { data } = await api.get('/strategy/sheets', { params: { workbook: workbook || undefined, all: all ? 1 : undefined } });
  return data;
}

// { id, name, docUrl } used to open or embed the workbook in Excel for the web
export async function getWorkbook({ workbook } = {}) {
  const { data } = await api.get('/strategy/workbook', { params: { workbook: workbook || undefined } });
  return data;
}

// The sheet as a spreadsheet grid, filtered on Lead by the user's department (admins may pick one)
export async function getSheetGrid({ workbook, sheet, department, refresh } = {}) {
  const { data } = await api.get('/strategy/grid', {
    params: { workbook: workbook || undefined, sheet, department: department || undefined, refresh: refresh ? 1 : undefined },
  });
  return data;
}

// Saves one cell to the Excel file. `previous` and `identity` let the server detect changes
// made in Excel since the grid was loaded. Returns { text, identity } as Excel now shows it.
export async function updateGridCell({ workbook, sheet, row, column, value, previous, identity }) {
  const { data } = await api.patch('/strategy/grid/cell', { workbook, sheet, row, column, value, previous, identity });
  return data;
}

// Changes one cell's formatting in the Excel file (e.g. { bold: true } or { fillColor: '#FFFF00' }).
// Returns { style } as the cell now looks.
export async function formatGridCell({ workbook, sheet, row, column, identity, format }) {
  const { data } = await api.patch('/strategy/grid/format', { workbook, sheet, row, column, identity, format });
  return data;
}

// Merges (merge: true) or unmerges a range, e.g. R130:T130 or A129:A131 (row..endRow). `identities`
// has one row identity per row, top to bottom. Without `confirm`, a merge that would delete values
// fails with code CONFIRM_MERGE and the list of values (`lost`).
export async function mergeGridCells({ workbook, sheet, row, endRow, startColumn, endColumn, identities, merge, center, confirm }) {
  const { data } = await api.post('/strategy/grid/merge', {
    workbook, sheet, row, endRow, startColumn, endColumn, identities, merge, center, confirm,
  });
  return data;
}

// Pastes values into the Excel file: targets = [{ row, identity, cells: [{ column, value, previous }] }].
// All or nothing; returns { cells: [{ row, column, text }], identities: { [row]: identity } }
export async function pasteGridCells({ workbook, sheet, targets }) {
  const { data } = await api.post('/strategy/grid/paste', { workbook, sheet, targets });
  return data;
}

// Column changes in the Excel file: action 'insert' (column + side + header), 'update' (today's
// update column) or 'delete' (admins). `expectedHeader` makes the server refuse when the column moved.
// A delete of a column with values fails with code CONFIRM_DELETE until `confirm` is sent.
export async function changeGridColumns({ workbook, sheet, action, column, side, header, expectedHeader, confirm }) {
  const { data } = await api.post('/strategy/grid/columns', { workbook, sheet, action, column, side, header, expectedHeader, confirm });
  return data;
}

// Hides (hidden: true) or unhides rows in the user's own view; `all` with hidden: false unhides
// everything. Returns the sheet's hidden row keys. The Excel file isn't changed.
export async function setHiddenRows({ workbook, sheet, keys = [], hidden, all = false }) {
  const { data } = await api.put('/strategy/grid/hidden-rows', { workbook, sheet, keys, hidden, all });
  return data.hiddenKeys;
}

// Dashboard scoreboard: { sheet, academicYear, snapshots: [{ label, date, projects }] (oldest first), stageColumn, … }
export async function getScoreboard({ workbook, sheet, department, refresh } = {}) {
  const { data } = await api.get('/strategy/scoreboard', {
    params: {
      workbook: workbook || undefined,
      sheet: sheet || undefined,
      department: department || undefined,
      refresh: refresh ? 1 : undefined,
    },
  });
  return data;
}

export async function getStrategyMap({ workbook, sheet } = {}) {
  const { data } = await api.get('/strategy/map', { params: { workbook: workbook || undefined, sheet: sheet || undefined } });
  return data;
}
