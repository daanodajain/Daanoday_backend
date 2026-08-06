const router = require('express').Router();
const ctrl = require('../controllers/customerController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');

router.use(authenticate, storeContext);

router.get('/search', ctrl.search);
router.get('/', requirePermission('customers', 'read'), ctrl.getAll);
router.get('/:id', requirePermission('customers', 'read'), ctrl.getById);
router.post('/', requirePermission('customers', 'create'), ctrl.create);
router.put('/:id', requirePermission('customers', 'update'), ctrl.update);
router.delete('/:id', requirePermission('customers', 'delete'), ctrl.remove);

module.exports = router;
