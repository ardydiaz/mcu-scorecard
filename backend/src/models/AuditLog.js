const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// One row per recorded action (sign-ins, Excel edits, admin changes); see services/audit.service.js
const AuditLog = sequelize.define('AuditLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: true },
  userEmail: { type: DataTypes.STRING },
  // e.g. "auth.login", "sheet.cell_edit", "user.role_change", "department.update"
  action: { type: DataTypes.STRING(50), allowNull: false },
  // What was acted on, e.g. "Strategy Scorecard 26-27 FINAL!R130", "ITD", "juan@mcu.edu.ph"
  target: { type: DataTypes.STRING(255) },
  // Action-specific details, e.g. { column, oldValue, newValue } or { from, to }
  details: { type: DataTypes.JSON },
  ip: { type: DataTypes.STRING(64) },
  userAgent: { type: DataTypes.STRING(255) },
}, {
  tableName: 'audit_logs',
  updatedAt: false,
  indexes: [{ fields: ['created_at'] }, { fields: ['action'] }, { fields: ['user_id'] }],
});

module.exports = AuditLog;
