const db = require('../config/db');
const auditLog = require('./auditLogService');

const getAllRoles = async (storeId) => {
  const [rows] = await db.query(
    'SELECT r.id, r.name, r.store_id FROM roles r WHERE r.store_id = ? OR r.store_id IS NULL',
    [storeId]
  );
  return rows;
};

const getAllPermissions = async () => {
  const [rows] = await db.query('SELECT * FROM permissions ORDER BY resource, action');
  return rows;
};

const getRolePermissions = async (roleId) => {
  const [rows] = await db.query(
    `SELECT p.* FROM permissions p
     JOIN role_permissions rp ON rp.permission_id = p.id
     WHERE rp.role_id = ?`,
    [roleId]
  );
  return rows;
};

// Assign permissions to a role (replaces existing)
const assignPermissions = async (roleId, storeId, permissionIds, assignedByUserId) => {
  const [[role]] = await db.query('SELECT id FROM roles WHERE id = ? AND store_id = ?', [roleId, storeId]);
  if (!role) throw new Error('ROLE_NOT_FOUND');

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
    if (permissionIds.length) {
      const vals = permissionIds.map(pid => [roleId, pid]);
      await conn.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [vals]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  await auditLog.log({ storeId, userId: assignedByUserId, action: 'ROLE_PERMISSIONS_UPDATED', entityType: 'ROLE', entityId: roleId });
};

module.exports = { getAllRoles, getAllPermissions, getRolePermissions, assignPermissions };
