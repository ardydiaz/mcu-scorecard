const scorecardService = require('../services/scorecard.service');
const excelService = require('../services/excel.service');
const gridService = require('../services/grid.service');
const formatService = require('../services/format.service');
const userService = require('../services/user.service');
const workbookService = require('../services/workbook.service');
const { audit } = require('../services/audit.service');
const hiddenRowService = require('../services/hiddenRow.service');
const scoreboardService = require('../services/scoreboard.service');
const columnService = require('../services/column.service');

// The scorecard file this request works on (?workbook= or body.workbook; default file when absent)
const workbookFor = (req) => workbookService.resolveWorkbook(req.query.workbook ?? req.body?.workbook, req.user);

// Scorecard files the user may open, for the file picker
async function listWorkbooks(req, res) {
  res.json(await workbookService.listForUser(req.user));
}

// ?all=1 lists every visible sheet (for the Excel view), otherwise only scorecard sheets
async function listSheets(req, res) {
  const wb = await workbookFor(req);
  const sheets = await scorecardService.listVisibleSheets(wb, { scorecardOnly: req.query.all !== '1' });
  res.json(sheets.map((s) => ({ ...s, tabColor: formatService.getTabColor(wb, s.name) })));
}

// Workbook address for opening/embedding it in Excel for the web. Opening it still
// requires the user's own SharePoint access to the file.
async function getWorkbook(req, res) {
  const wb = await workbookFor(req);
  const { name, docUrl } = await excelService.getWorkbookInfo(wb);
  res.json({ id: wb.id, name, docUrl });
}

// Records which sheet data a user was shown (and with which filter)
const auditView = (req, view, wb, data, extra = {}) => audit(req, 'sheet.view', {
  target: data.sheet,
  details: {
    view,
    workbook: wb.name,
    department: data.viewingDepartments?.length ? data.viewingDepartments.join(', ') : 'All',
    ...extra,
    ...(req.query.refresh === '1' && { refreshed: true }),
  },
});

// Sheet as a spreadsheet grid, filtered on the Lead column by the user's department
async function getGrid(req, res) {
  const wb = await workbookFor(req);
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, department, refresh } = req.query;
  const data = await gridService.getGridForUser(wb, user, { sheet, department, refresh: refresh === '1' });
  if (data.supported) {
    // Rows this user chose to hide in their own view (personal setting)
    data.hiddenKeys = await hiddenRowService.getHiddenKeys(user.id, wb.id, data.sheet);
    // Everyone may insert columns; deleting one is for admins (see column.service)
    data.canInsertColumns = true;
    data.canDeleteColumns = user.role === 'admin';
    data.canRenameColumns = user.role === 'admin';
    await auditView(req, 'Excel grid', wb, data, { rows: data.rows.length });
  }
  res.json(data);
}

// Hides / unhides rows in the user's own view of a sheet (doesn't change the Excel file)
async function setHiddenRows(req, res) {
  const wb = await workbookFor(req);
  const { sheet, keys = [], hidden, all } = req.body;
  const hiddenKeys = all && !hidden
    ? await hiddenRowService.unhideAll(req.user.id, wb.id, sheet)
    : await hiddenRowService.setHidden(req.user.id, wb.id, sheet, keys, hidden);
  res.json({ workbookId: wb.id, sheet, hiddenKeys });
}

// Records edits refused for permission reasons (e.g. another department's row), then re-throws
async function withDeniedAudit(req, wb, action, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.status === 403) {
      const { sheet, row } = req.body;
      const column = req.body.column || req.body.startColumn;
      await audit(req, 'sheet.edit_denied', {
        // A cell (C129), or a whole column (C:C) for column changes
        target: row ? `${sheet}!${column}${row}` : `${sheet}!${column || ''}:${column || ''}`,
        details: { workbook: wb.name, attempted: action, reason: err.message },
      });
    }
    throw err;
  }
}

