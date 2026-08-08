const { verifyToken } = require('../utils/jwt');
const { error } = require('../utils/response');
const db = require('../config/db');

const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return error(res, 'UNAUTHORIZED', 401);

  try {
    const decoded = verifyToken(authHeader.split(' ')[1]);
    const [[user]] = await db.query(
      'SELECT id, name, mobile, active FROM users WHERE id = ?',
      [decoded.userId]
    );
    if (!user || !user.active) return error(res, 'USER_NOT_FOUND', 401);
    req.user = { ...decoded, ...user };
    next();
  } catch {
    return error(res, 'INVALID_TOKEN', 401);
  }
};

// Resolves storeId from x-store-id header and validates user has a role there.
// SUPER_ADMIN (role name) is allowed in any store.
const storeContext = async (req, res, next) => {
  const storeId = req.headers['x-store-id'];
  if (!storeId) return error(res, 'STORE_ID_REQUIRED', 400);

  // Check user has a role in this store OR is SUPER_ADMIN
  const [rows] = await db.query(
    `SELECT r.name as role_name FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? AND ur.store_id = ?`,
    [req.user.id, storeId]
  );

  // Also check global SUPER_ADMIN role (store_id IS NULL)
  const [[superAdminRole]] = await db.query(
    `SELECT r.name FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? AND r.name = 'SUPER_ADMIN'`,
    [req.user.id]
  );

  if (!rows.length && !superAdminRole) return error(res, 'FORBIDDEN_STORE', 403);

  req.storeId = storeId;
  req.userRoleInStore = rows[0]?.role_name || 'SUPER_ADMIN';
  next();
};

// Permission check: resolves by user_id + storeId from context
const requirePermission = (resource, action) => async (req, res, next) => {
  const storeId = req.storeId || req.headers['x-store-id'];

  // SUPER_ADMIN always passes
  if (req.userRoleInStore === 'SUPER_ADMIN') return next();

  const [rows] = await db.query(
    `SELECT p.id FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     JOIN user_roles ur ON ur.role_id = rp.role_id
     WHERE ur.user_id = ? AND ur.store_id = ?
       AND p.resource = ? AND p.action = ?`,
    [req.user.id, storeId, resource, action]
  );

  if (!rows.length) return error(res, 'FORBIDDEN', 403);
  next();
};

module.exports = { authenticate, storeContext, requirePermission };
