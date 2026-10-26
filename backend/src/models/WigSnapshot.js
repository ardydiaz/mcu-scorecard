const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// One WIG's status on one day (Manila time), saved by wigHistory.service so the dashboard can show
// the WIGs' status day by day: the sheet itself only holds the current traffic light.
// `rowKey` is "id:<Row ID>", or "name:<Lead>|<project>" for sheets without Row IDs.
// `status` is the dashboard's category: completed / ontrack / behind / atrisk / unreported.
const WigSnapshot = sequelize.define('WigSnapshot', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  workbookId: { type: DataTypes.INTEGER, allowNull: false },
  sheet: { type: DataTypes.STRING, allowNull: false },
  day: { type: DataTypes.DATEONLY, allowNull: false },
  rowKey: { type: DataTypes.STRING(300), allowNull: false },
  name: { type: DataTypes.STRING, allowNull: false },
  lead: { type: DataTypes.STRING(100) },
  tier: { type: DataTypes.STRING(10) },
  status: { type: DataTypes.STRING(20), allowNull: false },
  trafficLight: { type: DataTypes.STRING(40) },
  pct: { type: DataTypes.INTEGER },
}, {
  tableName: 'wig_snapshots',
  indexes: [
    { unique: true, name: 'wig_snapshots_workbook_sheet_day_row', fields: ['workbook_id', 'sheet', 'day', 'row_key'] },
    { name: 'wig_snapshots_workbook_sheet_day', fields: ['workbook_id', 'sheet', 'day'] },
  ],
});

module.exports = WigSnapshot;
