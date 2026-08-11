const router = require('express').Router();
const multer = require('multer');
const ctrl = require('../controllers/reportController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.use(authenticate, storeContext);

router.get('/receipts', requirePermission('reports', 'read'), ctrl.getReceipts);
router.get('/financial', requirePermission('reports', 'read'), ctrl.getFinancial);
router.get('/customer-history/:customerId', requirePermission('reports', 'read'), ctrl.getCustomerHistory);
router.get('/export/receipts', requirePermission('reports', 'export'), ctrl.exportReceiptsExcel);
router.get('/export/receipts/excel', requirePermission('reports', 'export'), ctrl.exportReceiptsExcel);
router.get('/export/receipts/tally', requirePermission('reports', 'export'), ctrl.exportReceiptsTally);
router.get('/export/financial', requirePermission('reports', 'export'), ctrl.exportFinancialExcel);
router.get('/export/financial/excel', requirePermission('reports', 'export'), ctrl.exportFinancialExcel);
router.get('/export/challans', requirePermission('reports', 'export'), ctrl.exportChallans);
router.get('/export/customers', requirePermission('reports', 'export'), ctrl.exportCustomers);
router.get('/export/suppliers', requirePermission('reports', 'export'), ctrl.exportSuppliers);
router.get('/export/transactions', requirePermission('reports', 'export'), ctrl.exportTransactions);
router.get('/import/template/:type', requirePermission('reports', 'import'), ctrl.downloadTemplate);
router.post('/import/:type', requirePermission('reports', 'import'), upload.single('file'), ctrl.importData);

module.exports = router;
