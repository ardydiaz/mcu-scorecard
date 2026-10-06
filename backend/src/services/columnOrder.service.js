const ColumnOrder = require('../models/ColumnOrder');

const MAX_COLUMNS = 300;

// The user's column order for a sheet (list of column keys), or null for the sheet's own order
async function getColumnOrder(userId, workbookId, sheet) {
  const row = await ColumnOrder.findOne({ where: { userId, workbookId, sheet }, attributes: ['columns'], raw: true });
  return row?.columns || null;
}

// Saves the order (`columns` = keys), or goes back to the sheet's order when `columns` is null
async function setColumnOrder(userId, workbookId, sheet, columns) {
  if (!columns) {
    await ColumnOrder.destroy({ where: { userId, workbookId, sheet } });
    return null;
  }
  const clean = [...new Set(columns.map((k) => String(k).slice(0, 300)))].slice(0, MAX_COLUMNS);
  const existing = await ColumnOrder.findOne({ where: { userId, workbookId, sheet } });
  if (existing) await existing.update({ columns: clean });
  else await ColumnOrder.create({ userId, workbookId, sheet, columns: clean });
  return clean;
}

module.exports = { getColumnOrder, setColumnOrder };
