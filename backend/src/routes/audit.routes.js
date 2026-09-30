const { Router } = require('express');
const { body, query } = require('express-validator');
const auditLogs = require('../controllers/audit.controller');
const { ACTIONS, CLIENT_ACTIONS } = require('../services/audit.service');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = Router();

router.use(authenticate);

// Any signed-in user: the browser reports page views and "Open in Excel" clicks
router.post('/activity',
  body('action').isIn(CLIENT_ACTIONS),
  body('target').optional().isString().isLength({ max: 255 }),
  body('details').optional().isObject(),
  body('details').optional().custom((d) => {
    if (JSON.stringify(d).length > 1000) throw new Error('Details too large');
    return true;
  }),
  validate,
  auditLogs.recordActivity
);

// Reading the audit log is for admins only
const filterRules = [
  query('q').optional().isString().trim().isLength({ max: 100 }),
  query('action').optional().isIn(Object.keys(ACTIONS)),
  query('userId').optional().isInt({ min: 1 }),
  query(['from', 'to']).optional().isISO8601({ strict: true }),
];

router.get('/', authorize('admin'), filterRules, validate, auditLogs.list);
router.get('/export', authorize('admin'), filterRules, validate, auditLogs.exportCsv);

module.exports = router;
