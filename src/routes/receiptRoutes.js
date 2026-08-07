const router = require('express').Router();
const ctrl = require('../controllers/receiptController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/pending-approvals', ctrl.getPending);
router.get('/by-date', ctrl.getByDateRange);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getById);
router.get('/:id/pdf', ctrl.getPdf);
router.get('/:id/approvals', ctrl.getApprovals);
router.post('/', requirePermission('receipts', 'create'), ctrl.create);
router.post('/:id/approve', requirePermission('receipts', 'approve'), ctrl.approve);
router.post('/:id/reject', requirePermission('receipts', 'approve'), ctrl.reject);
router.post('/:id/state-change', requirePermission('receipts', 'approve'), ctrl.stateChange);
router.post('/:id/pay', requirePermission('receipts', 'approve'), ctrl.pay);

// Direct edit/delete not allowed — use /api/change-requests
router.put('/:id', ctrl.notAllowed);
router.delete('/:id', ctrl.notAllowed);

module.exports = router;
