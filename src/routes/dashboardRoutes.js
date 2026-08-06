const router = require('express').Router();
const ctrl = require('../controllers/dashboardController');
const { authenticate, storeContext } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/stats', ctrl.getStats);
router.get('/revenue', ctrl.getRevenue);
router.get('/payment-modes', ctrl.getPaymentModes);
router.get('/monthly', ctrl.getMonthly);
router.get('/recent-receipts', ctrl.getRecent);

module.exports = router;
