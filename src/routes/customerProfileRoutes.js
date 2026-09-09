const router = require('express').Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { verifyToken } = require('../utils/jwt');
const { success, error } = require('../utils/response');
const { renderReceiptPdf } = require('../utils/receiptPdf');
const { avatarUpload } = require('../config/avatarUpload');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

// Customer authenticate middleware
const customerAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return error(res, 'UNAUTHORIZED', 401);
  try {
    const decoded = verifyToken(authHeader.split(' ')[1]);
    if (decoded.userType !== 'CUSTOMER') return error(res, 'FORBIDDEN', 403);
    const [[customer]] = await db.query(
      'SELECT id, name, mobile, email, password_hash, avatar_url FROM customers WHERE id = ?',
      [decoded.userId]
    );
    if (!customer) return error(res, 'CUSTOMER_NOT_FOUND', 401);
    req.customer = customer;
    next();
  } catch { return error(res, 'INVALID_TOKEN', 401); }
};

router.use(customerAuth);

// GET /api/customer-profile
router.get('/', async (req, res) => {
  try {
    const [storeAccess] = await db.query(
      `SELECT csa.store_id, csa.account_number, csa.is_primary_store, s.name as store_name
       FROM customer_store_access csa
       JOIN stores s ON s.id = csa.store_id
       WHERE csa.customer_id = ?`,
      [req.customer.id]
    );
    const { password_hash, ...safe } = req.customer;
    success(res, { ...safe, storeAccess });
  } catch (e) { error(res, e.message); }
});

// PUT /api/customer-profile  (name only — mobile needs OTP)
router.put('/', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return error(res, 'NAME_REQUIRED', 400);
    await db.query('UPDATE customers SET name = ? WHERE id = ?', [name.trim(), req.customer.id]);
    const [[updated]] = await db.query('SELECT id, name, mobile, email, avatar_url FROM customers WHERE id = ?', [req.customer.id]);
    success(res, updated);
  } catch (e) { error(res, e.message); }
});

// POST /api/customer-profile/send-mobile-otp  (send OTP to new mobile)
router.post('/send-mobile-otp', async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) return error(res, 'INVALID_MOBILE', 400);
    const [[existing]] = await db.query('SELECT id FROM customers WHERE mobile = ? AND id != ?', [mobile, req.customer.id]);
    if (existing) return error(res, 'MOBILE_ALREADY_REGISTERED', 400);
    const otp = generateOtp();
    await db.query('UPDATE customers SET otp_code = ?, otp_expires_at = ? WHERE id = ?',
      [otp, new Date(Date.now() + 5 * 60 * 1000), req.customer.id]);
    // SECURITY (S1): don't return the OTP — see customerAuthService.sendOtp
    // for why. Logged server-side as a stopgap until a real SMS gateway is wired up.
    console.log(`[OTP] customer ${req.customer.id} mobile-change to ${mobile}: ${otp} (expires in 5 min)`);
    success(res, { message: 'OTP sent' });
  } catch (e) { error(res, e.message); }
});

// POST /api/customer-profile/verify-mobile-otp  (verify OTP and update mobile)
router.post('/verify-mobile-otp', async (req, res) => {
  try {
    const { mobile, otp } = req.body;
    const [[customer]] = await db.query(
      'SELECT otp_code, otp_expires_at FROM customers WHERE id = ?', [req.customer.id]
    );
    if (!customer.otp_code || customer.otp_code !== otp || new Date(customer.otp_expires_at) < new Date())
      return error(res, 'INVALID_OR_EXPIRED_OTP', 400);
    await db.query('UPDATE customers SET mobile = ?, otp_code = NULL, otp_expires_at = NULL WHERE id = ?',
      [mobile, req.customer.id]);
    success(res, { message: 'Mobile updated successfully' });
  } catch (e) { error(res, e.message); }
});

