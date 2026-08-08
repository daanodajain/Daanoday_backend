const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { generateToken, generateRefreshToken } = require('../utils/jwt');

// Login with email OR mobile + password
const login = async ({ identifier, password }) => {
  if (!identifier || !password) throw new Error('CREDENTIALS_REQUIRED');

  // Find user by email or mobile
  const [[user]] = await db.query(
    'SELECT * FROM users WHERE email = ? OR mobile = ?',
    [identifier, identifier]
  );
  if (!user) throw new Error('USER_NOT_FOUND');
  if (!user.active) throw new Error('ACCOUNT_INACTIVE');

  if (user.account_locked_until && new Date(user.account_locked_until) > new Date())
    throw new Error('ACCOUNT_LOCKED');

  // Verify password
  const valid = user.password_hash && await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    await _incrementFailedAttempts(user);
    throw new Error('INVALID_PASSWORD');
  }

  await db.query('UPDATE users SET failed_login_attempts = 0 WHERE id = ?', [user.id]);

  const response = await _buildLoginResponse(user);

  // If first_login — signal frontend to show change password
  if (user.first_login) {
    return { ...response, requirePasswordChange: true };
  }

  return response;
};

// Change password (first login or user-initiated)
const changePassword = async (userId, newPassword) => {
  const hash = await bcrypt.hash(newPassword, 10);
  await db.query(
    'UPDATE users SET password_hash = ?, first_login = FALSE, failed_login_attempts = 0 WHERE id = ?',
    [hash, userId]
  );
  const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
  return _buildLoginResponse(user);
};

const _incrementFailedAttempts = async (user) => {
  const attempts = (user.failed_login_attempts || 0) + 1;
  const lockUntil = attempts >= 5 ? new Date(Date.now() + 30 * 60 * 1000) : null;
  await db.query(
    'UPDATE users SET failed_login_attempts = ?, account_locked_until = ? WHERE id = ?',
    [attempts, lockUntil, user.id]
  );
};

const _buildLoginResponse = async (user) => {
  const [roleRows] = await db.query(
    `SELECT r.id, r.name, r.store_id, s.name as store_name
     FROM user_roles ur
     JOIN roles r ON r.id = ur.role_id
     LEFT JOIN stores s ON s.id = ur.store_id
     WHERE ur.user_id = ?`,
    [user.id]
  );

  const roles = await Promise.all(roleRows.map(async (role) => {
    const [perms] = await db.query(
      `SELECT p.resource, p.action FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ?`,
      [role.id]
    );
    return { name: role.name, store_id: role.store_id, store_name: role.store_name, permissions: perms };
  }));

  const storeIds = [...new Set(roleRows.map(r => r.store_id).filter(Boolean))];
  const stores = storeIds.length
    ? (await db.query(`SELECT id, name, subscription_status FROM stores WHERE id IN (${storeIds.map(() => '?').join(',')})`, storeIds))[0]
    : [];

  return {
    user: { id: user.id, name: user.name, email: user.email, mobile: user.mobile },
    roles,
    stores,
    token: generateToken({ userId: user.id }),
    refreshToken: generateRefreshToken({ userId: user.id }),
  };
};

// Verify password for an already-authenticated user (inactivity-lock unlock).
// Does NOT issue new tokens — the existing session token is still valid,
// this just confirms the person at the keyboard is still the account owner.
const verifyUnlockPassword = async (userId, password) => {
  if (!password) throw new Error('PASSWORD_REQUIRED');
  const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
  if (!user || !user.active) throw new Error('USER_NOT_FOUND');

  if (user.account_locked_until && new Date(user.account_locked_until) > new Date())
    throw new Error('ACCOUNT_LOCKED');

  const valid = user.password_hash && await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    await _incrementFailedAttempts(user);
    throw new Error('INVALID_PASSWORD');
  }
  await db.query('UPDATE users SET failed_login_attempts = 0 WHERE id = ?', [user.id]);
  return { message: 'Unlocked' };
};

const refreshToken = async (token) => {
  const { verifyToken } = require('../utils/jwt');
  const decoded = verifyToken(token);
  const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [decoded.userId]);
  if (!user || !user.active) throw new Error('USER_NOT_FOUND');
  return _buildLoginResponse(user);
};

module.exports = { login, changePassword, refreshToken, verifyUnlockPassword };
