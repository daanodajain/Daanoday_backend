const router = require('express').Router();
const ctrl = require('../controllers/superAdminController');
const { authenticate, requireSuperAdmin } = require('../middleware/auth');

router.use(authenticate, requireSuperAdmin);

// Stores CRUD
router.get('/stores', ctrl.getAllStores);
router.get('/stores/:id', ctrl.getStore);
router.post('/stores', ctrl.createStoreWithAdmin);
router.put('/stores/:id', ctrl.updateStoreWithAdmin);
router.delete('/stores/:id', ctrl.deleteStore);

// System settings
router.get('/system-settings', ctrl.getSystemSettings);
router.post('/system-settings', ctrl.upsertSystemSetting);

// Subscriptions
router.get('/subscriptions', ctrl.getAllSubscriptions);
router.post('/subscriptions/:storeId', ctrl.upsertSubscription);
router.put('/subscriptions/:storeId', ctrl.upsertSubscription);
router.post('/subscriptions/:storeId/extend', ctrl.extendSubscription);
router.post('/subscriptions/:storeId/suspend', ctrl.suspendSubscription);

module.exports = router;
