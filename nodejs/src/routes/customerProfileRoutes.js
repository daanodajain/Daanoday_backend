const router = require('express').Router();
const db = require('../config/db');
const { verifyToken } = require('../utils/jwt');
const { success, error } = require('../utils/response');

// Customer authenticate middleware
const customerAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return error(res, 'UNAUTHORIZED', 401);
  try {
    const decoded = verifyToken(authHeader.split(' ')[1]);
    if (decoded.userType !== 'CUSTOMER') return error(res, 'FORBIDDEN', 403);
    const [[customer]] = await db.query('SELECT id, name, mobile FROM customers WHERE id = ?', [decoded.userId]);
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
    success(res, { ...req.customer, storeAccess });
  } catch (e) { error(res, e.message); }
});

// PUT /api/customer-profile
router.put('/', async (req, res) => {
  try {
    const { name } = req.body;
    await db.query('UPDATE customers SET name = ? WHERE id = ?', [name, req.customer.id]);
    const [[updated]] = await db.query('SELECT id, name, mobile FROM customers WHERE id = ?', [req.customer.id]);
    success(res, updated);
  } catch (e) { error(res, e.message); }
});

// GET /api/customer-profile/receipts
router.get('/receipts', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.id, r.receipt_number, r.total_amount, r.payment_mode,
              r.receipt_state, r.status, r.created_at, s.name as store_name,
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
              COUNT(*) as totalReceipts
       FROM receipts
       WHERE customer_id = ? AND receipt_state = 'APPROVED'`,
      [req.customer.id]
    );
    const [storeCount] = await db.query(
      'SELECT COUNT(*) as count FROM customer_store_access WHERE customer_id = ?',
      [req.customer.id]
    );
    success(res, {
      totalDonated: Number(stats.totalDonated),
      totalReceipts: stats.totalReceipts,
      storesEnrolled: storeCount[0].count,
    });
  } catch (e) { error(res, e.message); }
});

module.exports = router;
