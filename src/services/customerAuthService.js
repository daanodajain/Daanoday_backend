const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { generateToken, generateRefreshToken } = require('../utils/jwt');
const { getBoolSetting } = require('../utils/systemSettings');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendOtp = async (identifier) => {
  const [[customer]] = await db.query(
    'SELECT id, first_login FROM customers WHERE mobile = ? OR email = ?',
    [identifier, identifier]
  );
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

  const otpEnabled = await getBoolSetting('OTP_LOGIN_ENABLED', false);

  // OTP disabled + first login → skip OTP step, signal direct password setup
  if (!otpEnabled && customer.first_login) {
    return { firstLogin: true, otpEnabled: false };
  }

  // Returning customer → just tell frontend which step (password)
  if (!customer.first_login) {
    return { firstLogin: false, otpEnabled };
  }

  // OTP enabled + first login → generate and store OTP
  const otp = generateOtp();
  await db.query(
    'UPDATE customers SET otp_code = ?, otp_expires_at = ? WHERE id = ?',
    [otp, new Date(Date.now() + 5 * 60 * 1000), customer.id]
  );
  // SECURITY (S1): never return the OTP in the API response — this is a
  // public, pre-auth endpoint, so anyone calling it could read the OTP
  // straight out of the JSON and skip verification entirely. No SMS/email
  // gateway is wired up yet, so this is logged server-side as a stopgap;
  // wire up a real provider (MSG91/Twilio/etc.) before relying on this in
  // production — until then it only works for people with server log access.
  console.log(`[OTP] customer ${customer.id} (${identifier}): ${otp} (expires in 5 min)`);
  return { firstLogin: true, otpEnabled: true };
};

const login = async ({ identifier, mobile, password, otp, newPassword }) => {
  // Accept either the new `identifier` field (mobile OR email) or the
  // older `mobile`-only field, so existing callers keep working.
  const lookupValue = identifier || mobile;
  const [[customer]] = await db.query(
    'SELECT * FROM customers WHERE mobile = ? OR email = ?',
    [lookupValue, lookupValue]
  );
  if (!customer) throw new Error('CUSTOMER_NOT_FOUND');

  const otpEnabled = await getBoolSetting('OTP_LOGIN_ENABLED', false);

  if (customer.first_login) {
    if (otpEnabled) {
      if (!otp) throw new Error('OTP_REQUIRED');
      if (customer.otp_code !== otp || new Date(customer.otp_expires_at) < new Date())
        throw new Error('INVALID_OTP');
    }
    if (!newPassword) throw new Error('NEW_PASSWORD_REQUIRED');
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query(
      'UPDATE customers SET password_hash = ?, first_login = FALSE, otp_code = NULL, otp_expires_at = NULL WHERE id = ?',
      [hash, customer.id]
    );
    return _buildResponse({ ...customer, first_login: false });
  }

  if (!password) throw new Error('PASSWORD_REQUIRED');
  const valid = customer.password_hash && await bcrypt.compare(password, customer.password_hash);
  if (!valid) throw new Error('INVALID_PASSWORD');
  return _buildResponse(customer);
};

const _buildResponse = async (customer) => {
  const [storeAccess] = await db.query(
    `SELECT csa.store_id, csa.account_number, csa.is_primary_store, s.name as store_name
     FROM customer_store_access csa
     JOIN stores s ON s.id = csa.store_id
     WHERE csa.customer_id = ?`,
    [customer.id]
  );
  return {
    customer: { id: customer.id, name: customer.name, mobile: customer.mobile, email: customer.email },
    storeAccess,
    token: generateToken({ userId: customer.id, mobile: customer.mobile, userType: 'CUSTOMER' }),
    refreshToken: generateRefreshToken({ userId: customer.id, mobile: customer.mobile, userType: 'CUSTOMER' }),
  };
};

const getMyReceipts = async (customerId) => {
  const [rows] = await db.query(
    `SELECT r.id, r.receipt_number, r.total_amount, r.payment_mode, r.receipt_state, r.status,
            r.created_at, s.name as store_name, csa.account_number
     FROM receipts r
     JOIN stores s ON s.id = r.store_id
     JOIN customer_store_access csa ON csa.customer_id = r.customer_id AND csa.store_id = r.store_id
     WHERE r.customer_id = ?
     ORDER BY r.created_at DESC`,
    [customerId]
  );
  return rows;
};

const getLoginConfig = async () => ({
  otpEnabled: await getBoolSetting('OTP_LOGIN_ENABLED', false),
});

module.exports = { getLoginConfig, sendOtp, login, getMyReceipts };
