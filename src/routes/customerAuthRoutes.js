const router = require('express').Router();
const ctrl = require('../controllers/customerAuthController');
const { authenticate } = require('../middleware/auth');

// Public routes
router.get('/config', ctrl.getConfig);
router.post('/send-otp', ctrl.sendOtp);
router.post('/login', ctrl.login);

// NOTE: /my-receipts was here but is now served by /api/customer-profile/receipts
// which has ownership checked via customerAuth middleware. Dead route removed.

module.exports = router;
