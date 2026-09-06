const router = require('express').Router();
const ctrl = require('../controllers/customerAuthController');
const { authenticate } = require('../middleware/auth');

// Public routes
router.get('/config', ctrl.getConfig);
router.post('/send-otp', ctrl.sendOtp);
router.post('/login', ctrl.login);

// Protected - customer views own receipts
router.get('/my-receipts', authenticate, ctrl.getMyReceipts);

module.exports = router;
