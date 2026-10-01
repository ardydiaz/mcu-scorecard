const { Router } = require('express');
const { body, param, query } = require('express-validator');
const rules = require('../controllers/accessRule.controller');
const { MATCH_TYPES } = require('../services/accessRule.service');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = Router();

// Admins manage every rule and the Row IDs; Department Heads ("manager" role) manage rules
// limited to their own department's rows (enforced in accessRule.service)
router.use(authenticate, authorize('admin', 'manager'));
const adminOnly = authorize('admin');

const sheetQuery = [
  query('sheet').isString().trim().isLength({ min: 1, max: 100 }),
  query('workbook').optional().isInt({ min: 1 }),
];
const ruleBody = [
  body('subjectType').isIn(['user', 'department']),
  body('userId').optional({ values: 'null' }).isInt({ min: 1 }),
  body('departmentCode').optional({ values: 'null' }).isString().isLength({ max: 20 }),
  // File: workbooks.id, or null for all files
  body('workbookId').optional({ values: 'null' }).isInt({ min: 1 }),
  body('sheet').optional({ values: 'null' }).isString().isLength({ max: 100 }),
  body('matchType').isIn(MATCH_TYPES),
  body('matchValues').isArray({ min: 1, max: 500 }),
  body('matchValues.*').isString().isLength({ max: 255 }),
  body('permission').isIn(['view', 'edit', 'hide']),
  body('note').optional({ values: 'null' }).isString().isLength({ max: 255 }),
];

router.get('/', rules.list);
router.post('/', ruleBody, validate, rules.create);
router.put('/:id', param('id').isInt({ min: 1 }), ruleBody, validate, rules.update);
router.delete('/:id', param('id').isInt({ min: 1 }), validate, rules.remove);

router.get('/row-ids', adminOnly, sheetQuery, validate, rules.rowIdStatus);
router.post('/row-ids/assign', adminOnly,
  body('sheet').isString().trim().isLength({ min: 1, max: 100 }),
  body('workbook').optional().isInt({ min: 1 }),
  validate,
  rules.assignRowIds
);
router.get('/rows', sheetQuery, validate, rules.rows);
router.get('/options', sheetQuery, validate, rules.options);

module.exports = router;
