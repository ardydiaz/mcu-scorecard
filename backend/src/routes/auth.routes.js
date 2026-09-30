const { Router } = require('express');
const auth = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth.middleware');

const router = Router();

router.post('/microsoft', auth.microsoftLogin);
router.get('/me', authenticate, auth.me);

module.exports = router;
