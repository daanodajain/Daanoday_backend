const router = require('express').Router();
const ctrl = require('../controllers/changeRequestController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/', requirePermission('receipts', 'change_request'), ctrl.create);
router.post('/:id/approve', requirePermission('change_requests', 'approve'), ctrl.approve);
router.post('/:id/reject', requirePermission('change_requests', 'approve'), ctrl.reject);

module.exports = router;
