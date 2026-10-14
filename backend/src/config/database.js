const { Sequelize } = require('sequelize');
const env = require('./env');
const logger = require('../utils/logger');

const sequelize = new Sequelize(env.db.name, env.db.user, env.db.password, {
  host: env.db.host,
  port: env.db.port,
  dialect: 'mysql',
  logging: env.nodeEnv === 'development' ? (msg) => logger.debug(msg) : false,
  define: { underscored: true, timestamps: true },
  // Idle connections are closed after 10 s and checked with TCP keep-alive, so a connection MySQL
  // dropped overnight (wait_timeout) is never reused; a query that hits a reset connection retries.
  pool: { max: 10, min: 0, idle: 10000, acquire: 30000, evict: 10000 },
  dialectOptions: { enableKeepAlive: true, keepAliveInitialDelay: 10000 },
  retry: { max: 3, match: [/ECONNRESET/, /PROTOCOL_CONNECTION_LOST/, /ETIMEDOUT/, /SequelizeConnectionError/] },
});

async function connectDatabase() {
  await sequelize.authenticate();
  logger.info(`Connected to MySQL database "${env.db.name}"`);
}

module.exports = { sequelize, connectDatabase };
