const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// A user's own column order for one sheet of one file (dragging column letters in the Excel grid).
// A personal view setting like hidden rows: the Excel file and other users are not affected.
// `columns` lists column keys (the header text, see SheetGrid) in the order the user chose.
const ColumnOrder = sequelize.define('ColumnOrder', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  workbookId: { type: DataTypes.INTEGER, allowNull: false },
  sheet: { type: DataTypes.STRING, allowNull: false },
  columns: { type: DataTypes.JSON, allowNull: false },
}, {
  tableName: 'column_orders',
  indexes: [{ unique: true, name: 'column_orders_user_workbook_sheet', fields: ['user_id', 'workbook_id', 'sheet'] }],
});

module.exports = ColumnOrder;
