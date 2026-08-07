const router = require('express').Router();
const ctrl = require('../controllers/storeController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');

router.use(authenticate, storeContext);

// Store admin: view and update own store (scoped by x-store-id)
router.get('/', ctrl.getOne);
router.put('/', requirePermission('store_settings', 'manage'), ctrl.update);
// Support PUT /stores/:id (frontend calls this)
router.put('/:id', requirePermission('store_settings', 'manage'), ctrl.updateById);

module.exports = router;
