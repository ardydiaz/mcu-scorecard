const scorecardService = require('../services/scorecard.service');
const excelService = require('../services/excel.service');
const gridService = require('../services/grid.service');
const formatService = require('../services/format.service');
const userService = require('../services/user.service');

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

// Department filtering happens here on the server, based on the user's DB record
async function getScorecard(req, res) {
  const user = await userService.getUserById(req.user.id);
  const { sheet, department, refresh } = req.query;
  res.json(await scorecardService.getScorecardForUser(user.toJSON(), {
    sheet,
    department,
    refresh: refresh === '1',
  }));
}

// Sheet as a spreadsheet grid, filtered on the Lead column by the user's department
async function getGrid(req, res) {
  const user = await userService.getUserById(req.user.id);
  const { sheet, department, refresh } = req.query;
  res.json(await gridService.getGridForUser(user.toJSON(), { sheet, department, refresh: refresh === '1' }));
}

// Saves one grid cell back to the Excel file (permission and conflict checks in grid.service)
async function updateGridCell(req, res) {
  const user = await userService.getUserById(req.user.id);
  const { sheet, row, column, value, previous, identity } = req.body;
  res.json(await gridService.updateCellForUser(user.toJSON(), { sheet, row, column, value, previous, identity }));
}

// Changes one grid cell's formatting in the Excel file (same permission checks as editing)
async function formatGridCell(req, res) {
  const user = await userService.getUserById(req.user.id);
  const { sheet, row, column, identity, format } = req.body;
  res.json(await gridService.formatCellForUser(user.toJSON(), { sheet, row, column, identity, format }));
}

async function getMap(req, res) {
  res.json(await scorecardService.getStrategyMap({ sheet: req.query.sheet, refresh: req.query.refresh === '1' }));
}

module.exports = { listSheets, getWorkbook, getScorecard, getGrid, updateGridCell, formatGridCell, getMap };
