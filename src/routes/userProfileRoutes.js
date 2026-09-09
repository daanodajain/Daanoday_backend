const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { authenticate } = require('../middleware/auth');
const { avatarUpload } = require('../config/avatarUpload');
const db = require('../config/db');
const { success, error } = require('../utils/response');

// Deliberately NOT using storeContext here — a profile is the user's own
// identity, independent of which store they currently have selected. That
// requirement previously blocked this page for anyone (e.g. SUPER_ADMIN)
// before they'd picked a store.
router.use(authenticate);

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

// GET /api/user-profile
router.get('/', async (req, res) => {
  try {
    const [[user]] = await db.query(
      `SELECT id, name, email, mobile, avatar_url, active, first_login, created_at
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    if (!user) return error(res, 'USER_NOT_FOUND', 404);

    // Roles across all stores this user has access to (not just the
    // currently-selected one) — shown as a summary, e.g. "Store Admin".
    const [roles] = await db.query(
      `SELECT DISTINCT r.name FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?`,
      [req.user.id]
    );
    user.role_name = roles.map(r => r.name).join(', ') || null;

    success(res, user);
  } catch (e) { error(res, e.message); }
});

// PUT /api/user-profile — name only. Email/mobile go through the OTP flow
// below so a typo can never lock someone out of their own account.
router.put('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name || !name.trim()) return error(res, 'NAME_REQUIRED');
    await db.query('UPDATE users SET name = ? WHERE id = ?', [name.trim(), req.user.id]);
    const [[user]] = await db.query('SELECT id, name, email, mobile, avatar_url, active, created_at FROM users WHERE id = ?', [req.user.id]);
    success(res, user);
  } catch (e) { error(res, e.message); }
});

// POST /api/user-profile/avatar (multipart/form-data, field name "avatar")
router.post('/avatar', (req, res) => {
  avatarUpload.single('avatar')(req, res, async (err) => {
    if (err) return error(res, err.message === 'INVALID_FILE_TYPE' ? 'INVALID_FILE_TYPE' : 'UPLOAD_FAILED');
    if (!req.file) return error(res, 'NO_FILE_UPLOADED');
    try {
      const avatarUrl = `/uploads/avatars/${req.file.filename}`;
      await db.query('UPDATE users SET avatar_url = ? WHERE id = ?', [avatarUrl, req.user.id]);
      success(res, { avatarUrl });
    } catch (e) { error(res, e.message); }
  });
});

// POST /api/user-profile/change-password
router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return error(res, 'NEW_PASSWORD_TOO_SHORT');
    const [[user]] = await db.query('SELECT id, password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!user) return error(res, 'USER_NOT_FOUND', 404);
    if (user.password_hash) {
      const valid = await bcrypt.compare(currentPassword || '', user.password_hash);
      if (!valid) return error(res, 'INVALID_CURRENT_PASSWORD', 401);
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = ?, first_login = FALSE WHERE id = ?', [hash, req.user.id]);
    success(res, { message: 'Password changed successfully' });
  } catch (e) { error(res, e.message); }
});

// POST /api/user-profile/request-contact-otp  { type: 'mobile'|'email', value }
// Sends (dev: returns) an OTP to the NEW value. Nothing changes yet.
router.post('/request-contact-otp', async (req, res) => {
  try {
    const { type, value } = req.body;
    if (!['mobile', 'email'].includes(type)) return error(res, 'INVALID_TYPE');
    if (!value || !value.trim()) return error(res, 'VALUE_REQUIRED');

    const column = type === 'mobile' ? 'mobile' : 'email';
    const [[existing]] = await db.query(
      `SELECT id FROM users WHERE ${column} = ? AND id != ?`,
      [value.trim(), req.user.id]
    );
    if (existing) return error(res, type === 'mobile' ? 'MOBILE_ALREADY_IN_USE' : 'EMAIL_ALREADY_IN_USE');

    const otp = generateOtp();
    const pendingColumn = type === 'mobile' ? 'pending_mobile' : 'pending_email';
    await db.query(
      `UPDATE users SET ${pendingColumn} = ?, otp_code = ?, otp_expires_at = ? WHERE id = ?`,
      [value.trim(), otp, new Date(Date.now() + 5 * 60 * 1000), req.user.id]
    );
    // SECURITY: OTP is never returned to the client — logged server-side
    // as a stopgap until a real SMS/email gateway is wired up (same
    // approach as customer-profile's send-mobile-otp).
    console.log(`[OTP] user ${req.user.id} ${type}-change to ${value.trim()}: ${otp} (expires in 5 min)`);
    success(res, { message: `OTP sent to new ${type}` });
  } catch (e) { error(res, e.message); }
});

// POST /api/user-profile/verify-contact-otp  { type: 'mobile'|'email', otp }
router.post('/verify-contact-otp', async (req, res) => {
  try {
    const { type, otp } = req.body;
    if (!['mobile', 'email'].includes(type)) return error(res, 'INVALID_TYPE');
    const [[user]] = await db.query(
      'SELECT otp_code, otp_expires_at, pending_mobile, pending_email FROM users WHERE id = ?',
      [req.user.id]
    );
    if (!user) return error(res, 'USER_NOT_FOUND', 404);
    if (!user.otp_code || user.otp_code !== otp || new Date(user.otp_expires_at) < new Date())
      return error(res, 'INVALID_OTP');

    const pendingValue = type === 'mobile' ? user.pending_mobile : user.pending_email;
    if (!pendingValue) return error(res, 'NO_PENDING_CHANGE');

    const column = type === 'mobile' ? 'mobile' : 'email';
    const pendingColumn = type === 'mobile' ? 'pending_mobile' : 'pending_email';
    await db.query(
      `UPDATE users SET ${column} = ?, ${pendingColumn} = NULL, otp_code = NULL, otp_expires_at = NULL WHERE id = ?`,
      [pendingValue, req.user.id]
    );
    const [[updated]] = await db.query('SELECT id, name, email, mobile, avatar_url FROM users WHERE id = ?', [req.user.id]);
    success(res, updated);
  } catch (e) { error(res, e.message); }
});

module.exports = router;
