const { Router } = require('express');
const { body, query } = require('express-validator');
const operational = require('../controllers/operational.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = Router();

// Every signed-in user may see the Operational Dashboard and its Excel view; changes to the file are
// limited to admins and the ICT office (checked in operational.service)
router.use(authenticate);

const sheetBody = body('sheet').isString().trim().isLength({ min: 1, max: 100 });
const FONTS = ['Calibri', 'Cambria', 'Aptos', 'Arial', 'Segoe UI', 'Times New Roman', 'Verdana', 'Tahoma'];
const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

router.get('/', query('refresh').optional().isIn(['0', '1']), validate, operational.getDashboard);

router.get('/grid',
  query('sheet').optional().isString().trim().isLength({ min: 1, max: 100 }),
  query('refresh').optional().isIn(['0', '1']),
  validate,
  operational.getGrid
);
router.patch('/grid/cell',
  sheetBody,
  body('row').isInt({ min: 2 }).toInt(),
  body('column').isString().matches(/^[A-Z]{1,3}$/),
  body('value').isString(),
  body('previous').optional().isString(),
  body('identity.name').optional().isString(),
  validate,
  operational.updateCell
);
router.patch('/grid/format',
  sheetBody,
  body('row').isInt({ min: 2 }).toInt(),
  body('column').isString().matches(/^[A-Z]{1,3}$/),
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
  operational.formatCell
);
router.put('/grid/column-width',
  sheetBody,
  body('columns').isArray({ min: 1, max: 200 }),
  body('columns.*').isString().matches(/^[A-Z]{1,3}$/),
  body('width').if(body('autofit').not().equals('true')).isFloat({ min: 1, max: 5000 }).toFloat(),
  body('autofit').optional().isBoolean({ strict: true }),
  validate,
  operational.setColumnWidths
);
router.put('/grid/row-height',
  sheetBody,
  body('rows').isArray({ min: 1, max: 2000 }),
  body('rows.*').isInt({ min: 1, max: 1048576 }).toInt(),
  body('height').if(body('autofit').not().equals('true')).isFloat({ min: 1, max: 2000 }).toFloat(),
  body('autofit').optional().isBoolean({ strict: true }),
  validate,
  operational.setRowHeights
);

module.exports = router;
