const { DataTypes } = require('sequelize');
const { sequelize } = require('./database');
const logger = require('../utils/logger');

// Columns added after a table was first created. sequelize.sync() only creates missing
// tables, so these are added here if an existing database doesn't have them yet.
const ADDED_COLUMNS = [
  { table: 'users', column: 'department', definition: { type: DataTypes.STRING(100), allowNull: true } },
  { table: 'departments', column: 'aliases', definition: { type: DataTypes.JSON, allowNull: true } },
  { table: 'departments', column: 'other_names', definition: { type: DataTypes.JSON, allowNull: true } },
  { table: 'departments', column: 'view_all', definition: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false } },
  { table: 'departments', column: 'lead_codes', definition: { type: DataTypes.JSON, allowNull: true } },
  // Soft delete: set when a department is deleted on the Departments page (NULL = active)
  { table: 'departments', column: 'deleted_at', definition: { type: DataTypes.DATE, allowNull: true } },
];

// Returns the "table.column" names that were added on this run
async function addMissingColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const added = [];
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const existing = await queryInterface.describeTable(table);
    if (!existing[column]) {
      await queryInterface.addColumn(table, column, definition);
      logger.info(`Added column ${table}.${column}`);
      added.push(`${table}.${column}`);
    }
  }
  return added;
}

module.exports = { addMissingColumns };
