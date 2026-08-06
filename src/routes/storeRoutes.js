const router = require('express').Router();
const ctrl = require('../controllers/storeController');
const { authenticate, storeContext, requirePermission } = require('../middleware/auth');

router.use(authenticate, storeContext);

// Store admin can view and update their own store (scoped by x-store-id)
router.get('/', ctrl.getOne);
router.put('/', requirePermission('store_settings', 'manage'), ctrl.update);

module.exports = router;
