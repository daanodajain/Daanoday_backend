const router = require('express').Router();
const { authenticate, storeContext } = require('../middleware/auth');
const db = require('../config/db');
const { success, error } = require('../utils/response');

router.use(authenticate, storeContext);

// POST /api/payments/create-order
// Creates a Razorpay order (or returns config if Razorpay not set up)
router.post('/create-order', async (req, res) => {
  try {
    const { amount, receiptId } = req.body;
    const [[settings]] = await db.query(
      'SELECT razorpay_key_id, razorpay_key_secret FROM store_settings WHERE store_id = ?',
      [req.storeId]
    );

    if (!settings?.razorpay_key_id || !settings?.razorpay_key_secret) {
      return error(res, 'PAYMENT_GATEWAY_NOT_CONFIGURED', 400);
    }

    // Razorpay integration — requires razorpay package
    let Razorpay;
    try { Razorpay = require('razorpay'); } catch {
      return error(res, 'RAZORPAY_PACKAGE_NOT_INSTALLED', 500);
    }

    const razorpay = new Razorpay({
      key_id: settings.razorpay_key_id,
      key_secret: settings.razorpay_key_secret,
    });

    const order = await razorpay.orders.create({
      amount: Math.round(Number(amount) * 100), // paise
      currency: 'INR',
      receipt: `receipt_${receiptId || Date.now()}`,
    });

    // Save pending payment record
    await db.query(
      'INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status, gateway_order_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.storeId, 'ONLINE_PAYMENT', receiptId || null, amount, 'ONLINE', 'INITIATED', order.id]
    );

    success(res, { orderId: order.id, amount: order.amount, currency: order.currency, keyId: settings.razorpay_key_id });
  } catch (e) { error(res, e.message); }
});

// POST /api/payments/verify
router.post('/verify', async (req, res) => {
  try {
    const { orderId, paymentId, signature, receiptId } = req.body;
    const [[settings]] = await db.query(
      'SELECT razorpay_key_secret FROM store_settings WHERE store_id = ?',
      [req.storeId]
    );
    if (!settings?.razorpay_key_secret) return error(res, 'PAYMENT_GATEWAY_NOT_CONFIGURED', 400);

    const crypto = require('crypto');
    const expectedSig = crypto.createHmac('sha256', settings.razorpay_key_secret)
      .update(`${orderId}|${paymentId}`).digest('hex');

    if (expectedSig !== signature) return error(res, 'INVALID_PAYMENT_SIGNATURE', 400);

    // Mark transaction success
    await db.query(
      "UPDATE transactions SET status = 'SUCCESS', gateway_payment_id = ? WHERE gateway_order_id = ? AND store_id = ?",
      [paymentId, orderId, req.storeId]
    );

    // If receipt linked — mark as paid
    if (receiptId) {
      await db.query("UPDATE receipts SET status = 'PAID' WHERE id = ? AND store_id = ?", [receiptId, req.storeId]);
    }

    success(res, { verified: true, paymentId });
  } catch (e) { error(res, e.message); }
});

// POST /api/payments/refund
router.post('/refund', async (req, res) => {
  try {
    const { paymentId, amount } = req.body;
    const [[settings]] = await db.query(
      'SELECT razorpay_key_id, razorpay_key_secret FROM store_settings WHERE store_id = ?',
      [req.storeId]
    );
    if (!settings?.razorpay_key_id) return error(res, 'PAYMENT_GATEWAY_NOT_CONFIGURED', 400);

    let Razorpay;
    try { Razorpay = require('razorpay'); } catch {
      return error(res, 'RAZORPAY_PACKAGE_NOT_INSTALLED', 500);
    }

    const razorpay = new Razorpay({ key_id: settings.razorpay_key_id, key_secret: settings.razorpay_key_secret });
    const refund = await razorpay.payments.refund(paymentId, { amount: amount ? Math.round(amount * 100) : undefined });

    await db.query(
      "INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status, gateway_payment_id) VALUES (?, 'REFUND', NULL, ?, 'ONLINE', 'SUCCESS', ?)",
      [req.storeId, amount || 0, refund.id]
    );

    success(res, { refundId: refund.id, status: refund.status });
  } catch (e) { error(res, e.message); }
});

// GET /api/payments/details/:id
router.get('/details/:id', async (req, res) => {
  try {
    const [[txn]] = await db.query(
      'SELECT * FROM transactions WHERE id = ? AND store_id = ?',
      [req.params.id, req.storeId]
    );
    if (!txn) return error(res, 'PAYMENT_NOT_FOUND', 404);
    success(res, txn);
  } catch (e) { error(res, e.message); }
});

module.exports = router;
