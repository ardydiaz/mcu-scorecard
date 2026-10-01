const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Rows a user chose to hide in their own view of a sheet (a personal setting, not a
// permission: the rows stay visible to everyone else and can always be unhidden).
// `rowKey` is "id:<Row ID>", or "name:<Lead>|<project/KPI>" for sheets without Row IDs.
const HiddenRow = sequelize.define('HiddenRow', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  workbookId: { type: DataTypes.INTEGER, allowNull: false },
  sheet: { type: DataTypes.STRING, allowNull: false },
  rowKey: { type: DataTypes.STRING(300), allowNull: false },
}, {
  tableName: 'hidden_rows',
  updatedAt: false,
  indexes: [{ unique: true, name: 'hidden_rows_user_workbook_sheet_row', fields: ['user_id', 'workbook_id', 'sheet', 'row_key'] }],
});

module.exports = HiddenRow;
