/**
 * Database migrations from the command line.
 *   npm run migrate          applies every pending change (safe to run again)
 *   npm run migrate:check    only reports what is missing; exits with code 1 when something is
 * Back up the database before migrating production. The database user needs CREATE, ALTER and INDEX.
 */
const logger = require('../utils/logger');
const { sequelize, connectDatabase } = require('../config/database');
require('../models');
const { runMigrations, checkSchema, logResult } = require('../config/migrate');

const checkOnly = process.argv.includes('--check');

(async () => {
  let code = 0;
  try {
    await connectDatabase();
    if (checkOnly) {
      const problems = await checkSchema();
      if (problems.length) {
        logger.warn(`The database needs ${problems.length} change(s); run "npm run migrate":`);
        problems.forEach((p) => logger.warn(`  - ${p}`));
        code = 1;
      } else {
        logger.info('The database is up to date; nothing to migrate.');
      }
    } else {
      const before = await checkSchema();
      logger.info(before.length ? `Applying ${before.length} database change(s)…` : 'Checking the database…');
      logResult(await runMigrations());
      const after = await checkSchema();
      if (after.length) {
        logger.error(`Still missing after migrating: ${after.join('; ')}`);
        code = 1;
      }
    }
  } catch (err) {
    logger.error(`Migration failed: ${err.message}`);
    code = 1;
  } finally {
    await sequelize.close().catch(() => {});
  }
  process.exit(code);
})();
