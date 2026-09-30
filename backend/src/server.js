const env = require('./config/env');
const app = require('./app');
const logger = require('./utils/logger');
const { sequelize, connectDatabase } = require('./config/database');
const { seedDepartments } = require('./services/department.service');
const { addMissingColumns } = require('./config/migrations');
const { warmUp: warmUpFormats } = require('./services/format.service');
const { importEditLogs } = require('./services/audit.service');

// Register models and associations before syncing
require('./models/User');
require('./models/Department');
require('./models/UserDepartment');
require('./models/EditLog'); // older cell-edit history, copied into audit_logs once
require('./models/AuditLog');

async function start() {
  try {
    await connectDatabase();
    // Creates missing tables; switch to migrations before production
    await sequelize.sync();
    await addMissingColumns();
    // Fills departments the first time, then loads them into memory for matching
    await seedDepartments();
    await importEditLogs();

    app.listen(env.port, () => {
      logger.info(`MCU Scorecard API running on http://localhost:${env.port}`);
      warmUpFormats();
    });
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

start();