// POST /api/customer-profile/avatar (multipart/form-data, field name "avatar")
router.post('/avatar', (req, res) => {
  avatarUpload.single('avatar')(req, res, async (err) => {
    if (err) return error(res, err.message === 'INVALID_FILE_TYPE' ? 'INVALID_FILE_TYPE' : 'UPLOAD_FAILED', 400);
    if (!req.file) return error(res, 'NO_FILE_UPLOADED', 400);
    try {
      const avatarUrl = `/uploads/avatars/${req.file.filename}`;
      await db.query('UPDATE customers SET avatar_url = ? WHERE id = ?', [avatarUrl, req.customer.id]);
      success(res, { avatarUrl });
    } catch (e) { error(res, e.message); }
  });
});

// POST /api/customer-profile/send-email-otp  (send OTP to new email — mirrors send-mobile-otp)
router.post('/send-email-otp', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error(res, 'INVALID_EMAIL', 400);
    const [[existing]] = await db.query('SELECT id FROM customers WHERE email = ? AND id != ?', [email, req.customer.id]);
    if (existing) return error(res, 'EMAIL_ALREADY_REGISTERED', 400);
    const otp = generateOtp();
    await db.query('UPDATE customers SET otp_code = ?, otp_expires_at = ? WHERE id = ?',
      [otp, new Date(Date.now() + 5 * 60 * 1000), req.customer.id]);
    console.log(`[OTP] customer ${req.customer.id} email-change to ${email}: ${otp} (expires in 5 min)`);
    success(res, { message: 'OTP sent' });
  } catch (e) { error(res, e.message); }
});

// POST /api/customer-profile/verify-email-otp  (verify OTP and update email)
router.post('/verify-email-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const [[customer]] = await db.query(
      'SELECT otp_code, otp_expires_at FROM customers WHERE id = ?', [req.customer.id]
    );
    if (!customer.otp_code || customer.otp_code !== otp || new Date(customer.otp_expires_at) < new Date())
      return error(res, 'INVALID_OR_EXPIRED_OTP', 400);
    await db.query('UPDATE customers SET email = ?, otp_code = NULL, otp_expires_at = NULL WHERE id = ?',
      [email, req.customer.id]);
    success(res, { message: 'Email updated successfully' });
  } catch (e) { error(res, e.message); }
});

// POST /api/customer-profile/change-password
router.post('/change-password', async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return error(res, 'WEAK_PASSWORD', 400);
    if (req.customer.password_hash) {
      const valid = await bcrypt.compare(currentPassword, req.customer.password_hash);
      if (!valid) return error(res, 'INVALID_CURRENT_PASSWORD', 401);
    }
    const hash = await bcrypt.hash(newPassword, 10);
    await db.query('UPDATE customers SET password_hash = ? WHERE id = ?', [hash, req.customer.id]);
    success(res, { message: 'Password changed successfully' });
  } catch (e) { error(res, e.message); }
});

