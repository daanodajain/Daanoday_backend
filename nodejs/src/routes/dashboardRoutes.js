const router = require('express').Router();
const ctrl = require('../controllers/dashboardController');
const { authenticate, storeContext } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/stats', ctrl.getStats);
router.get('/revenue', ctrl.getRevenue);
router.get('/payment-modes', ctrl.getPaymentModes);
router.get('/monthly', ctrl.getMonthly);
router.get('/recent-receipts', ctrl.getRecent);
router.get('/pending-approvals', ctrl.getPendingApprovals);
router.get('/distribution/receipt-types', ctrl.getReceiptTypeDistribution);
router.get('/growth/customers', ctrl.getCustomerGrowth);
router.get('/trend/daily', ctrl.getDailyTrend);
router.get('/comparison/yearly', ctrl.getYearlyComparison);

module.exports = router;
