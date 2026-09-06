const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { generateToken, generateRefreshToken } = require('../utils/jwt');

// Login with email OR mobile + password
const { getBoolSetting } = require('../utils/systemSettings');

const login = async ({ identifier, password }) => {
  if (!identifier || !password) throw new Error('CREDENTIALS_REQUIRED');

  // Find user by email or mobile
  const [[user]] = await db.query(
    'SELECT * FROM users WHERE email = ? OR mobile = ?',
    [identifier, identifier]
  );

  // Not a staff user? One login page serves everyone — fall back to the
  // customers table before giving up, so customers can log in from the
  // same form instead of needing a separate endpoint/page.
  if (!user) return _customerFallbackLogin(identifier, password);

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
  response.user.userType = 'STAFF';

  // If first_login — signal frontend to show change password (with OTP step if enabled)
  if (user.first_login) {
    const otpEnabled = await getBoolSetting('OTP_LOGIN_ENABLED', false);
    if (otpEnabled) {
      // Generate OTP and store it (in prod: send via SMS/email)
      const otp = Math.floor(100000 + Math.random() * 900000).toString();
      await db.query(
        'UPDATE users SET otp_code = ?, otp_expires_at = ? WHERE id = ?',
        [otp, new Date(Date.now() + 5 * 60 * 1000), user.id]
      );
      return { ...response, requirePasswordChange: true, otpEnabled: true, otp }; // otp for dev only
    }
    return { ...response, requirePasswordChange: true, otpEnabled: false };
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

// Same login form, customer identity: checked only when the identifier
// doesn't match any staff user. Mirrors customerAuthService.login's
// returning-customer path, but keyed by email OR mobile (staff-style).
const _customerFallbackLogin = async (identifier, password) => {
  const [[customer]] = await db.query(
    'SELECT * FROM customers WHERE email = ? OR mobile = ?',
    [identifier, identifier]
  );
  if (!customer) throw new Error('USER_NOT_FOUND');

  // First-time customer hasn't set a password yet — they still need the
  // one-time OTP setup step (separate from day-to-day login).
  if (customer.first_login || !customer.password_hash) {
    throw new Error('CUSTOMER_FIRST_LOGIN_SETUP_REQUIRED');
  }

  const valid = await bcrypt.compare(password, customer.password_hash);
  if (!valid) throw new Error('INVALID_PASSWORD');

  const [storeAccess] = await db.query(
    `SELECT csa.store_id, csa.account_number, csa.is_primary_store, s.name as store_name
     FROM customer_store_access csa
     JOIN stores s ON s.id = csa.store_id
     WHERE csa.customer_id = ?`,
    [customer.id]
  );

  return {
    user: {
      id: customer.id, name: customer.name, email: customer.email,
      mobile: customer.mobile, userType: 'CUSTOMER',
    },
    roles: [],
    stores: [],
    storeAccess,
    token: generateToken({ userId: customer.id, mobile: customer.mobile, userType: 'CUSTOMER' }),
    refreshToken: generateRefreshToken({ userId: customer.id, mobile: customer.mobile, userType: 'CUSTOMER' }),
  };
};

const _incrementFailedAttempts = async (user) => {
  const attempts = (user.failed_login_attempts || 0) + 1;
  const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null;
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
  // Customer refresh
  if (decoded.userType === 'CUSTOMER') {
    const [[customer]] = await db.query('SELECT id, name, mobile, email FROM customers WHERE id = ?', [decoded.userId]);
    if (!customer) throw new Error('CUSTOMER_NOT_FOUND');
    const [storeAccess] = await db.query(
      `SELECT csa.store_id, csa.account_number, csa.is_primary_store, s.name as store_name
       FROM customer_store_access csa JOIN stores s ON s.id = csa.store_id
       WHERE csa.customer_id = ?`, [customer.id]
    );
    const { generateToken, generateRefreshToken } = require('../utils/jwt');
    return {
      user: { ...customer, userType: 'CUSTOMER' },
      roles: [], stores: [], storeAccess,
      token: generateToken({ userId: customer.id, mobile: customer.mobile, userType: 'CUSTOMER' }),
      refreshToken: generateRefreshToken({ userId: customer.id, mobile: customer.mobile, userType: 'CUSTOMER' }),
    };
  }
  // Staff refresh
  const [[user]] = await db.query('SELECT * FROM users WHERE id = ?', [decoded.userId]);
  if (!user || !user.active) throw new Error('USER_NOT_FOUND');
  return _buildLoginResponse(user);
};

// Verify OTP for staff first login (OTP_LOGIN_ENABLED=true flow)
const verifyFirstLoginOtp = async (userId, otp) => {
  if (!otp || otp.length !== 6) throw new Error('INVALID_OTP_FORMAT');
  const [[user]] = await db.query('SELECT id, otp_code, otp_expires_at FROM users WHERE id = ?', [userId]);
  if (!user) throw new Error('USER_NOT_FOUND');
  if (!user.otp_code) throw new Error('NO_OTP_GENERATED');
  if (user.otp_code !== otp) throw new Error('INVALID_OTP');
  if (new Date(user.otp_expires_at) < new Date()) throw new Error('OTP_EXPIRED');
  await db.query('UPDATE users SET otp_code = NULL, otp_expires_at = NULL WHERE id = ?', [userId]);
  return { verified: true };
};

module.exports = { login, changePassword, refreshToken, verifyUnlockPassword, verifyFirstLoginOtp };
