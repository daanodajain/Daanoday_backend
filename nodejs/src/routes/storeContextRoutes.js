const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const db = require('../config/db');
const { success, error } = require('../utils/response');

router.use(authenticate);

// POST /api/store-context/switch/:storeId
// Validates user has access to the requested store and returns store info
router.post('/switch/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;

    // Check user has a role in this store OR is SUPER_ADMIN
    const [roles] = await db.query(
      `SELECT r.name as role_name FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? AND ur.store_id = ?`,
      [req.user.id, storeId]
    );

    const [[superAdmin]] = await db.query(
      `SELECT r.name FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ? AND r.name = 'SUPER_ADMIN'`,
      [req.user.id]
    );

    if (!roles.length && !superAdmin) return error(res, 'FORBIDDEN_STORE', 403);

    const [[store]] = await db.query(
      'SELECT id, name, active, subscription_status FROM stores WHERE id = ?',
      [storeId]
    );
    if (!store) return error(res, 'STORE_NOT_FOUND', 404);
    if (!store.active) return error(res, 'STORE_INACTIVE', 403);

    success(res, {
      storeId: store.id,
      storeName: store.name,
      role: roles[0]?.role_name || 'SUPER_ADMIN',
      subscriptionStatus: store.subscription_status,
    });
  } catch (e) { error(res, e.message); }
});

module.exports = router;
