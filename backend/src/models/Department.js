const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const Department = sequelize.define('Department', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING, unique: true, allowNull: false },
  code: { type: DataTypes.STRING(20), unique: true },
  description: { type: DataTypes.TEXT },
}, { tableName: 'departments' });

module.exports = Department;
