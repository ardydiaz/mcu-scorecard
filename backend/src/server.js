const env = require('./config/env');
const app = require('./app');
const logger = require('./utils/logger');
const { connectDatabase } = require('./config/database');
const { loadDepartments } = require('./services/department.service');
const { runMigrations, checkSchema, logResult } = require('./config/migrate');
const { warmUp: warmUpFormats } = require('./services/format.service');
const { initWorkbooks } = require('./services/workbook.service');

// Register models and associations before touching the database
require('./models');

// A promise that fails with nobody waiting for it (e.g. a background Excel/Graph call during a
// network blip) would otherwise stop the whole API: log it and keep serving.
process.on('unhandledRejection', (reason) => {
  logger.error(`Unhandled promise rejection (the API keeps running): ${reason?.stack || reason}`);
});
// A thrown error nothing caught leaves the process in an unknown state: log it and exit, so the
// service manager (systemd, Restart=always) starts a fresh API within seconds.
process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception, restarting: ${err?.stack || err}`);
  process.exit(1);
});

async function start() {
  try {
    await connectDatabase();

    if (env.autoMigrate) {
      // Development: apply database changes on every start (see `npm run migrate`)
      logResult(await runMigrations());
    } else {
      // Production: the database is changed only by `npm run migrate`; refuse to start without it
      const problems = await checkSchema();
      if (problems.length) {
        logger.error(`The database is not up to date (${problems.length} change(s) pending). Run "npm run migrate" first:`);
        problems.forEach((p) => logger.error(`  - ${p}`));
        process.exit(1);
      }
      await loadDepartments();
    }

    // Finds the Excel files in the scorecard folder
    const defaultWorkbook = await initWorkbooks();

    app.listen(env.port, env.host, () => {
      logger.info(`MCU Scorecard API running on http://${env.host}:${env.port}`);
      warmUpFormats(defaultWorkbook);
    });
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
}

start();
