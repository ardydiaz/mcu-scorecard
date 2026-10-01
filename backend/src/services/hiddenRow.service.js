const { Op } = require('sequelize');
const HiddenRow = require('../models/HiddenRow');

const MAX_KEYS = 500;

async function getHiddenKeys(userId, sheet) {
  const rows = await HiddenRow.findAll({ where: { userId, sheet }, attributes: ['rowKey'], raw: true });
  return rows.map((r) => r.rowKey);
}

// Hides (hidden: true) or unhides rows in the user's own view; returns the sheet's hidden keys
async function setHidden(userId, sheet, keys, hidden) {
  const clean = [...new Set(keys.map((k) => String(k).slice(0, 300)).filter(Boolean))].slice(0, MAX_KEYS);
  if (hidden) {
    await HiddenRow.bulkCreate(clean.map((rowKey) => ({ userId, sheet, rowKey })), { ignoreDuplicates: true });
  } else if (clean.length) {
    await HiddenRow.destroy({ where: { userId, sheet, rowKey: { [Op.in]: clean } } });
  }
  return getHiddenKeys(userId, sheet);
}

async function unhideAll(userId, sheet) {
  await HiddenRow.destroy({ where: { userId, sheet } });
  return [];
}

module.exports = { getHiddenKeys, setHidden, unhideAll };
