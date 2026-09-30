const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const User = require('./User');
const Department = require('./Department');

const UserDepartment = sequelize.define('UserDepartment', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  userId: { type: DataTypes.INTEGER, allowNull: false },
  departmentId: { type: DataTypes.INTEGER, allowNull: false },
  isHead: { type: DataTypes.BOOLEAN, defaultValue: false },
}, {
  tableName: 'user_departments',
  indexes: [{ unique: true, fields: ['user_id', 'department_id'] }],
});

User.belongsToMany(Department, { through: UserDepartment, foreignKey: 'userId', as: 'departments' });
Department.belongsToMany(User, { through: UserDepartment, foreignKey: 'departmentId', as: 'users' });

module.exports = UserDepartment;
