const db = require('../config/db');
const crypto = require('crypto');
const Razorpay = require('razorpay');

// Initialize Razorpay instance
const getRazorpayInstance = async (storeId) => {
  const [[settings]] = await db.query(
    'SELECT razorpay_key_id, razorpay_key_secret FROM store_settings WHERE store_id = ?',
    [storeId]
  );
  
  if (!settings?.razorpay_key_id || !settings?.razorpay_key_secret) {
    throw new Error('RAZORPAY_NOT_CONFIGURED');
  }

  return new Razorpay({
    key_id: settings.razorpay_key_id,
    key_secret: settings.razorpay_key_secret,
  });
};

// Create payment order
const createPaymentOrder = async (storeId, receiptId, amount, customerId) => {
  const [[receipt]] = await db.query(
    'SELECT id, receipt_number, customer_id, total_amount FROM receipts WHERE id = ? AND store_id = ?',
    [receiptId, storeId]
  );
  
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
  if (Number(amount) <= 0 || Number(amount) > Number(receipt.total_amount)) {
    throw new Error('INVALID_AMOUNT');
  }

  const razorpay = await getRazorpayInstance(storeId);
  
  const orderData = {
    amount: Math.round(Number(amount) * 100), // Convert to paise
    currency: 'INR',
    receipt: receipt.receipt_number,
    notes: {
      receiptId: String(receiptId),
      storeId: String(storeId),
      customerId: String(customerId || receipt.customer_id),
    },
  };

  try {
    const order = await razorpay.orders.create(orderData);
    
    // Store transaction record
    await db.query(
      `INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status, gateway_order_id)
       VALUES (?, 'ONLINE_PAYMENT', ?, ?, 'ONLINE', 'INITIATED', ?)`,
      [storeId, receiptId, amount, order.id]
    );

    return {
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      receiptId: receipt.receipt_number,
    };
  } catch (e) {
    throw new Error(`RAZORPAY_ERROR: ${e.message}`);
  }
};

// Verify payment signature
const verifyPaymentSignature = (orderId, paymentId, signature, keySecret) => {
  const body = `${orderId}|${paymentId}`;
  const expectedSignature = crypto
    .createHmac('sha256', keySecret)
    .update(body)
    .digest('hex');
  
  return expectedSignature === signature;
};

// Verify and process payment
const verifyPayment = async (storeId, paymentId, orderId, signature, receiptId) => {
  const [[settings]] = await db.query(
    'SELECT razorpay_key_secret FROM store_settings WHERE store_id = ?',
    [storeId]
  );

  if (!settings?.razorpay_key_secret) {
    throw new Error('RAZORPAY_NOT_CONFIGURED');
  }

  // Verify signature
  if (!verifyPaymentSignature(orderId, paymentId, signature, settings.razorpay_key_secret)) {
    throw new Error('INVALID_SIGNATURE');
  }

  const razorpay = await getRazorpayInstance(storeId);

  try {
    // Fetch payment details from Razorpay
    const payment = await razorpay.payments.fetch(paymentId);
    
    if (payment.status !== 'captured') {
      throw new Error('PAYMENT_NOT_CAPTURED');
    }

    const amount = Number(payment.amount) / 100; // Convert from paise to rupees

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      // Update transaction
      await conn.query(
        `UPDATE transactions SET status = 'SUCCESS', gateway_payment_id = ? 
         WHERE gateway_order_id = ? AND type = 'ONLINE_PAYMENT'`,
        [paymentId, orderId]
      );

      // Update receipt payment status
      const [[receipt]] = await conn.query(
        'SELECT id, total_amount, paid_amount, status FROM receipts WHERE id = ? AND store_id = ?',
        [receiptId, storeId]
      );

      if (!receipt) throw new Error('RECEIPT_NOT_FOUND');

      const newPaidAmount = Number(receipt.paid_amount || 0) + amount;
      const totalAmount = Number(receipt.total_amount);
      
      let newStatus;
      if (newPaidAmount >= totalAmount) {
        newStatus = 'PAID';
      } else if (newPaidAmount > 0) {
        newStatus = 'PARTIAL';
      } else {
        newStatus = 'UNPAID';
      }

      await conn.query(
        'UPDATE receipts SET paid_amount = ?, status = ?, payment_mode = ? WHERE id = ?',
        [newPaidAmount, newStatus, 'ONLINE', receiptId]
      );

      // Update receipt particulars paid amounts proportionally
      const [particulars] = await conn.query(
        'SELECT id, amount, paid_amount FROM receipt_particulars WHERE receipt_id = ?',
        [receiptId]
      );

      if (particulars.length > 0) {
        const totalParticularsAmount = particulars.reduce((sum, p) => sum + Number(p.amount), 0);
        const proportionToAdd = amount / totalParticularsAmount;

        for (const particular of particulars) {
          const addAmount = Number(particular.amount) * proportionToAdd;
          const newParticularsAmount = Math.min(
            Number(particular.paid_amount || 0) + addAmount,
            Number(particular.amount)
          );
          await conn.query(
            'UPDATE receipt_particulars SET paid_amount = ? WHERE id = ?',
            [newParticularsAmount, particular.id]
          );
        }
      }

      await conn.commit();

      return {
        success: true,
        paymentId,
        orderId,
        amount,
        receiptId,
        status: newStatus,
      };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    throw new Error(`PAYMENT_VERIFICATION_FAILED: ${e.message}`);
  }
};

