const router = require('express').Router();
const auth = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/login', auth.loginHandler);
router.post('/change-password', authenticate, auth.changePasswordHandler);
router.post('/refresh', auth.refreshHandler);
router.post('/logout', auth.logoutHandler);

module.exports = router;
