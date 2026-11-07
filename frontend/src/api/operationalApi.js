import api from './axios';

// Operational Dashboard, read from the Excel file in SharePoint's "Operational" folder:
// { title, sheet, updates: [labels], sections: [{ name, items: [{ row, name, particular, group, pic,
//   latest, latestLabel, previous, changed, status, history }] }], file: { name, webUrl, lastModified } }
export async function getOperational({ refresh } = {}) {
  const { data } = await api.get('/operational', { params: { refresh: refresh ? 1 : undefined } });
  return data;
}

// The Operational file as a grid for SheetGrid (same shape as the Live Agenda's), plus { sheets, docUrl, fileName }.
// `editable` is false for users who may only view it (admins and the ICT office can edit).
export async function getOperationalGrid({ sheet, refresh } = {}) {
  const { data } = await api.get('/operational/grid', { params: { sheet: sheet || undefined, refresh: refresh ? 1 : undefined } });
  return data;
}

// Saves one cell; returns { text, identity } as Excel now shows it
export async function updateOperationalCell({ sheet, row, column, value, previous, identity }) {
  const { data } = await api.patch('/operational/grid/cell', { sheet, row, column, value, previous, identity });
  return data;
}

// Changes one cell's formatting; returns { style }
export async function formatOperationalCell({ sheet, row, column, identity, format }) {
  const { data } = await api.patch('/operational/grid/format', { sheet, row, column, identity, format });
  return data;
}

// Column widths / row heights in pixels, or fit to the content (`autofit`)
export async function setOperationalColumnWidths({ sheet, columns, width, autofit }) {
  const { data } = await api.put('/operational/grid/column-width', { sheet, columns, width, autofit });
  return data;
}
export async function setOperationalRowHeights({ sheet, rows, height, autofit }) {
  const { data } = await api.put('/operational/grid/row-height', { sheet, rows, height, autofit });
  return data;
}
