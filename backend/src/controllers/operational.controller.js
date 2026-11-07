const operational = require('../services/operational.service');
const columnService = require('../services/column.service');
const userService = require('../services/user.service');
const { audit } = require('../services/audit.service');

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

// The Operational Dashboard (read from the Operational Excel file); ?refresh=1 reads the file now
async function getDashboard(req, res) {
  res.json(await operational.getDashboard({ refresh: req.query.refresh === '1' }));
}

// The Operational file as an Excel-like grid (editable by admins and the ICT office)
async function getGrid(req, res) {
  const user = await userService.getUserForAccess(req.user.id);
  res.json(await operational.getGrid(user, { sheet: req.query.sheet, refresh: req.query.refresh === '1' }));
}

async function updateCell(req, res) {
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, row, column, value, previous, identity } = req.body;
  const { change, ...result } = await operational.updateCell(user, { sheet, row, column, value, previous, identity });
  await audit(req, 'sheet.cell_edit', change);
  res.json(result);
}

async function formatCell(req, res) {
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, row, column, identity, format } = req.body;
  const { change, ...result } = await operational.formatCell(user, { sheet, row, column, identity, format });
  await audit(req, 'sheet.cell_format', change);
  res.json(result);
}

// Column widths / row heights in the Operational file (dragging or double-clicking edges in the grid)
async function editableWb(req) {
  const user = await userService.getUserForAccess(req.user.id);
  if (!operational.canEdit(user)) throw httpError(403, 'Only admins and the ICT office can change the Operational file.');
  return operational.operationalWb();
}

async function setColumnWidths(req, res) {
  const wb = await editableWb(req);
  const { sheet, columns, width, autofit } = req.body;
  const { change, ...result } = await columnService.setColumnWidthsForUser(wb, req.user, { sheet, columns, width, autofit });
  await audit(req, 'sheet.column_width', change);
  res.json(result);
}

async function setRowHeights(req, res) {
  const wb = await editableWb(req);
  const { sheet, rows, height, autofit } = req.body;
  const { change, ...result } = await columnService.setRowHeightsForUser(wb, req.user, { sheet, rows, height, autofit });
  await audit(req, 'sheet.row_height', change);
  res.json(result);
}

module.exports = { getDashboard, getGrid, updateCell, formatCell, setColumnWidths, setRowHeights };