// GET /api/customer-profile/receipts
router.get('/receipts', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.id, r.receipt_number, r.total_amount, r.paid_amount, r.payment_mode,
              r.receipt_state, r.status, r.created_at, r.is_due, r.remarks,
              s.name as store_name, s.id as store_id,
              csa.account_number
       FROM receipts r
       JOIN stores s ON s.id = r.store_id
       JOIN customer_store_access csa ON csa.customer_id = r.customer_id AND csa.store_id = r.store_id
       WHERE r.customer_id = ?
       ORDER BY r.created_at DESC`,
      [req.customer.id]
    );
    success(res, rows);
  } catch (e) { error(res, e.message); }
});

// GET /api/customer-profile/stats
router.get('/stats', async (req, res) => {
  try {
    const [[stats]] = await db.query(
      `SELECT COALESCE(SUM(total_amount), 0) as totalDonated,
              COUNT(*) as totalReceipts,
              COALESCE(SUM(CASE WHEN status = 'UNPAID' OR status = 'PARTIAL' THEN (total_amount - paid_amount) ELSE 0 END), 0) as totalDue
       FROM receipts
       WHERE customer_id = ? AND receipt_state = 'APPROVED'`,
      [req.customer.id]
    );
    const [storeCount] = await db.query(
      'SELECT COUNT(*) as count FROM customer_store_access WHERE customer_id = ?',
      [req.customer.id]
    );
    const [[pending]] = await db.query(
      `SELECT COUNT(*) as count FROM receipts WHERE customer_id = ? AND (status = 'UNPAID' OR status = 'PARTIAL')`,
      [req.customer.id]
    );
    success(res, {
      totalDonated: Number(stats.totalDonated),
      totalReceipts: stats.totalReceipts,
      totalDue: Number(stats.totalDue),
      storesEnrolled: storeCount[0].count,
      pendingPayments: pending.count,
    });
  } catch (e) { error(res, e.message); }
});

// GET /api/customer-profile/transactions
router.get('/transactions', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.id, t.type, t.amount, t.payment_mode, t.status, t.created_at,
              s.name as store_name,
              r.receipt_number
       FROM transactions t
       JOIN stores s ON s.id = t.store_id
       LEFT JOIN receipts r ON r.id = t.reference_id AND t.type IN ('RECEIPT','ONLINE_PAYMENT')
       WHERE r.customer_id = ? OR (t.type = 'ONLINE_PAYMENT' AND r.customer_id = ?)
       ORDER BY t.created_at DESC
       LIMIT 50`,
      [req.customer.id, req.customer.id]
    );
    success(res, rows);
  } catch (e) { error(res, e.message); }
});

// GET /api/customer-profile/store-expenses  (approved paid challans for stores customer is enrolled in)
router.get('/store-expenses', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT c.id, c.challan_number, c.total_amount, c.payment_mode, c.status, c.created_at,
              s.name as store_name, sup.name as supplier_name
       FROM challans c
       JOIN stores s ON s.id = c.store_id
       JOIN suppliers sup ON sup.id = c.supplier_id
       JOIN customer_store_access csa ON csa.store_id = c.store_id AND csa.customer_id = ?
       WHERE c.status = 'PAID'
       ORDER BY c.created_at DESC
       LIMIT 100`,
      [req.customer.id]
    );
    success(res, rows);
  } catch (e) { error(res, e.message); }
});

// GET /api/customer-profile/receipts/:id/pdf — download own receipt.
// (H5) The staff route GET /receipts/:id/pdf needs a staff JWT + x-store-id
// header via storeContext middleware — a customer session has neither, so
// that route 401/403s for a customer token. This is the customer-scoped
// equivalent: ownership is checked directly against customer_id instead.
router.get('/receipts/:id/pdf', async (req, res) => {
  try {
    const [[receipt]] = await db.query(
      `SELECT r.*, c.name as customer_name, c.mobile as customer_mobile,
              csa.account_number, s.name as store_name, s.address as store_address,
              s.contact as store_contact, s.email as store_email
       FROM receipts r
       JOIN customers c ON c.id = r.customer_id
       JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = r.store_id
       JOIN stores s ON s.id = r.store_id
       WHERE r.id = ? AND r.customer_id = ?`,
      [req.params.id, req.customer.id]
    );
    if (!receipt) return error(res, 'RECEIPT_NOT_FOUND', 404);
    const [particulars] = await db.query('SELECT * FROM receipt_particulars WHERE receipt_id = ?', [receipt.id]);
    receipt.particulars = particulars;

    const [[settings]] = await db.query(
      'SELECT receipt_template, receipt_header_text FROM store_settings WHERE store_id = ?', [receipt.store_id]
    );
    renderReceiptPdf(receipt, settings || {}, res);
  } catch (e) {
    if (res.headersSent) res.end();
    else error(res, e.message);
  }
});

// NOTE: cash-payment request/cancel used to live here (notification-only,
// never touched receipt_state). That's superseded by
// POST/DELETE /api/customer-payments/request-cash-payment, which actually
// puts the receipt into PENDING_APPROVAL so a staff/admin approval is
// required before it's treated as paid — see customerPaymentRoutes.js.

module.exports = router;
