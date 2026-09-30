const { Router } = require('express');
const { param, body } = require('express-validator');
const users = require('../controllers/user.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

const router = Router();
const idParam = param('id').isInt({ min: 1 });

router.use(authenticate);

router.get('/', authorize('admin', 'manager'), users.list);
router.post('/sync', authorize('admin'), users.syncFromAzure);
router.get('/:id', idParam, validate, users.getById);

router.patch('/:id',
  authorize('admin'),
  idParam,
  body('role').optional().isIn(['admin', 'manager', 'user']),
  body('isActive').optional().isBoolean(),
  validate,
  users.update
);

router.put('/:id/departments',
  authorize('admin'),
  idParam,
  body('departmentIds').isArray(),
  body('departmentIds.*').isInt({ min: 1 }),
  validate,
  users.setDepartments
);

module.exports = router;
