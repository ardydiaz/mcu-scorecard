const logger = require('../utils/logger');
const env = require('../config/env');

function notFound(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  logger.error(err);
  const message = err.type === 'entity.parse.failed'
    ? 'Request body is not valid JSON'
    : status === 500 ? 'Internal server error' : err.message;
  res.status(status).json({
    message,
    // Extra fields a client needs to act on the error, e.g. { code: 'CONFIRM_MERGE', lost: [...] }
    ...(status < 500 && err.data),
    ...(env.nodeEnv === 'development' && { stack: err.stack }),
  });
}

module.exports = { notFound, errorHandler };
