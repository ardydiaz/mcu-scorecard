const scorecardService = require('../services/scorecard.service');
const excelService = require('../services/excel.service');
const gridService = require('../services/grid.service');
const formatService = require('../services/format.service');
const userService = require('../services/user.service');
const { audit } = require('../services/audit.service');
const hiddenRowService = require('../services/hiddenRow.service');

// ?all=1 lists every visible sheet (for the Excel view), otherwise only scorecard sheets
async function listSheets(req, res) {
  const sheets = await scorecardService.listVisibleSheets({ scorecardOnly: req.query.all !== '1' });
  res.json(sheets.map((s) => ({ ...s, tabColor: formatService.getTabColor(s.name) })));
}

// Workbook address for opening/embedding it in Excel for the web. Opening it still
// requires the user's own SharePoint access to the file.
async function getWorkbook(req, res) {
  const { name, docUrl } = await excelService.getWorkbookInfo();
  res.json({ name, docUrl });
}

// Records which sheet data a user was shown (and with which filter)
const auditView = (req, view, data, extra = {}) => audit(req, 'sheet.view', {
  target: data.sheet,
  details: {
    view,
    department: data.viewingDepartments?.length ? data.viewingDepartments.join(', ') : 'All',
    ...extra,
    ...(req.query.refresh === '1' && { refreshed: true }),
  },
});

// Department filtering happens here on the server, based on the user's DB record
async function getScorecard(req, res) {
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, department, refresh } = req.query;
  const data = await scorecardService.getScorecardForUser(user, {
    sheet,
    department,
    refresh: refresh === '1',
  });
  await auditView(req, 'Scorecard', data, { kpis: data.counts.kpis, projects: data.counts.projects });
  res.json(data);
}

// Sheet as a spreadsheet grid, filtered on the Lead column by the user's department
async function getGrid(req, res) {
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, department, refresh } = req.query;
  const data = await gridService.getGridForUser(user, { sheet, department, refresh: refresh === '1' });
  if (data.supported) {
    // Rows this user chose to hide in their own view (personal setting)
    data.hiddenKeys = await hiddenRowService.getHiddenKeys(user.id, data.sheet);
    await auditView(req, 'Excel grid', data, { rows: data.rows.length });
  }
  res.json(data);
}

// Hides / unhides rows in the user's own view of a sheet (doesn't change the Excel file)
async function setHiddenRows(req, res) {
  const { sheet, keys = [], hidden, all } = req.body;
  const hiddenKeys = all && !hidden
    ? await hiddenRowService.unhideAll(req.user.id, sheet)
    : await hiddenRowService.setHidden(req.user.id, sheet, keys, hidden);
  res.json({ sheet, hiddenKeys });
}

// Records edits refused for permission reasons (e.g. another department's row), then re-throws
async function withDeniedAudit(req, action, fn) {
  try {
    return await fn();
  } catch (err) {
    if (err.status === 403) {
      const { sheet, row } = req.body;
      const column = req.body.column || req.body.startColumn;
      await audit(req, 'sheet.edit_denied', { target: `${sheet}!${column}${row}`, details: { attempted: action, reason: err.message } });
    }
    throw err;
  }
}

// Saves one grid cell back to the Excel file (permission and conflict checks in grid.service)
async function updateGridCell(req, res) {
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, row, column, value, previous, identity } = req.body;
  const { change, ...result } = await withDeniedAudit(req, 'edit', () => (
    gridService.updateCellForUser(user, { sheet, row, column, value, previous, identity })
  ));
  await audit(req, 'sheet.cell_edit', change);
  res.json(result);
}

// Changes one grid cell's formatting in the Excel file (same permission checks as editing)
async function formatGridCell(req, res) {
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, row, column, identity, format } = req.body;
  const { change, ...result } = await withDeniedAudit(req, 'format', () => (
    gridService.formatCellForUser(user, { sheet, row, column, identity, format })
  ));
  await audit(req, 'sheet.cell_format', change);
  res.json(result);
}

// Merges (or unmerges) a range of the Excel file; rules in grid.service
async function mergeGridCells(req, res) {
  const user = await userService.getUserForAccess(req.user.id);
  const { sheet, row, endRow, startColumn, endColumn, identities, merge, center, confirm } = req.body;
  const { change, ...result } = await withDeniedAudit(req, merge ? 'merge' : 'unmerge', () => (
    gridService.mergeCellsForUser(user, { sheet, row, endRow, startColumn, endColumn, identities, merge, center, confirm })
  ));
  await audit(req, merge ? 'sheet.merge' : 'sheet.unmerge', change);
  res.json(result);
}

async function getMap(req, res) {
  const data = await scorecardService.getStrategyMap({ sheet: req.query.sheet, refresh: req.query.refresh === '1' });
  await auditView(req, 'Strategy Map summary', data);
  res.json(data);
}

module.exports = { listSheets, getWorkbook, getScorecard, getGrid, setHiddenRows, updateGridCell, formatGridCell, mergeGridCells, getMap };
