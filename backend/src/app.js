const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const env = require('./config/env');
const logger = require('./utils/logger');
const { notFound, errorHandler } = require('./middleware/error.middleware');

const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const strategyRoutes = require('./routes/strategy.routes');
const departmentRoutes = require('./routes/department.routes');
const auditRoutes = require('./routes/audit.routes');
const accessRuleRoutes = require('./routes/accessRule.routes');

const app = express();

app.use(helmet());
app.use(cors({ origin: env.clientUrl, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev', { stream: { write: (msg) => logger.http(msg.trim()) } }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/strategy', strategyRoutes);
app.use('/api/departments', departmentRoutes);
app.use('/api/audit-logs', auditRoutes);
app.use('/api/access-rules', accessRuleRoutes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
