const db = require('../config/db');
const bcrypt = require('bcryptjs');
const auditLog = require('./auditLogService');

const getAllUsers = async (storeId) => {
  const [rows] = await db.query(
    `SELECT DISTINCT u.id, u.name, u.mobile, u.active, u.first_login, u.linked_customer_id, u.created_at,
            r.name as role_name
     FROM users u
     JOIN user_roles ur ON ur.user_id = u.id AND ur.store_id = ?
     JOIN roles r ON r.id = ur.role_id
     ORDER BY u.name`,
    [storeId]
  );
  return rows;
};

const getUserById = async (id) => {
  const [[user]] = await db.query(
    'SELECT id, name, mobile, active, first_login, linked_customer_id, created_at FROM users WHERE id = ?',
    [id]
  );
  if (!user) throw new Error('USER_NOT_FOUND');
  return user;
};

const createUser = async (userData, storeId, createdByUserId) => {
  const [[existing]] = await db.query('SELECT id FROM users WHERE mobile = ?', [userData.mobile]);
  if (existing) throw new Error('MOBILE_ALREADY_REGISTERED');

  const [result] = await db.query(
    'INSERT INTO users (name, mobile, active, first_login) VALUES (?, ?, TRUE, TRUE)',
    [userData.name, userData.mobile]
  );
  const userId = result.insertId;

  // Assign role in this store
  if (userData.roleId) {
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
  await db.query('UPDATE users SET name = ?, mobile = ? WHERE id = ?', [userData.name, userData.mobile, id]);
  await auditLog.log({ storeId, userId: updatedByUserId, action: 'USER_UPDATED', entityType: 'USER', entityId: id });
  return getUserById(id);
};

const deleteUser = async (id, deletedByUserId, storeId) => {
  const [[existing]] = await db.query('SELECT id FROM users WHERE id = ?', [id]);
  if (!existing) throw new Error('USER_NOT_FOUND');
  await db.query('UPDATE users SET active = FALSE WHERE id = ?', [id]);
  await auditLog.log({ storeId, userId: deletedByUserId, action: 'USER_DELETED', entityType: 'USER', entityId: id });
};

const toggleUserStatus = async (id) => {
  const [[user]] = await db.query('SELECT id, active FROM users WHERE id = ?', [id]);
  if (!user) throw new Error('USER_NOT_FOUND');
  await db.query('UPDATE users SET active = ? WHERE id = ?', [!user.active, id]);
  return { active: !user.active };
};

// Assign user to a store with a specific role
const assignRoleInStore = async (userId, storeId, roleId, assignedByUserId) => {
  // Remove existing role for this user in this store first
  await db.query('DELETE FROM user_roles WHERE user_id = ? AND store_id = ?', [userId, storeId]);
  await db.query('INSERT INTO user_roles (user_id, role_id, store_id) VALUES (?, ?, ?)', [userId, roleId, storeId]);
  await auditLog.log({ storeId, userId: assignedByUserId, action: 'ROLE_CHANGED', entityType: 'USER', entityId: userId, details: { roleId } });
};

module.exports = { getAllUsers, getUserById, createUser, updateUser, deleteUser, toggleUserStatus, assignRoleInStore };