// Saves one grid cell back to the Excel file (permission and conflict checks in grid.service)
async function updateGridCell(req, res) {
  const wb = await workbookFor(req);
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, row, column, value, previous, identity } = req.body;
  const { change, ...result } = await withDeniedAudit(req, wb, 'edit', () => (
    gridService.updateCellForUser(wb, user, { sheet, row, column, value, previous, identity })
  ));
  await audit(req, 'sheet.cell_edit', change);
  res.json(result);
}

// Changes one grid cell's formatting in the Excel file (same permission checks as editing)
async function formatGridCell(req, res) {
  const wb = await workbookFor(req);
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, row, column, identity, format } = req.body;
  const { change, ...result } = await withDeniedAudit(req, wb, 'format', () => (
    gridService.formatCellForUser(wb, user, { sheet, row, column, identity, format })
  ));
  await audit(req, 'sheet.cell_format', change);
  res.json(result);
}

// Merges (or unmerges) a range of the Excel file; rules in grid.service
// Pastes copied values into the Excel file (Ctrl+V in the grid); rules in grid.service
async function pasteGridCells(req, res) {
  const wb = await workbookFor(req);
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, targets } = req.body;
  const { change, ...result } = await withDeniedAudit(req, wb, 'paste', () => gridService.pasteForUser(wb, user, { sheet, targets }));
  await audit(req, 'sheet.paste', change);
  res.json(result);
}

// Inserts a column, adds today's update column, or (admins) deletes a column; rules in column.service
async function changeGridColumns(req, res) {
  const wb = await workbookFor(req);
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, action, column, side, header, expectedHeader, confirm, target, expectedTarget } = req.body;
  const run = {
    insert: () => columnService.insertColumnForUser(wb, user, { sheet, column, side, header, expectedHeader }),
    update: () => columnService.addUpdateColumnForUser(wb, user, { sheet }),
    delete: () => columnService.deleteColumnForUser(wb, user, { sheet, column, expectedHeader, confirm }),
    rename: () => columnService.renameColumnForUser(wb, user, { sheet, column, header, expectedHeader }),
    move: () => columnService.moveColumnForUser(wb, user, { sheet, column, target, side, expectedHeader, expectedTarget, confirm }),
  }[action];
  const { change, ...result } = await withDeniedAudit(req, wb, `column ${action}`, run);
  await audit(req, { delete: 'sheet.column_delete', rename: 'sheet.column_rename', move: 'sheet.column_move' }[action] || 'sheet.column_insert', change);
  res.json(result);
}

async function mergeGridCells(req, res) {
  const wb = await workbookFor(req);
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, row, endRow, startColumn, endColumn, identities, merge, center, confirm } = req.body;
  const { change, ...result } = await withDeniedAudit(req, wb, merge ? 'merge' : 'unmerge', () => (
    gridService.mergeCellsForUser(wb, user, { sheet, row, endRow, startColumn, endColumn, identities, merge, center, confirm })
  ));
  await audit(req, merge ? 'sheet.merge' : 'sheet.unmerge', change);
  res.json(result);
}

// Dashboard scoreboard: the projects the user may see, once per dated update column
async function getScoreboard(req, res) {
  const wb = await workbookFor(req);
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, department, refresh } = req.query;
  const data = await scoreboardService.getScoreboardForUser(wb, user, { sheet, department, refresh: refresh === '1' });
  await auditView(req, 'Dashboard scoreboard', wb, data, { projects: data.projects.length });
  res.json({ ...data, workbookId: wb.id, workbookName: wb.name });
}

async function getMap(req, res) {
  const wb = await workbookFor(req);
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, department, refresh } = req.query;
  const data = await scorecardService.getStrategyMap(wb, user, { sheet, department, refresh: refresh === '1' });
  await auditView(req, 'Strategy Map summary', wb, data);
  res.json({ ...data, workbookId: wb.id });
}

module.exports = {
  listWorkbooks, listSheets, getWorkbook, getScoreboard, getGrid, setHiddenRows, updateGridCell, formatGridCell, mergeGridCells, changeGridColumns, pasteGridCells, getMap,
};
