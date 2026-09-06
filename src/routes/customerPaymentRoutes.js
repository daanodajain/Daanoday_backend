const router = require('express').Router();
const db = require('../config/db');
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

// GET /api/customer-payments/eligible-receipts
// Get receipts that customer can pay (PARTIAL or UNPAID, APPROVED state only)
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
// Online payment via Razorpay
router.post('/pay-online', async (req, res) => {
  try {
    const { receiptId, amount, storeId } = req.body;

    if (!receiptId || !amount || !storeId) return error(res, 'MISSING_REQUIRED_FIELDS', 400);
    if (Number(amount) <= 0) return error(res, 'INVALID_AMOUNT', 400);

    // Verify receipt belongs to this customer and is eligible
    const [[receipt]] = await db.query(
      `SELECT id, total_amount, paid_amount, status, receipt_state 
       FROM receipts WHERE id = ? AND customer_id = ? AND store_id = ?`,
      [receiptId, req.customer.id, storeId]
    );
    if (!receipt) return error(res, 'RECEIPT_NOT_FOUND', 404);
    if (receipt.status === 'PAID') return error(res, 'RECEIPT_ALREADY_PAID', 400);
    if (['REJECTED', 'CANCELLED'].includes(receipt.receipt_state)) 
      return error(res, 'CANNOT_PAY_REJECTED_OR_CANCELLED_RECEIPT', 400);

    // Validate amount
    const due = Number(receipt.total_amount) - Number(receipt.paid_amount);
    if (Number(amount) > due) return error(res, 'AMOUNT_EXCEEDS_DUE', 400);

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

// POST /api/customer-payments/verify-online
// Verify Razorpay payment and update receipt
router.post('/verify-online', async (req, res) => {
  try {
    const { orderId, paymentId, signature, receiptId, storeId, amount } = req.body;

    if (!orderId || !paymentId || !signature || !receiptId || !storeId || !amount) 
      return error(res, 'MISSING_REQUIRED_FIELDS', 400);

    const [[settings]] = await db.query(
      'SELECT razorpay_key_secret FROM store_settings WHERE store_id = ?', [storeId]
    );
    if (!settings?.razorpay_key_secret) return error(res, 'PAYMENT_GATEWAY_NOT_CONFIGURED', 400);

    const crypto = require('crypto');
    const expectedSig = crypto.createHmac('sha256', settings.razorpay_key_secret)
      .update(`${orderId}|${paymentId}`).digest('hex');
    if (expectedSig !== signature) return error(res, 'INVALID_PAYMENT_SIGNATURE', 400);

    const [[receipt]] = await db.query(
      `SELECT id, total_amount, paid_amount, status, receipt_state, created_by 
       FROM receipts WHERE id = ? AND customer_id = ? AND store_id = ?`,
      [receiptId, req.customer.id, storeId]
    );
    if (!receipt) return error(res, 'RECEIPT_NOT_FOUND', 404);
    if (receipt.status === 'PAID') return error(res, 'RECEIPT_ALREADY_PAID', 400);
    if (['REJECTED', 'CANCELLED'].includes(receipt.receipt_state)) 
      return error(res, 'CANNOT_PAY_REJECTED_OR_CANCELLED_RECEIPT', 400);

    // Validate amount
    const due = Number(receipt.total_amount) - Number(receipt.paid_amount);
    if (Number(amount) > due) return error(res, 'AMOUNT_EXCEEDS_DUE', 400);

    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      const newPaid = Number(receipt.paid_amount) + Number(amount);
      const newStatus = newPaid >= Number(receipt.total_amount) ? 'PAID' : 'PARTIAL';

      // Update receipt with receipt_state check
      await conn.query(
        `UPDATE receipts SET paid_amount = ?, status = ?, payment_mode = 'ONLINE' 
         WHERE id = ? AND receipt_state IN ('APPROVED', 'PENDING_APPROVAL')`,
        [newPaid, newStatus, receiptId]
      );

      // Update particulars
      const [particulars] = await conn.query(
        'SELECT id, amount, paid_amount FROM receipt_particulars WHERE receipt_id = ? ORDER BY id',
        [receiptId]
      );
      let leftToApply = Number(amount);
      for (const p of particulars) {
        if (leftToApply <= 0) break;
        const dueOnLine = Number(p.amount) - Number(p.paid_amount);
        if (dueOnLine <= 0) continue;
        const applyToLine = Math.min(dueOnLine, leftToApply);
        await conn.query(
          'UPDATE receipt_particulars SET paid_amount = paid_amount + ? WHERE id = ?',
          [applyToLine, p.id]
        );
        leftToApply -= applyToLine;
      }

      await conn.query(
        `INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status, gateway_order_id, gateway_payment_id)
         VALUES (?, 'ONLINE_PAYMENT', ?, ?, 'ONLINE', 'SUCCESS', ?, ?)`,
        [storeId, receiptId, amount, orderId, paymentId]
      );

      await conn.commit();

      // Notify receipt creator
      try {
        await notifSvc.create(receipt.created_by, storeId, {
          type: 'PAYMENT_RECEIVED',
          message: `Customer paid ₹${amount} online for receipt ${receipt.receipt_number}`,
          referenceId: receiptId,
          referenceType: 'RECEIPT'
        });
      } catch(e) {}

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
// Customer requests cash payment (goes to approval if exceeds limit)
router.post('/request-cash-payment', async (req, res) => {
  try {
    const { receiptId, amount, storeId } = req.body;

    if (!receiptId || !amount || !storeId) return error(res, 'MISSING_REQUIRED_FIELDS', 400);
    if (Number(amount) <= 0) return error(res, 'INVALID_AMOUNT', 400);

    const [[receipt]] = await db.query(
      `SELECT id, total_amount, paid_amount, status, receipt_state, created_by 
       FROM receipts WHERE id = ? AND customer_id = ? AND store_id = ?`,
      [receiptId, req.customer.id, storeId]
    );
    if (!receipt) return error(res, 'RECEIPT_NOT_FOUND', 404);
    if (receipt.status === 'PAID') return error(res, 'RECEIPT_ALREADY_PAID', 400);
    if (['REJECTED', 'CANCELLED'].includes(receipt.receipt_state)) 
      return error(res, 'CANNOT_PAY_REJECTED_OR_CANCELLED_RECEIPT', 400);

    // Check if already pending approval
    if (receipt.receipt_state === 'PENDING_APPROVAL') 
      return error(res, 'RECEIPT_ALREADY_PENDING_APPROVAL', 400);

    // Validate amount
    const due = Number(receipt.total_amount) - Number(receipt.paid_amount);
    if (Number(amount) > due) return error(res, 'AMOUNT_EXCEEDS_DUE', 400);

    const [[settings]] = await db.query(
      'SELECT auto_approve_cash, cash_approval_limit FROM store_settings WHERE store_id = ?',
      [storeId]
    );

    const needsApproval = settings && !settings.auto_approve_cash && Number(amount) > Number(settings.cash_approval_limit || 0);

    const conn = await db.getConnection();
    await conn.beginTransaction();
    try {
      if (needsApproval) {
        // Send for approval
        await conn.query(
          "UPDATE receipts SET receipt_state = 'PENDING_APPROVAL' WHERE id = ?",
          [receiptId]
        );
        await conn.commit();

        // Notify admins
        try {
          const [admins] = await db.query(
            `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
             JOIN roles r ON r.id = ur.role_id
             WHERE ur.store_id = ? AND r.name IN ('STORE_ADMIN','SUB_ADMIN')`,
            [storeId]
          );
          for (const admin of admins) {
            await notifSvc.create(admin.id, storeId, {
              type: 'RECEIPT_APPROVAL',
              message: `Customer ${req.customer.name} requested cash payment of ₹${amount} for receipt ${receipt.receipt_number}`,
              referenceId: receiptId,
              referenceType: 'RECEIPT'
            });
          }
        } catch(e) {}

        success(res, { status: 'PENDING_APPROVAL', message: 'Your payment request is pending admin approval. Please contact admin.' });
      } else {
        // Auto-approve and mark paid
        const newPaid = Number(receipt.paid_amount) + Number(amount);
        const newStatus = newPaid >= Number(receipt.total_amount) ? 'PAID' : 'PARTIAL';

        await conn.query(
          `UPDATE receipts SET paid_amount = ?, status = ?, payment_mode = 'CASH' WHERE id = ?`,
          [newPaid, newStatus, receiptId]
        );

        // Update particulars
        const [particulars] = await conn.query(
          'SELECT id, amount, paid_amount FROM receipt_particulars WHERE receipt_id = ? ORDER BY id',
          [receiptId]
        );
        let leftToApply = Number(amount);
        for (const p of particulars) {
          if (leftToApply <= 0) break;
          const dueOnLine = Number(p.amount) - Number(p.paid_amount);
          if (dueOnLine <= 0) continue;
          const applyToLine = Math.min(dueOnLine, leftToApply);
          await conn.query(
            'UPDATE receipt_particulars SET paid_amount = paid_amount + ? WHERE id = ?',
            [applyToLine, p.id]
          );
          leftToApply -= applyToLine;
        }

        await conn.query(
          `INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status)
           VALUES (?, 'RECEIPT', ?, ?, 'CASH', 'SUCCESS')`,
          [storeId, receiptId, amount]
        );

        await conn.commit();

        // Notify receipt creator
        try {
          await notifSvc.create(receipt.created_by, storeId, {
            type: 'PAYMENT_RECEIVED',
            message: `Customer ${req.customer.name} paid ₹${amount} cash for receipt ${receipt.receipt_number}`,
            referenceId: receiptId,
            referenceType: 'RECEIPT'
          });
        } catch(e) {}

        success(res, { status: newStatus, message: 'Payment recorded successfully', newPaid });
      }
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) { error(res, e.message); }
});

module.exports = router;
