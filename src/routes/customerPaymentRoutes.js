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

// POST /api/customer-payments/create-order
router.post('/create-order', async (req, res) => {
  try {
    const { receiptId, amount, storeId } = req.body;

    // Verify receipt belongs to this customer
    const [[receipt]] = await db.query(
      'SELECT id, total_amount, paid_amount, status FROM receipts WHERE id = ? AND customer_id = ? AND store_id = ?',
      [receiptId, req.customer.id, storeId]
    );
    if (!receipt) return error(res, 'RECEIPT_NOT_FOUND', 404);
    if (receipt.status === 'PAID') return error(res, 'ALREADY_PAID', 400);

    const [[settings]] = await db.query(
      'SELECT razorpay_key_id, razorpay_key_secret FROM store_settings WHERE store_id = ?',
      [storeId]
    );
    if (!settings?.razorpay_key_id || !settings?.razorpay_key_secret)
      return error(res, 'PAYMENT_GATEWAY_NOT_CONFIGURED', 400);

    let Razorpay;
    try { Razorpay = require('razorpay'); } catch {
      return error(res, 'RAZORPAY_PACKAGE_NOT_INSTALLED', 500);
    }

    const razorpay = new Razorpay({ key_id: settings.razorpay_key_id, key_secret: settings.razorpay_key_secret });
    const order = await razorpay.orders.create({
      amount: Math.round(Number(amount) * 100),
      currency: 'INR',
      receipt: `cust_${receiptId}_${Date.now()}`,
    });

    success(res, { orderId: order.id, amount: order.amount, currency: order.currency, keyId: settings.razorpay_key_id });
  } catch (e) { error(res, e.message); }
});

// POST /api/customer-payments/verify
router.post('/verify', async (req, res) => {
  try {
    const { orderId, paymentId, signature, receiptId, storeId } = req.body;

    const [[settings]] = await db.query(
      'SELECT razorpay_key_secret FROM store_settings WHERE store_id = ?', [storeId]
    );
    if (!settings?.razorpay_key_secret) return error(res, 'PAYMENT_GATEWAY_NOT_CONFIGURED', 400);

    const crypto = require('crypto');
    const expectedSig = crypto.createHmac('sha256', settings.razorpay_key_secret)
      .update(`${orderId}|${paymentId}`).digest('hex');
    if (expectedSig !== signature) return error(res, 'INVALID_PAYMENT_SIGNATURE', 400);

    const [[receipt]] = await db.query(
      'SELECT id, total_amount, paid_amount FROM receipts WHERE id = ? AND customer_id = ?',
      [receiptId, req.customer.id]
    );
    if (!receipt) return error(res, 'RECEIPT_NOT_FOUND', 404);

    const newPaid = Number(receipt.paid_amount) + Number(req.body.amount || 0);
    const newStatus = newPaid >= Number(receipt.total_amount) ? 'PAID' : 'PARTIAL';

    await db.query(
      'UPDATE receipts SET paid_amount = ?, status = ?, payment_mode = ? WHERE id = ?',
      [newPaid, newStatus, 'ONLINE', receiptId]
    );

    await db.query(
      `INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status, gateway_order_id, gateway_payment_id)
       VALUES (?, 'ONLINE_PAYMENT', ?, ?, 'ONLINE', 'SUCCESS', ?, ?)`,
      [storeId, receiptId, req.body.amount, orderId, paymentId]
    );

    success(res, { verified: true, paymentId, newStatus });
  } catch (e) { error(res, e.message); }
});

module.exports = router;
