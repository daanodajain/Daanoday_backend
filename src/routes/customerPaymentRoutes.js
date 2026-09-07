const router = require('express').Router();
const db = require('../config/db');
const crypto = require('crypto');
const { verifyToken } = require('../utils/jwt');
const { success, error } = require('../utils/response');
const notifSvc = require('../services/notificationService');

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

// Shared ownership + payability check.
const _getPayableReceipt = async (receiptId, customerId, storeId) => {
  const [[receipt]] = await db.query(
    `SELECT id, total_amount, paid_amount, status, receipt_state, pending_cash_amount, created_by, receipt_number
     FROM receipts WHERE id = ? AND customer_id = ? AND store_id = ?`,
    [receiptId, customerId, storeId]
  );
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
  if (receipt.status === 'PAID') throw new Error('RECEIPT_ALREADY_PAID');
  if (['REJECTED', 'CANCELLED'].includes(receipt.receipt_state)) throw new Error('CANNOT_PAY_REJECTED_OR_CANCELLED_RECEIPT');
  if (receipt.receipt_state === 'PENDING_APPROVAL') throw new Error('RECEIPT_PENDING_APPROVAL');
  return receipt;
};

// GET /api/customer-payments/eligible-receipts
router.get('/eligible-receipts', async (req, res) => {
  try {
    const { storeId } = req.query;
    if (!storeId) return error(res, 'STORE_ID_REQUIRED', 400);

    const [receipts] = await db.query(
      `SELECT r.id, r.receipt_number, r.total_amount, r.paid_amount, r.status, r.receipt_state, r.created_at
       FROM receipts r
       WHERE r.customer_id = ? AND r.store_id = ?
       AND r.receipt_state IN ('APPROVED', 'PENDING_APPROVAL')
       AND r.status IN ('UNPAID', 'PARTIAL')
       ORDER BY r.created_at DESC`,
      [req.customer.id, storeId]
    );

    const formatted = receipts.map(r => ({
      id: r.id,
      receipt_number: r.receipt_number,
      total_amount: Number(r.total_amount),
      paid_amount: Number(r.paid_amount),
      due_amount: Number(r.total_amount) - Number(r.paid_amount),
      status: r.status,
      receipt_state: r.receipt_state,
      is_pending_approval: r.receipt_state === 'PENDING_APPROVAL',
      created_at: r.created_at
    }));

    success(res, { receipts: formatted });
  } catch (e) { error(res, e.message); }
});

// POST /api/customer-payments/pay-online
// Creates a Razorpay order for the receipt's remaining due amount.
// SECURITY: the amount is always computed here from the DB, and stored
// alongside the order (gateway_order_id) in `transactions` — verify-online
// reads the amount back from THAT row, never from anything the client
// sends, so a customer can't open a small order and then claim a larger
// amount at verify time.
router.post('/pay-online', async (req, res) => {
  try {
    const { receiptId, storeId } = req.body;
    if (!receiptId || !storeId) return error(res, 'MISSING_REQUIRED_FIELDS', 400);

    const receipt = await _getPayableReceipt(receiptId, req.customer.id, storeId);
    const remaining = Number(receipt.total_amount) - Number(receipt.paid_amount);
    if (remaining <= 0) return error(res, 'NOTHING_REMAINING_TO_COLLECT', 400);

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
      amount: Math.round(remaining * 100), // paise — server-computed, never client-supplied
      currency: 'INR',
      receipt: `cust_${receiptId}_${Date.now()}`,
    });

    await db.query(
      `INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status, gateway_order_id)
       VALUES (?, 'RECEIPT', ?, ?, 'ONLINE', 'INITIATED', ?)`,
      [storeId, receiptId, remaining, order.id]
    );

    success(res, { orderId: order.id, amount: order.amount, currency: order.currency, keyId: settings.razorpay_key_id });
  } catch (e) { error(res, e.message); }
});

