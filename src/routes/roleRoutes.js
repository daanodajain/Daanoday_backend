const router = require('express').Router();
const ctrl = require('../controllers/roleController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/permissions', ctrl.getPermissions);
router.get('/users/:userId', ctrl.getUserRoles);
router.post('/users/:userId/roles', requirePermission('roles', 'manage'), ctrl.assignRolesToUser);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/', requirePermission('roles', 'manage'), ctrl.create);
router.put('/:id', requirePermission('roles', 'manage'), ctrl.update);
router.delete('/:id', requirePermission('roles', 'manage'), ctrl.remove);
router.get('/:id/permissions', ctrl.getRolePermissions);
router.post('/:id/permissions', requirePermission('roles', 'manage'), ctrl.assignPermissions);

module.exports = router;
