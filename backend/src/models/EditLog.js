const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

// One row per cell edited through the system (who changed which Excel cell, from what to what)
const EditLog = sequelize.define('EditLog', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  userEmail: { type: DataTypes.STRING },
  sheet: { type: DataTypes.STRING, allowNull: false },
  cell: { type: DataTypes.STRING(20), allowNull: false },
  column: { type: DataTypes.STRING },
  oldValue: { type: DataTypes.TEXT },
  newValue: { type: DataTypes.TEXT },
}, { tableName: 'edit_logs', updatedAt: false });

module.exports = EditLog;
