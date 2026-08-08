const router = require('express').Router();
const ctrl = require('../controllers/challanController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/by-date', ctrl.getByDateRange);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getById);
router.post('/', requirePermission('challans', 'create'), ctrl.create);
router.post('/:id/approve', requirePermission('challans', 'approve'), ctrl.approve);
router.post('/:id/reject', requirePermission('challans', 'approve'), ctrl.reject);

// Direct edit/delete not allowed — use /api/change-requests
router.put('/:id', ctrl.notAllowed);
router.delete('/:id', ctrl.notAllowed);

module.exports = router;
