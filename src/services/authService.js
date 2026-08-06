const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { generateToken, generateRefreshToken } = require('../utils/jwt');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendOtp = async (mobile) => {
  const [[user]] = await db.query('SELECT id, account_locked_until, first_login FROM users WHERE mobile = ?', [mobile]);
  if (!user) throw new Error('USER_NOT_FOUND');

  if (user.account_locked_until && new Date(user.account_locked_until) > new Date())
    throw new Error('ACCOUNT_LOCKED');

  const otp = generateOtp();
  const expiry = new Date(Date.now() + 5 * 60 * 1000);
  await db.query('UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?', [otp, expiry, user.id]);

  // In production: send via SMS. Dev: return in response.
  return { firstLogin: !!user.first_login, otp };
};

const login = async ({ mobile, password, otp, newPassword }) => {
  const [[user]] = await db.query('SELECT * FROM users WHERE mobile = ?', [mobile]);
  if (!user) throw new Error('USER_NOT_FOUND');
  if (!user.active) throw new Error('ACCOUNT_INACTIVE');

  if (user.account_locked_until && new Date(user.account_locked_until) > new Date())
    throw new Error('ACCOUNT_LOCKED');

  // First login: OTP + set new password
  if (user.first_login) {
    if (!otp) throw new Error('OTP_REQUIRED');
    if (user.otp_code !== otp || new Date(user.otp_expires_at) < new Date()) {
      await _incrementFailedAttempts(user);
      throw new Error('INVALID_OTP');
    }
    if (!newPassword) throw new Error('NEW_PASSWORD_REQUIRED');
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query(
      'UPDATE users SET password_hash = ?, first_login = FALSE, failed_login_attempts = 0, otp_code = NULL, otp_expires_at = NULL WHERE id = ?',
      [hash, user.id]
    );
    return _buildLoginResponse({ ...user, first_login: false });
  }

  // Regular login
  if (!password) throw new Error('PASSWORD_REQUIRED');
  const valid = user.password_hash && (
    password === user.password_hash ||          // plain-text dev fallback
    await bcrypt.compare(password, user.password_hash)
  );
  if (!valid) {
    await _incrementFailedAttempts(user);
    throw new Error('INVALID_PASSWORD');
  }
  await db.query('UPDATE users SET failed_login_attempts = 0 WHERE id = ?', [user.id]);
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
    const storeId = role.store_id;
    // For SUPER_ADMIN (store_id NULL), load all permissions
    const [perms] = await db.query(
      `SELECT p.resource, p.action FROM permissions p
       JOIN role_permissions rp ON rp.permission_id = p.id
       WHERE rp.role_id = ?`,
      [role.id]
    );
    return { name: role.name, store_id: storeId, store_name: role.store_name, permissions: perms };
  }));

  const storeIds = [...new Set(roleRows.map(r => r.store_id).filter(Boolean))];
  const stores = storeIds.length
    ? (await db.query(`SELECT id, name, subscription_status FROM stores WHERE id IN (${storeIds.map(() => '?').join(',')})`, storeIds))[0]
    : [];

  return {
    user: { id: user.id, name: user.name, mobile: user.mobile },
    roles,
    stores,
    token: generateToken({ userId: user.id, mobile: user.mobile }),
    refreshToken: generateRefreshToken({ userId: user.id, mobile: user.mobile }),
  };
};

const refreshToken = async (token) => {
  const { verifyToken } = require('../utils/jwt');
  const decoded = verifyToken(token);
  const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [decoded.userId]);
  if (!user) throw new Error('USER_NOT_FOUND');
  return _buildLoginResponse(user);
};

module.exports = { sendOtp, login, refreshToken };
