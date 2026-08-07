const router = require('express').Router();
const ctrl = require('../controllers/reportController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/receipts', requirePermission('reports', 'read'), ctrl.getReceipts);
router.get('/financial', requirePermission('reports', 'read'), ctrl.getFinancial);
router.get('/customer-history/:customerId', requirePermission('reports', 'read'), ctrl.getCustomerHistory);
router.get('/export/receipts/excel', requirePermission('reports', 'export'), ctrl.exportReceiptsExcel);
router.get('/export/receipts/tally', requirePermission('reports', 'export'), ctrl.exportReceiptsTally);
router.get('/export/financial/excel', requirePermission('reports', 'export'), ctrl.exportFinancialExcel);
router.post('/import/:type', requirePermission('reports', 'import'), ctrl.importData);

module.exports = router;
