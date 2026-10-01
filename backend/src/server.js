const env = require('./config/env');
const app = require('./app');
const logger = require('./utils/logger');
const { sequelize, connectDatabase } = require('./config/database');
const { seedDepartments } = require('./services/department.service');
const { addMissingColumns, dropReplacedIndexes } = require('./config/migrations');
const { warmUp: warmUpFormats } = require('./services/format.service');
const { initWorkbooks } = require('./services/workbook.service');
const { importEditLogs } = require('./services/audit.service');

// Register models and associations before syncing
require('./models/User');
require('./models/Department');
require('./models/UserDepartment');
require('./models/EditLog'); // older cell-edit history, copied into audit_logs once
require('./models/AuditLog');
require('./models/AccessRule');
require('./models/HiddenRow');
require('./models/Workbook');
require('./models/UserPhoto');

async function start() {
  try {
    await connectDatabase();
    // Adds columns to existing tables, then creates missing tables and indexes;
    // switch to migrations before production
    await addMissingColumns();
    await sequelize.sync();
    await dropReplacedIndexes();
    // Fills departments the first time, then loads them into memory for matching
    await seedDepartments();
    await importEditLogs();
    // Finds the Excel files in the scorecard folder
    const defaultWorkbook = await initWorkbooks();

    app.listen(env.port, () => {
      logger.info(`MCU Scorecard API running on http://localhost:${env.port}`);
      warmUpFormats(defaultWorkbook);
    });
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

start();
