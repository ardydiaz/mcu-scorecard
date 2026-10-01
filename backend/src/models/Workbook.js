const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Excel files found in the SharePoint scorecard folder (see services/workbook.service.js).
 *   draft      found but not released yet: only admins see it
 *   published  everyone can open it (rows still filtered by department and access rules)
 *   hidden     taken out of the system; nobody but admins sees it in the list
 * `isDefault` marks the file that opens first. `missing` is set when the file is no longer in the folder.
 */
const Workbook = sequelize.define('Workbook', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  driveId: { type: DataTypes.STRING(200), allowNull: false },
  itemId: { type: DataTypes.STRING(100), allowNull: false, unique: true },
  name: { type: DataTypes.STRING(255), allowNull: false },
  webUrl: { type: DataTypes.STRING(1000) },
  status: { type: DataTypes.ENUM('draft', 'published', 'hidden'), allowNull: false, defaultValue: 'draft' },
  isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  lastModifiedAt: { type: DataTypes.DATE },
  missing: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
}, {
  tableName: 'workbooks',
});

module.exports = Workbook;
