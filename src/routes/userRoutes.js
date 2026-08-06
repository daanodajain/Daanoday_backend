const router = require('express').Router();
const ctrl = require('../controllers/userController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/', requirePermission('users', 'read'), ctrl.getAll);
router.get('/:id', requirePermission('users', 'read'), ctrl.getOne);
router.post('/', requirePermission('users', 'create'), ctrl.create);
router.put('/:id', requirePermission('users', 'update'), ctrl.update);
router.delete('/:id', requirePermission('users', 'delete'), ctrl.remove);
router.patch('/:id/toggle-status', requirePermission('users', 'update'), ctrl.toggleStatus);
router.post('/:id/assign-role', requirePermission('roles', 'manage'), ctrl.assignRole);

module.exports = router;
