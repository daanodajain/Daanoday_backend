const router = require('express').Router();
const auth = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

router.post('/login', auth.loginHandler);
router.post('/verify-first-login-otp', authenticate, auth.verifyFirstLoginOtpHandler);
router.post('/change-password', authenticate, auth.changePasswordHandler);
router.post('/refresh', auth.refreshHandler);
router.post('/logout', auth.logoutHandler);
router.post('/unlock', authenticate, auth.unlockHandler);

module.exports = router;
