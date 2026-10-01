const { Router } = require('express');
const { body, param } = require('express-validator');
const workbooks = require('../controllers/workbook.controller');
const { STATUSES } = require('../services/workbook.service');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = Router();

// Admin Workbooks page: which files in the scorecard folder are released, and which opens first.
// (Everyone's file picker uses GET /api/strategy/workbooks.)
router.use(authenticate, authorize('admin'));

const idParam = param('id').isInt({ min: 1 });

router.get('/', workbooks.list);
router.put('/:id/status', idParam, body('status').isIn(STATUSES), validate, workbooks.setStatus);
router.put('/:id/default', idParam, validate, workbooks.setDefault);

module.exports = router;
