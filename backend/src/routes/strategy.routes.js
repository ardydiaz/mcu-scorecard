const { Router } = require('express');
const { body, query } = require('express-validator');
const strategy = require('../controllers/strategy.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = Router();

router.use(authenticate);

const sheetQuery = query('sheet').optional().isString().trim().isLength({ min: 1, max: 100 });

router.get('/sheets', strategy.listSheets);
router.get('/workbook', strategy.getWorkbook);
router.get('/scorecard',
  sheetQuery,
  query('department').optional().isString().trim().isLength({ min: 1, max: 20 }),
  validate,
  strategy.getScorecard
);
router.get('/grid',
  query('sheet').isString().trim().isLength({ min: 1, max: 100 }),
  query('department').optional().isString().trim().isLength({ min: 1, max: 20 }),
  validate,
  strategy.getGrid
);
router.patch('/grid/cell',
  body('sheet').isString().trim().isLength({ min: 1, max: 100 }),
  body('row').isInt({ min: 2 }).toInt(),
  body('column').isString().matches(/^[A-Z]{1,3}$/),
  body('value').isString(),
  body('previous').optional().isString(),
  body('identity.lead').optional().isString(),
  body('identity.name').optional().isString(),
  validate,
  strategy.updateGridCell
);
router.get('/map', sheetQuery, validate, strategy.getMap);

module.exports = router;
