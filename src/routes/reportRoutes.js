const router = require('express').Router();
const ctrl = require('../controllers/reportController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');
const multer = require('multer');

const upload = multer({ storage: multer.memoryStorage() });

router.use(authenticate, storeContext);

// Export endpoints
router.get('/export/customers', requirePermission('reports', 'export'), ctrl.exportCustomers);
router.get('/export/receipts/excel', requirePermission('reports', 'export'), ctrl.exportReceiptsExcel);
router.get('/export/receipts/tally', requirePermission('reports', 'export'), ctrl.exportReceiptsTally);
router.get('/export/financial/excel', requirePermission('reports', 'export'), ctrl.exportFinancial);

// Import endpoints
router.get('/import/template/:type', requirePermission('reports', 'import'), ctrl.downloadImportTemplate);
router.post('/import/customers', requirePermission('reports', 'import'), upload.single('file'), ctrl.importCustomers);

module.exports = router;
