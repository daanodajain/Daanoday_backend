const router = require('express').Router();
const db = require('../config/db');
const bcrypt = require('bcryptjs');
const { verifyToken } = require('../utils/jwt');
const { success, error } = require('../utils/response');

const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

// Customer authenticate middleware
const customerAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return error(res, 'UNAUTHORIZED', 401);
  try {
    const decoded = verifyToken(authHeader.split(' ')[1]);
    if (decoded.userType !== 'CUSTOMER') return error(res, 'FORBIDDEN', 403);
    const [[customer]] = await db.query(
      'SELECT id, name, mobile, email, password_hash FROM customers WHERE id = ?',
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
    const [[updated]] = await db.query('SELECT id, name, mobile, email FROM customers WHERE id = ?', [req.customer.id]);
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
    // In prod: send SMS. For now return otp in response for dev.
    success(res, { message: 'OTP sent', otp });
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

// POST /api/customer-profile/request-cash-payment  (customer requests cash payment → notify store admin)
router.post('/request-cash-payment', async (req, res) => {
  try {
    const { receiptId } = req.body;
    const [[receipt]] = await db.query(
      `SELECT r.id, r.receipt_number, r.total_amount, r.paid_amount, r.status, r.store_id,
              c.name as customer_name
       FROM receipts r
       JOIN customers c ON c.id = r.customer_id
       WHERE r.id = ? AND r.customer_id = ?`,
      [receiptId, req.customer.id]
    );
    if (!receipt) return error(res, 'RECEIPT_NOT_FOUND', 404);
    if (receipt.status === 'PAID') return error(res, 'ALREADY_PAID', 400);

    const dueAmount = Number(receipt.total_amount) - Number(receipt.paid_amount);

    // Find store admin users to notify
    const [admins] = await db.query(
      `SELECT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.store_id = ? AND r.name IN ('STORE_ADMIN','SUB_ADMIN') AND u.active = TRUE`,
      [receipt.store_id]
    );

    // Insert notification for each admin
    for (const admin of admins) {
      await db.query(
        `INSERT INTO notifications (user_id, store_id, type, message, reference_id, reference_type)
         VALUES (?, ?, 'PAYMENT_RECEIVED', ?, ?, 'RECEIPT')`,
        [
          admin.id,
          receipt.store_id,
          `Cash payment request from ${receipt.customer_name} for receipt ${receipt.receipt_number} — ₹${dueAmount}`,
          receipt.id,
        ]
      );
    }

    success(res, { message: 'Cash payment request sent to store admin', dueAmount });
  } catch (e) { error(res, e.message); }
});

// DELETE /api/customer-profile/cancel-cash-request/:receiptId  (customer cancels their own cash request)
router.delete('/cancel-cash-request/:receiptId', async (req, res) => {
  try {
    const { receiptId } = req.params;
    // Remove pending cash payment notifications for this receipt from this customer
    await db.query(
      `DELETE FROM notifications
       WHERE reference_id = ? AND reference_type = 'RECEIPT' AND type = 'PAYMENT_RECEIVED'
         AND message LIKE '%cash payment request%'`,
      [receiptId]
    );
    success(res, { message: 'Cash payment request cancelled' });
  } catch (e) { error(res, e.message); }
});

module.exports = router;
