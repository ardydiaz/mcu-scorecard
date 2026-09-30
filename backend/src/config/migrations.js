const { DataTypes } = require('sequelize');
const { sequelize } = require('./database');
const logger = require('../utils/logger');

// Columns added after a table was first created. sequelize.sync() only creates missing
// tables, so these are added here if an existing database doesn't have them yet.
const ADDED_COLUMNS = [
  { table: 'users', column: 'department', definition: { type: DataTypes.STRING(100), allowNull: true } },
];

async function addMissingColumns() {
  const queryInterface = sequelize.getQueryInterface();
  for (const { table, column, definition } of ADDED_COLUMNS) {
    const existing = await queryInterface.describeTable(table);
    if (!existing[column]) {
      await queryInterface.addColumn(table, column, definition);
      logger.info(`Added column ${table}.${column}`);
    }
  }
}

module.exports = { addMissingColumns };
