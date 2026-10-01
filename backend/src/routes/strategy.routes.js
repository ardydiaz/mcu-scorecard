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
const FONTS = ['Calibri', 'Cambria', 'Aptos', 'Arial', 'Segoe UI', 'Times New Roman', 'Verdana', 'Tahoma'];
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

router.patch('/grid/format',
  body('sheet').isString().trim().isLength({ min: 1, max: 100 }),
  body('row').isInt({ min: 2 }).toInt(),
  body('column').isString().matches(/^[A-Z]{1,3}$/),
  body('identity.lead').optional().isString(),
  body('identity.name').optional().isString(),
  body('format').isObject(),
  body('format').custom((f) => {
    const allowed = ['bold', 'italic', 'underline', 'fontName', 'fontSize', 'fontColor', 'fillColor', 'hAlign', 'vAlign', 'wrap'];
    const keys = Object.keys(f);
    if (!keys.length || keys.some((k) => !allowed.includes(k))) throw new Error('Unknown or empty format option');
    return true;
  }),
  body(['format.bold', 'format.italic', 'format.underline', 'format.wrap']).optional().isBoolean({ strict: true }),
  body('format.fontName').optional().isIn(FONTS),
  body('format.fontSize').optional().isFloat({ min: 6, max: 72 }).toFloat(),
  body('format.fontColor').optional().matches(HEX_COLOR),
  body('format.fillColor').optional({ values: 'null' }).matches(HEX_COLOR),
  body('format.hAlign').optional().isIn(['general', 'left', 'center', 'right']),
  body('format.vAlign').optional().isIn(['top', 'middle', 'bottom']),
  validate,
  strategy.formatGridCell
);
router.post('/grid/merge',
  body('sheet').isString().trim().isLength({ min: 1, max: 100 }),
  body('row').isInt({ min: 2 }).toInt(),
  body('endRow').optional().isInt({ min: 2 }).toInt(),
  body('endRow').optional().custom((end, { req }) => {
    if (end < req.body.row || end - req.body.row > 200) throw new Error('endRow must be from row to row + 200');
    return true;
  }),
  body(['startColumn', 'endColumn']).isString().matches(/^[A-Z]{1,3}$/),
  body('identities').optional().isArray({ max: 201 }),
  body(['identities.*.lead', 'identities.*.name']).optional().isString(),
  body(['merge', 'center', 'confirm']).optional().isBoolean({ strict: true }),
  validate,
  strategy.mergeGridCells
);
// Personal "hide rows" in the user's own view
router.put('/grid/hidden-rows',
  body('sheet').isString().trim().isLength({ min: 1, max: 100 }),
  body('hidden').isBoolean({ strict: true }),
  body('all').optional().isBoolean({ strict: true }),
  body('keys').optional().isArray({ max: 500 }),
  body('keys.*').optional().isString().isLength({ max: 300 }),
  validate,
  strategy.setHiddenRows
);
router.get('/map', sheetQuery, validate, strategy.getMap);

module.exports = router;
