const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  azureOid: { type: DataTypes.STRING(64), unique: true, allowNull: false },
  email: { type: DataTypes.STRING, unique: true, allowNull: false, validate: { isEmail: true } },
  displayName: { type: DataTypes.STRING },
  jobTitle: { type: DataTypes.STRING },
  // Department code from the M365 profile at last sign-in/sync (e.g. "ITD"); the raw
  // M365 value when it doesn't match config/departments.js
  department: { type: DataTypes.STRING(100) },
  role: { type: DataTypes.ENUM('admin', 'manager', 'user'), defaultValue: 'user' },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  lastLoginAt: { type: DataTypes.DATE },
}, { tableName: 'users' });

module.exports = User;
