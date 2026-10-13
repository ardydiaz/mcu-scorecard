const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const User = sequelize.define('User', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  azureOid: { type: DataTypes.STRING(64), unique: true, allowNull: false },
  email: { type: DataTypes.STRING, unique: true, allowNull: false, validate: { isEmail: true } },
  displayName: { type: DataTypes.STRING },
  jobTitle: { type: DataTypes.STRING },
  // Department code from the M365 profile at last sign-in (e.g. "ITD"); the raw
  // M365 value when it doesn't match config/departments.js
  department: { type: DataTypes.STRING(100) },
  role: { type: DataTypes.ENUM('admin', 'manager', 'user'), defaultValue: 'user' },
  isActive: { type: DataTypes.BOOLEAN, defaultValue: true },
  // Set by an admin: sees every department's rows and gets the full Lead filter, like EXECOM.
  // Viewing only: they still edit just the rows their own department leads.
  viewAll: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
  lastLoginAt: { type: DataTypes.DATE },
  // When the saved M365 profile photo last changed (NULL = no photo). The frontend adds it to the
  // photo URL, so browsers fetch the new image only after it changes.
  photoUpdatedAt: { type: DataTypes.DATE, allowNull: true },
}, { tableName: 'users' });

module.exports = User;
