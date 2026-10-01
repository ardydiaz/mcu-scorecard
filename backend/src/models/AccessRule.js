const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

/**
 * Row access on top of the default (each department sees and edits the rows it leads).
 * A rule gives a user or a department `view` or `edit` access to the rows it matches, or
 * `hide`s them. See services/access.service.js for how rules are evaluated.
 */
const AccessRule = sequelize.define('AccessRule', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  // Who: one user, or everyone in a department
  subjectType: { type: DataTypes.ENUM('user', 'department'), allowNull: false },
  userId: { type: DataTypes.INTEGER, allowNull: true },
  departmentCode: { type: DataTypes.STRING(20), allowNull: true },
  // Which file: one workbook (workbooks.id), or every file when null. Row ID rules always name one.
  workbookId: { type: DataTypes.INTEGER, allowNull: true },
  // Which rows: in one sheet, or every scorecard sheet when null
  sheet: { type: DataTypes.STRING, allowNull: true },
  // lead / support: codes in that column; perspective / objective / kra: names; rowId: Row IDs
  matchType: { type: DataTypes.ENUM('lead', 'support', 'perspective', 'objective', 'kra', 'rowId'), allowNull: false },
  matchValues: { type: DataTypes.JSON, allowNull: false, defaultValue: [] },
  // view / edit add access; hide takes matching rows away (and wins over everything except admin)
  permission: { type: DataTypes.ENUM('view', 'edit', 'hide'), allowNull: false, defaultValue: 'view' },
  note: { type: DataTypes.STRING(255) },
  createdBy: { type: DataTypes.INTEGER },
  // Set on rules made by a Department Head: the rule only affects rows whose Lead includes one of
  // these codes (their department), whatever it matches. NULL for admin rules (any row).
  scopeCodes: { type: DataTypes.JSON, allowNull: true },
}, {
  tableName: 'access_rules',
  indexes: [{ fields: ['subject_type', 'user_id'] }, { fields: ['subject_type', 'department_code'] }],
});

module.exports = AccessRule;
