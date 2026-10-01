const { DataTypes } = require('sequelize');
const { sequelize } = require('./database');
const logger = require('../utils/logger');

// Columns added after a table was first created. sequelize.sync() only creates missing
// tables, so these are added here if an existing database doesn't have them yet.
// Runs before sync(), because sync() adds the models' indexes, which may use these columns.
const ADDED_COLUMNS = [
  { table: 'users', column: 'department', definition: { type: DataTypes.STRING(100), allowNull: true } },
  { table: 'users', column: 'photo_updated_at', definition: { type: DataTypes.DATE, allowNull: true } },
  { table: 'departments', column: 'aliases', definition: { type: DataTypes.JSON, allowNull: true } },
  { table: 'departments', column: 'other_names', definition: { type: DataTypes.JSON, allowNull: true } },
  { table: 'departments', column: 'view_all', definition: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false } },
  { table: 'departments', column: 'lead_codes', definition: { type: DataTypes.JSON, allowNull: true } },
  // Soft delete: set when a department is deleted on the Departments page (NULL = active)
  { table: 'departments', column: 'deleted_at', definition: { type: DataTypes.DATE, allowNull: true } },
  // Rules made by a Department Head only affect rows led by these department codes (NULL = admin rule)
  { table: 'access_rules', column: 'scope_codes', definition: { type: DataTypes.JSON, allowNull: true } },
  // Multiple scorecard files: which file a rule (NULL = all files) or hidden row belongs to.
  // Rows saved before this get the default file at startup (workbookService.initWorkbooks).
  { table: 'access_rules', column: 'workbook_id', definition: { type: DataTypes.INTEGER, allowNull: true } },
  { table: 'hidden_rows', column: 'workbook_id', definition: { type: DataTypes.INTEGER, allowNull: true } },
];

async function tableExists(table) {
  const [tables] = await sequelize.query(`SHOW TABLES LIKE '${table}'`);
  return tables.length > 0;
}

// Returns the "table.column" names that were added on this run. Tables that don't exist yet are
// skipped: sync() creates them with every column.
async function addMissingColumns() {
  const queryInterface = sequelize.getQueryInterface();
  const added = [];
  for (const { table, column, definition } of ADDED_COLUMNS) {
    if (!(await tableExists(table))) continue;
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
    if (!(await tableExists(table))) continue; // created by sync() with the full list
    const existing = await queryInterface.describeTable(table);
    const type = existing[column]?.type || '';
    if (values.every((v) => type.includes(`'${v}'`))) continue;
    await queryInterface.changeColumn(table, column, { type: DataTypes.ENUM(...values), allowNull: false, defaultValue });
    logger.info(`Updated ${table}.${column} to allow: ${values.join(', ')}`);
  }
}

// Unique indexes replaced by wider ones (sync() creates the new one): [table, old columns]
const REPLACED_UNIQUE_INDEXES = [
  { table: 'hidden_rows', columns: ['user_id', 'sheet', 'row_key'] },
];

// Runs after sync()
async function dropReplacedIndexes() {
  const queryInterface = sequelize.getQueryInterface();
  for (const { table, columns } of REPLACED_UNIQUE_INDEXES) {
    const indexes = await queryInterface.showIndex(table);
    for (const index of indexes) {
      const fields = index.fields.map((f) => f.attribute);
      if (index.unique && !index.primary && fields.join() === columns.join()) {
        await queryInterface.removeIndex(table, index.name);
        logger.info(`Removed old index ${table}.${index.name}`);
      }
    }
  }
}

module.exports = { addMissingColumns, dropReplacedIndexes };
