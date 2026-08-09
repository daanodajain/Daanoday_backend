const db = require('../config/db');
const auditLog = require('./auditLogService');

const getAllRoles = async (storeId) => {
  const [rows] = await db.query(
    `SELECT r.id, r.name, r.store_id 
     FROM roles r 
     WHERE (r.store_id = ? OR r.store_id IS NULL) 
     AND UPPER(TRIM(r.name)) != 'SUPER_ADMIN' 
     ORDER BY r.name ASC`,
    [storeId]
  );
  return rows;
};

const getRoleById = async (id, storeId) => {
  const [[role]] = await db.query(
    "SELECT id, name, store_id FROM roles WHERE id = ? AND (store_id = ? OR store_id IS NULL) AND name != 'SUPER_ADMIN'",
    [id, storeId]
  );
  if (!role) throw new Error('ROLE_NOT_FOUND');
  return role;
};

const RESERVED_ROLE_NAMES = ['SUPER_ADMIN'];

const createRole = async (storeId, data, userId) => {
  const name = (data.name || '').trim();
  if (!name) throw new Error('ROLE_NAME_REQUIRED');
  if (RESERVED_ROLE_NAMES.includes(name.toUpperCase())) {
    throw new Error('RESERVED_ROLE_NAME');
  }
  const [result] = await db.query(
    'INSERT INTO roles (store_id, name) VALUES (?, ?)',
    [storeId, name]
  );

  // Self-check: immediately re-read what actually landed in the row.
  const [[verify]] = await db.query('SELECT name FROM roles WHERE id = ?', [result.insertId]);
  if (!verify || verify.name !== name) {
    throw new Error(
      `SAVE_MISMATCH: sent="${name}" insertId=${result.insertId} actualDbValue="${verify ? verify.name : 'ROW_MISSING'}"`
    );
  }

  await auditLog.log({ storeId, userId, action: 'ROLE_CREATED', entityType: 'ROLE', entityId: result.insertId });
  return { id: result.insertId, name: verify.name, store_id: storeId };
};

const updateRole = async (id, storeId, data, userId) => {
  const name = (data.name || '').trim();
  if (!name) throw new Error('ROLE_NAME_REQUIRED');
  if (RESERVED_ROLE_NAMES.includes(name.toUpperCase())) {
    throw new Error('RESERVED_ROLE_NAME');
  }
  const [[role]] = await db.query('SELECT id FROM roles WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!role) throw new Error('ROLE_NOT_FOUND');

  const [updateResult] = await db.query('UPDATE roles SET name = ? WHERE id = ?', [name, id]);

  // Self-check: immediately re-read what actually landed in the row.
  // If it doesn't match what we just wrote, surface the exact mismatch
  // instead of silently returning something wrong.
  const [[verify]] = await db.query('SELECT name FROM roles WHERE id = ?', [id]);
  if (!verify || verify.name !== name) {
    throw new Error(
      `SAVE_MISMATCH: sent="${name}" affectedRows=${updateResult.affectedRows} actualDbValue="${verify ? verify.name : 'ROW_MISSING'}"`
    );
  }

  await auditLog.log({ storeId, userId, action: 'ROLE_UPDATED', entityType: 'ROLE', entityId: id });
  return { id: Number(id), name: verify.name, store_id: storeId };
};

const deleteRole = async (id, storeId, userId) => {
  const [[role]] = await db.query('SELECT id FROM roles WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!role) throw new Error('ROLE_NOT_FOUND');
  // Check if any user has this role
  const [[inUse]] = await db.query('SELECT id FROM user_roles WHERE role_id = ? LIMIT 1', [id]);
  if (inUse) throw new Error('ROLE_IN_USE');
  await db.query('DELETE FROM role_permissions WHERE role_id = ?', [id]);
  await db.query('DELETE FROM roles WHERE id = ?', [id]);
  await auditLog.log({ storeId, userId, action: 'ROLE_DELETED', entityType: 'ROLE', entityId: id });
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

const assignPermissions = async (roleId, storeId, permissionIds, assignedByUserId) => {
  const [[role]] = await db.query('SELECT id FROM roles WHERE id = ? AND store_id = ?', [roleId, storeId]);
  if (!role) throw new Error('ROLE_NOT_FOUND');

  const requestedIds = (permissionIds || []).map(id => Number(id)).sort((a, b) => a - b);

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query('DELETE FROM role_permissions WHERE role_id = ?', [roleId]);
    if (requestedIds.length) {
      const vals = requestedIds.map(pid => [roleId, pid]);
      await conn.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [vals]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }

  // Self-check: immediately re-read what actually landed, same pattern as
  // createRole/updateRole - surface an exact mismatch instead of a false success.
  const [verifyRows] = await db.query('SELECT permission_id FROM role_permissions WHERE role_id = ?', [roleId]);
  const actualIds = verifyRows.map(r => r.permission_id).sort((a, b) => a - b);
  const matches = requestedIds.length === actualIds.length &&
    requestedIds.every((id, i) => id === actualIds[i]);
  if (!matches) {
    throw new Error(
      `SAVE_MISMATCH: requestedIds=[${requestedIds.join(',')}] actualDbIds=[${actualIds.join(',')}]`
    );
  }

  await auditLog.log({ storeId, userId: assignedByUserId, action: 'ROLE_PERMISSIONS_UPDATED', entityType: 'ROLE', entityId: roleId });
  return actualIds;
};

// Assign multiple roles to a user in a store
const assignRolesToUser = async (userId, storeId, roleIds, assignedByUserId) => {
  // Security: only allow roles that are valid for this store and never SUPER_ADMIN,
  // regardless of what the client sends — prevents privilege escalation via direct API calls.
  if (roleIds.length) {
    const [validRoles] = await db.query(
      `SELECT id FROM roles WHERE id IN (${roleIds.map(() => '?').join(',')})
       AND (store_id = ? OR store_id IS NULL) AND name != 'SUPER_ADMIN'`,
      [...roleIds, storeId]
    );
    const validIds = new Set(validRoles.map(r => r.id));
    const invalid = roleIds.filter(rid => !validIds.has(rid));
    if (invalid.length) throw new Error('INVALID_ROLE_ASSIGNMENT');
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query('DELETE FROM user_roles WHERE user_id = ? AND store_id = ?', [userId, storeId]);
    if (roleIds.length) {
      const vals = roleIds.map(rid => [userId, rid, storeId]);
      await conn.query('INSERT INTO user_roles (user_id, role_id, store_id) VALUES ?', [vals]);
    }
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
  await auditLog.log({ storeId, userId: assignedByUserId, action: 'USER_ROLES_UPDATED', entityType: 'USER', entityId: userId });
};

// Get roles assigned to a user in a store
const getUserRoles = async (userId, storeId) => {
  const [rows] = await db.query(
    `SELECT r.id, r.name FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = ? AND ur.store_id = ?`,
    [userId, storeId]
  );
  return rows;
};

module.exports = { getAllRoles, getRoleById, createRole, updateRole, deleteRole, getAllPermissions, getRolePermissions, assignPermissions, assignRolesToUser, getUserRoles };
