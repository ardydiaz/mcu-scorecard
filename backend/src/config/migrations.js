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
  // Rules made by a Department Head only affect rows led by these department codes (NULL = admin rule)
  { table: 'access_rules', column: 'scope_codes', definition: { type: DataTypes.JSON, allowNull: true } },
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
  await widenEnums();
  return added;
}

// ENUM columns that gained values after their table was created
const WIDENED_ENUMS = [
  { table: 'access_rules', column: 'permission', values: ['view', 'edit', 'hide'], defaultValue: 'view' },
];

async function widenEnums() {
  const queryInterface = sequelize.getQueryInterface();
  for (const { table, column, values, defaultValue } of WIDENED_ENUMS) {
    const [tables] = await sequelize.query(`SHOW TABLES LIKE '${table}'`);
    if (!tables.length) continue; // created by sync() with the full list
    const existing = await queryInterface.describeTable(table);
    const type = existing[column]?.type || '';
    if (values.every((v) => type.includes(`'${v}'`))) continue;
    await queryInterface.changeColumn(table, column, { type: DataTypes.ENUM(...values), allowNull: false, defaultValue });
    logger.info(`Updated ${table}.${column} to allow: ${values.join(', ')}`);
  }
}

module.exports = { addMissingColumns };
