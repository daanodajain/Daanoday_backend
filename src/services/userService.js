const db = require('../config/db');
const bcrypt = require('bcryptjs');
const auditLog = require('./auditLogService');

const getAllUsers = async (storeId, currentUserId) => {
  const [rows] = await db.query(
    `SELECT DISTINCT u.id, u.name, u.email, u.mobile, u.active, u.first_login, u.created_at,
            r.name as role_name
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.store_id = ?
     JOIN roles r ON r.id = ur.role_id
     WHERE u.id != ? AND r.name != 'SUPER_ADMIN'
     ORDER BY u.name`,
    [storeId, currentUserId || 0]
  );
  return rows;
};

const getUserById = async (id) => {
  const [[user]] = await db.query(
    'SELECT id, name, email, mobile, active, first_login, created_at FROM users WHERE id = ?',
    [id]
  );
  if (!user) throw new Error('USER_NOT_FOUND');
  return user;
};

const createUser = async (userData, storeId, createdByUserId) => {
  // Check email or mobile duplicate
  if (userData.email) {
    const [[byEmail]] = await db.query('SELECT id FROM users WHERE email = ?', [userData.email]);
    if (byEmail) throw new Error('EMAIL_ALREADY_REGISTERED');
  }
  if (userData.mobile) {
    const [[byMobile]] = await db.query('SELECT id FROM users WHERE mobile = ?', [userData.mobile]);
    if (byMobile) throw new Error('MOBILE_ALREADY_REGISTERED');
  }

  // Hash the initial password
  const hash = await bcrypt.hash(userData.password, 10);

  const [result] = await db.query(
    'INSERT INTO users (name, email, mobile, password_hash, active, first_login) VALUES (?, ?, ?, ?, TRUE, TRUE)',
    [userData.name, userData.email || null, userData.mobile || null, hash]
  );
  const userId = result.insertId;

  // Assign role in this store — validated: must belong to this store (or be global-but-not-SUPER_ADMIN)
  if (userData.roleId) {
    const [[validRole]] = await db.query(
      "SELECT id FROM roles WHERE id = ? AND (store_id = ? OR store_id IS NULL) AND name != 'SUPER_ADMIN'",
      [userData.roleId, storeId]
    );
    if (!validRole) throw new Error('INVALID_ROLE_ASSIGNMENT');
    await db.query(
      'INSERT INTO user_roles (user_id, role_id, store_id) VALUES (?, ?, ?)',
      [userId, userData.roleId, storeId]
    );
  }

  await auditLog.log({ storeId, userId: createdByUserId, action: 'USER_CREATED', entityType: 'USER', entityId: userId });
  return getUserById(userId);
};

const updateUser = async (id, userData, updatedByUserId, storeId) => {
  const [[existing]] = await db.query('SELECT id FROM users WHERE id = ?', [id]);
  if (!existing) throw new Error('USER_NOT_FOUND');
  await db.query(
    'UPDATE users SET name = ?, email = ?, mobile = ? WHERE id = ?',
    [userData.name, userData.email || null, userData.mobile || null, id]
  );
  await auditLog.log({ storeId, userId: updatedByUserId, action: 'USER_UPDATED', entityType: 'USER', entityId: id });
  return getUserById(id);
};

const deleteUser = async (id, deletedByUserId, storeId) => {
  const [[existing]] = await db.query('SELECT id FROM users WHERE id = ?', [id]);
  if (!existing) throw new Error('USER_NOT_FOUND');
  await db.query('UPDATE users SET active = FALSE WHERE id = ?', [id]);
  await auditLog.log({ storeId, userId: deletedByUserId, action: 'USER_DELETED', entityType: 'USER', entityId: id });
};

const toggleUserStatus = async (id, requestingUserId) => {
  if (String(id) === String(requestingUserId)) {
    throw new Error('CANNOT_DEACTIVATE_SELF');
  }
  const [[user]] = await db.query('SELECT id, active FROM users WHERE id = ?', [id]);
  if (!user) throw new Error('USER_NOT_FOUND');
  await db.query('UPDATE users SET active = ? WHERE id = ?', [!user.active, id]);
  return { active: !user.active };
};

const assignRoleInStore = async (userId, storeId, roleId, assignedByUserId) => {
  // Security: only allow roles valid for this store and never SUPER_ADMIN — mirrors
  // the same guard in roleService.assignRolesToUser. This endpoint must never be a
  // bypass for privilege escalation.
  const [[validRole]] = await db.query(
    "SELECT id FROM roles WHERE id = ? AND (store_id = ? OR store_id IS NULL) AND name != 'SUPER_ADMIN'",
    [roleId, storeId]
  );
  if (!validRole) throw new Error('INVALID_ROLE_ASSIGNMENT');

  await db.query('DELETE FROM user_roles WHERE user_id = ? AND store_id = ?', [userId, storeId]);
  await db.query('INSERT INTO user_roles (user_id, role_id, store_id) VALUES (?, ?, ?)', [userId, roleId, storeId]);
  await auditLog.log({ storeId, userId: assignedByUserId, action: 'ROLE_CHANGED', entityType: 'USER', entityId: userId, details: { roleId } });
};

module.exports = { getAllUsers, getUserById, createUser, updateUser, deleteUser, toggleUserStatus, assignRoleInStore };
