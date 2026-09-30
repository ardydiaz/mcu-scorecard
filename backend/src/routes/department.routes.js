const { Router } = require('express');
const { body, param } = require('express-validator');
const departments = require('../controllers/department.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = Router();

// Managing departments is for admins only (detailed checks are in department.service)
router.use(authenticate, authorize('admin'));

const idParam = param('id').isInt({ min: 1 });
const departmentBody = [
  body('code').isString().trim().notEmpty(),
  body('name').isString().trim().notEmpty(),
  body('description').optional({ values: 'null' }).isString(),
  body(['aliases', 'otherNames', 'leadCodes']).optional().isArray(),
  body(['aliases.*', 'otherNames.*', 'leadCodes.*']).optional().isString(),
  body('viewAll').optional().isBoolean({ strict: true }),
];

router.get('/', departments.list);
router.post('/', departmentBody, validate, departments.create);
router.put('/:id', idParam, departmentBody, validate, departments.update);
// Soft delete; POST /:id/restore brings the department back
router.delete('/:id', idParam, validate, departments.remove);
router.post('/:id/restore', idParam, validate, departments.restore);

module.exports = router;