// POST /api/customer-payments/verify-online
router.post('/verify-online', async (req, res) => {
  try {
    const { orderId, paymentId, signature, receiptId, storeId } = req.body;
    if (!orderId || !paymentId || !signature || !receiptId || !storeId)
      return error(res, 'MISSING_REQUIRED_FIELDS', 400);

    const [[settings]] = await db.query(
      'SELECT razorpay_key_secret FROM store_settings WHERE store_id = ?', [storeId]
    );
    if (!settings?.razorpay_key_secret) return error(res, 'PAYMENT_GATEWAY_NOT_CONFIGURED', 400);

    const expectedSig = crypto.createHmac('sha256', settings.razorpay_key_secret)
      .update(`${orderId}|${paymentId}`).digest('hex');
    if (expectedSig !== signature) return error(res, 'INVALID_PAYMENT_SIGNATURE', 400);

    // The amount is whatever we quoted Razorpay back in pay-online — never
    // req.body.amount (Razorpay's signature only covers order_id|payment_id,
    // NOT the amount, so trusting a client-supplied amount here would let
    // someone pay ₹1 on a small order and then claim any amount up to the
    // receipt's due balance). This lookup also gives idempotency: a retried
    // verify call for an already-SUCCESS order just no-ops.
    const [[txn]] = await db.query(
      "SELECT id, amount, status FROM transactions WHERE gateway_order_id = ? AND reference_id = ? AND store_id = ? AND type = 'RECEIPT'",
      [orderId, receiptId, storeId]
    );
    if (!txn) return error(res, 'PAYMENT_ORDER_NOT_FOUND', 404);
    if (txn.status === 'SUCCESS') return success(res, { verified: true, paymentId, alreadyProcessed: true });

    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      const [[receipt]] = await conn.query(
        `SELECT id, total_amount, paid_amount, status, receipt_state, created_by, receipt_number
         FROM receipts WHERE id = ? AND customer_id = ? AND store_id = ? FOR UPDATE`,
        [receiptId, req.customer.id, storeId]
      );
      if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
      if (receipt.status === 'PAID') throw new Error('RECEIPT_ALREADY_PAID');
      if (['REJECTED', 'CANCELLED'].includes(receipt.receipt_state)) throw new Error('CANNOT_PAY_REJECTED_OR_CANCELLED_RECEIPT');

      const amount = Number(txn.amount);
      const newPaid = Math.min(Number(receipt.paid_amount) + amount, Number(receipt.total_amount));
      const newStatus = newPaid >= Number(receipt.total_amount) ? 'PAID' : 'PARTIAL';

      await conn.query(
        "UPDATE receipts SET paid_amount = ?, status = ?, payment_mode = 'ONLINE', payment_date = COALESCE(payment_date, CURDATE()) WHERE id = ?",
        [newPaid, newStatus, receiptId]
      );

      const [particulars] = await conn.query(
        'SELECT id, amount, paid_amount FROM receipt_particulars WHERE receipt_id = ? ORDER BY id',
        [receiptId]
      );
      let leftToApply = amount;
      for (const p of particulars) {
        if (leftToApply <= 0) break;
        const dueOnLine = Number(p.amount) - Number(p.paid_amount);
        if (dueOnLine <= 0) continue;
        const applyToLine = Math.min(dueOnLine, leftToApply);
        await conn.query('UPDATE receipt_particulars SET paid_amount = paid_amount + ? WHERE id = ?', [applyToLine, p.id]);
        leftToApply -= applyToLine;
      }

      await conn.query(
        "UPDATE transactions SET status = 'SUCCESS', gateway_payment_id = ? WHERE id = ?",
        [paymentId, txn.id]
      );

      await conn.commit();

      try {
        await notifSvc.create(receipt.created_by, storeId, {
          type: 'PAYMENT_RECEIVED',
          message: `Customer paid ₹${amount} online for receipt ${receipt.receipt_number}`,
          referenceId: receiptId, referenceType: 'RECEIPT'
        });
      } catch (e) {}

      success(res, { verified: true, paymentId, newStatus, newPaid });
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) { error(res, e.message); }
});

// POST /api/customer-payments/request-cash-payment
// Customer claims they already paid a staff member cash in person.
// This NEVER marks the receipt paid by itself — money changing hands in
// person is exactly the case where the system has no independent way to
// verify the customer's number, so it always needs a staff/admin approver
// to confirm before it's treated as paid (see receiptService
// approveCashRequest/rejectCashRequest). This also covers "staff collected
// cash and forgot to record it" — the customer's request becomes the
// prompt that surfaces it for someone with approval rights to reconcile.
router.post('/request-cash-payment', async (req, res) => {
  try {
    const { receiptId, amount, storeId } = req.body;
    if (!receiptId || !amount || !storeId) return error(res, 'MISSING_REQUIRED_FIELDS', 400);
    if (Number(amount) <= 0) return error(res, 'INVALID_AMOUNT', 400);

    const receipt = await _getPayableReceipt(receiptId, req.customer.id, storeId);
    const due = Number(receipt.total_amount) - Number(receipt.paid_amount);
    if (Number(amount) > due) return error(res, 'AMOUNT_EXCEEDS_DUE', 400);

    await db.query(
      "UPDATE receipts SET receipt_state = 'PENDING_APPROVAL', pending_cash_amount = ? WHERE id = ?",
      [amount, receiptId]
    );

    try {
      const [admins] = await db.query(
        `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
         JOIN roles r ON r.id = ur.role_id
         WHERE ur.store_id = ? AND r.name IN ('STORE_ADMIN','SUB_ADMIN') AND u.active = TRUE`,
        [storeId]
      );
      for (const admin of admins) {
        await notifSvc.create(admin.id, storeId, {
          type: 'RECEIPT_APPROVAL',
          message: `Customer ${req.customer.name} says they paid ₹${amount} cash for receipt ${receipt.receipt_number} — please confirm and approve`,
          referenceId: receiptId, referenceType: 'RECEIPT'
        });
      }
    } catch (e) {}

    success(res, {
      status: 'PENDING_APPROVAL',
      message: 'Your payment request has been sent. A store admin needs to confirm they received it before your receipt is marked paid.'
    });
  } catch (e) { error(res, e.message); }
});

// DELETE /api/customer-payments/cancel-cash-request/:receiptId
// Customer withdraws their own not-yet-approved cash claim.
router.delete('/cancel-cash-request/:receiptId', async (req, res) => {
  try {
    const { receiptId } = req.params;
    const [[receipt]] = await db.query(
      'SELECT id, receipt_state, pending_cash_amount FROM receipts WHERE id = ? AND customer_id = ?',
      [receiptId, req.customer.id]
    );
    if (!receipt) return error(res, 'RECEIPT_NOT_FOUND', 404);
    if (receipt.receipt_state !== 'PENDING_APPROVAL' || receipt.pending_cash_amount === null) {
      return error(res, 'NO_PENDING_CASH_REQUEST', 400);
    }
    await db.query(
      "UPDATE receipts SET receipt_state = 'APPROVED', pending_cash_amount = NULL WHERE id = ?", [receiptId]
    );
    success(res, { message: 'Cash payment request cancelled' });
  } catch (e) { error(res, e.message); }
});

module.exports = router;
