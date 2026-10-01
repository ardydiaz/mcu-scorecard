const { Op } = require('sequelize');
const HiddenRow = require('../models/HiddenRow');

const MAX_KEYS = 500;

// Personal hidden rows are kept per file (`workbookId`) and sheet
async function getHiddenKeys(userId, workbookId, sheet) {
  const rows = await HiddenRow.findAll({ where: { userId, workbookId, sheet }, attributes: ['rowKey'], raw: true });
  return rows.map((r) => r.rowKey);
}

// Hides (hidden: true) or unhides rows in the user's own view; returns the sheet's hidden keys
async function setHidden(userId, workbookId, sheet, keys, hidden) {
  const clean = [...new Set(keys.map((k) => String(k).slice(0, 300)).filter(Boolean))].slice(0, MAX_KEYS);
  if (hidden) {
    await HiddenRow.bulkCreate(clean.map((rowKey) => ({ userId, workbookId, sheet, rowKey })), { ignoreDuplicates: true });
  } else if (clean.length) {
    await HiddenRow.destroy({ where: { userId, workbookId, sheet, rowKey: { [Op.in]: clean } } });
  }
  return getHiddenKeys(userId, workbookId, sheet);
}

async function unhideAll(userId, workbookId, sheet) {
  await HiddenRow.destroy({ where: { userId, workbookId, sheet } });
  return [];
}

module.exports = { getHiddenKeys, setHidden, unhideAll };
