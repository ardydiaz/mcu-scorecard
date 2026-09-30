import api from './axios';

// Visible sheets in workbook order: scorecard sheets only, or every sheet with `all`
export async function getSheets({ all = false } = {}) {
  const { data } = await api.get('/strategy/sheets', { params: { all: all ? 1 : undefined } });
  return data;
}

// { name, docUrl } used to open or embed the workbook in Excel for the web
export async function getWorkbook() {
  const { data } = await api.get('/strategy/workbook');
  return data;
}

// Perspective > Objective > KRA > KPI > Project tree, already filtered to the user's departments.
// `department` only has an effect for admins.
export async function getScorecard({ sheet, department, refresh } = {}) {
  const { data } = await api.get('/strategy/scorecard', {
    params: { sheet: sheet || undefined, department: department || undefined, refresh: refresh ? 1 : undefined },
  });
  return data;
}

// The sheet as a spreadsheet grid, filtered on Lead by the user's department (admins may pick one)
export async function getSheetGrid({ sheet, department, refresh } = {}) {
  const { data } = await api.get('/strategy/grid', {
    params: { sheet, department: department || undefined, refresh: refresh ? 1 : undefined },
  });
  return data;
}

// Saves one cell to the Excel file. `previous` and `identity` let the server detect changes
// made in Excel since the grid was loaded. Returns { text, identity } as Excel now shows it.
export async function updateGridCell({ sheet, row, column, value, previous, identity }) {
  const { data } = await api.patch('/strategy/grid/cell', { sheet, row, column, value, previous, identity });
  return data;
}

// Changes one cell's formatting in the Excel file (e.g. { bold: true } or { fillColor: '#FFFF00' }).
// Returns { style } as the cell now looks.
export async function formatGridCell({ sheet, row, column, identity, format }) {
  const { data } = await api.patch('/strategy/grid/format', { sheet, row, column, identity, format });
  return data;
}

export async function getStrategyMap({ sheet } = {}) {
  const { data } = await api.get('/strategy/map', { params: { sheet: sheet || undefined } });
  return data;
}
