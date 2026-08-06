const router = require('express').Router();
const ctrl = require('../controllers/roleController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/permissions', ctrl.getPermissions);
router.get('/', ctrl.getAll);
router.get('/:id/permissions', ctrl.getRolePermissions);
router.post('/:id/permissions', requirePermission('roles', 'manage'), ctrl.assignPermissions);

module.exports = router;