// Refund payment
const refundPayment = async (storeId, paymentId, receiptId, refundAmount) => {
  const razorpay = await getRazorpayInstance(storeId);

  try {
    const refund = await razorpay.payments.refund(paymentId, {
      amount: Math.round(Number(refundAmount) * 100), // Convert to paise
    });

    const conn = await db.getConnection();
    await conn.beginTransaction();

    try {
      // Create refund transaction
      await conn.query(
        `INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status, gateway_payment_id)
         VALUES (?, 'REFUND', ?, ?, 'ONLINE', 'SUCCESS', ?)`,
        [storeId, receiptId, refundAmount, paymentId]
      );

      // Update receipt paid amount
      const [[receipt]] = await conn.query(
        'SELECT id, paid_amount FROM receipts WHERE id = ? AND store_id = ?',
        [receiptId, storeId]
      );

      if (receipt) {
        const newPaidAmount = Math.max(0, Number(receipt.paid_amount || 0) - Number(refundAmount));
        let newStatus = 'UNPAID';
        if (newPaidAmount > 0) {
          const [[r]] = await conn.query('SELECT total_amount FROM receipts WHERE id = ?', [receiptId]);
          newStatus = newPaidAmount >= Number(r.total_amount) ? 'PAID' : 'PARTIAL';
        }

        await conn.query(
          'UPDATE receipts SET paid_amount = ?, status = ? WHERE id = ?',
          [newPaidAmount, newStatus, receiptId]
        );
      }

      await conn.commit();

      return {
        success: true,
        refundId: refund.id,
        amount: refundAmount,
        receiptId,
      };
    } catch (e) {
      await conn.rollback();
      throw e;
    } finally {
      conn.release();
    }
  } catch (e) {
    throw new Error(`REFUND_FAILED: ${e.message}`);
  }
};

// Get payment details
const getPaymentDetails = async (storeId, paymentId) => {
  const razorpay = await getRazorpayInstance(storeId);

  try {
    const payment = await razorpay.payments.fetch(paymentId);
    return {
      paymentId: payment.id,
      amount: Number(payment.amount) / 100,
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      createdAt: new Date(payment.created_at * 1000),
    };
  } catch (e) {
    throw new Error(`PAYMENT_FETCH_FAILED: ${e.message}`);
  }
};

module.exports = {
  createPaymentOrder,
  verifyPayment,
  refundPayment,
  getPaymentDetails,
};
