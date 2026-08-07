const router = require('express').Router();
const { authenticate, storeContext } = require('../middleware/auth');
const db = require('../config/db');
const { success, error } = require('../utils/response');

router.use(authenticate, storeContext);

router.get('/', async (req, res) => {
  try {
    const [[user]] = await db.query(
      `SELECT u.id, u.name, u.email, u.mobile, u.active, u.first_login, u.created_at,
              r.name as role_name
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.store_id = ?
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.id = ?`,
      [req.storeId, req.user.id]
    );
    if (!user) return error(res, 'USER_NOT_FOUND', 404);
    success(res, user);
  } catch (e) { error(res, e.message); }
});

router.put('/', async (req, res) => {
  try {
    const { name, email, mobile } = req.body;
    await db.query('UPDATE users SET name = ?, email = ?, mobile = ? WHERE id = ?', [name, email || null, mobile || null, req.user.id]);
    const [[user]] = await db.query('SELECT id, name, email, mobile, active, created_at FROM users WHERE id = ?', [req.user.id]);
    success(res, user);
  } catch (e) { error(res, e.message); }
});

router.post('/change-password', async (req, res) => {
  try {
    const bcrypt = require('bcryptjs');
    const { currentPassword, newPassword } = req.body;
    const [[user]] = await db.query('SELECT id, password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!user) return error(res, 'USER_NOT_FOUND', 404);
    if (user.password_hash) {
      const valid = await bcrypt.compare(currentPassword, user.password_hash);
      if (!valid) return error(res, 'INVALID_CURRENT_PASSWORD', 401);
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE users SET password_hash = ?, first_login = FALSE WHERE id = ?', [hash, req.user.id]);
    success(res, { message: 'Password changed successfully' });
  } catch (e) { error(res, e.message); }
});

module.exports = router;
