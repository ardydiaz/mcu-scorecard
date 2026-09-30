const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// Departments are managed by admins on the Departments page; see config/departments.js for how
// they're matched against the scorecard's Lead column and the M365 "Department" field.
const Department = sequelize.define('Department', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, unique: true, allowNull: false },
  code: { type: DataTypes.STRING(20), unique: true },
  description: { type: DataTypes.TEXT },
  // Other spellings of the code in the Lead column / M365, e.g. ["IT"] for ITD
  aliases: { type: DataTypes.JSON, defaultValue: [] },
  // Other full names that mean this department in the M365 Department field
  otherNames: { type: DataTypes.JSON, defaultValue: [] },
  // Members see every row, without the Lead filter (they still only edit rows they lead)
  viewAll: { type: DataTypes.BOOLEAN, defaultValue: false, allowNull: false },
  // Extra Lead codes whose rows members may edit, e.g. ["EVP", "BOT", "OP"] for EXECOM
  leadCodes: { type: DataTypes.JSON, defaultValue: [] },
}, {
  tableName: 'departments',
  // Soft delete: destroy() sets deleted_at instead of removing the row, and normal queries skip
  // deleted departments; restore() brings one back (use { paranoid: false } to include them)
  paranoid: true,
});

module.exports = Department;
