const router = require('express').Router();
const auth = require('../controllers/authController');

router.post('/send-otp', auth.sendOtpHandler);
router.post('/login', auth.loginHandler);
router.post('/refresh', auth.refreshHandler);
router.post('/logout', auth.logoutHandler);

module.exports = router;
