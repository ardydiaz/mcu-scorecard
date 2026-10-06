const { sequelize } = require('./database');
const { addMissingColumns, dropReplacedIndexes, WIDENED_ENUMS, REPLACED_UNIQUE_INDEXES } = require('./migrations');
const { seedDepartments } = require('../services/department.service');
const { importEditLogs } = require('../services/audit.service');
const logger = require('../utils/logger');

/**
 * Database changes, run by `npm run migrate` (and on start-up in development, see AUTO_MIGRATE):
 *   1. add columns that newer versions of the models have to existing tables, widen ENUMs
 *   2. create missing tables and indexes (sequelize.sync, never drops or alters data)
 *   3. remove indexes that were replaced by wider ones
 *   4. fill the departments table the first time; copy old cell-edit history into audit_logs once
 * Every step checks first and only changes what's missing, so running it again is safe.
 * Models must be registered (require('../models')) before calling.
 */
async function runMigrations() {
  const added = await addMissingColumns();
  await sequelize.sync();
  await dropReplacedIndexes();
  await seedDepartments();
  await importEditLogs();
  return { addedColumns: added };
}

/**
 * What the database is missing compared with the models, without changing anything:
 * ["table workbooks is missing", "column users.photo_updated_at is missing", …]. Empty = up to date.
 */
async function checkSchema() {
  const qi = sequelize.getQueryInterface();
  const problems = [];
  const tables = new Set((await qi.showAllTables()).map((t) => (typeof t === 'string' ? t : t.tableName)).map((t) => t.toLowerCase()));

  for (const model of Object.values(sequelize.models)) {
    const table = model.getTableName();
    const name = typeof table === 'string' ? table : table.tableName;
    if (!tables.has(name.toLowerCase())) {
      problems.push(`table ${name} is missing`);
      continue;
    }
    const existing = await qi.describeTable(name);
    for (const attr of Object.values(model.rawAttributes)) {
      if (!existing[attr.field]) problems.push(`column ${name}.${attr.field} is missing`);
    }
  }

  for (const { table, column, values } of WIDENED_ENUMS) {
    if (!tables.has(table)) continue;
    const type = (await qi.describeTable(table))[column]?.type || '';
    const lacking = values.filter((v) => !type.includes(`'${v}'`));
    if (lacking.length) problems.push(`${table}.${column} doesn't allow ${lacking.join(', ')} yet`);
  }

  for (const { table, columns } of REPLACED_UNIQUE_INDEXES) {
    if (!tables.has(table)) continue;
    const old = (await qi.showIndex(table)).find((i) => i.unique && !i.primary && i.fields.map((f) => f.attribute).join() === columns.join());
    if (old) problems.push(`old index ${table}.${old.name} should be removed`);
  }
  return problems;
}

// Logs what a migration run changed
function logResult({ addedColumns }) {
  logger.info(`Database is up to date${addedColumns.length ? ` (added ${addedColumns.join(', ')})` : ''}`);
}

module.exports = { runMigrations, checkSchema, logResult };
