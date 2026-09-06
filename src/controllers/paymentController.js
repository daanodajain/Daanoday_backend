const svc = require('../services/paymentService');
const { success, error } = require('../utils/response');

const createOrder = async (req, res) => {
  try {
    const { receiptId, amount } = req.body;
    if (!receiptId || !amount) return error(res, 'RECEIPT_ID_AND_AMOUNT_REQUIRED');
    
    const result = await svc.createPaymentOrder(req.storeId, receiptId, amount, req.user.id);
    success(res, result, 201);
  } catch (e) {
    error(res, e.message);
  }
};

const verifyPayment = async (req, res) => {
  try {
    const { paymentId, orderId, signature, receiptId } = req.body;
    if (!paymentId || !orderId || !signature || !receiptId) {
      return error(res, 'PAYMENT_ID_ORDER_ID_SIGNATURE_RECEIPT_ID_REQUIRED');
    }
    
    const result = await svc.verifyPayment(req.storeId, paymentId, orderId, signature, receiptId);
    success(res, result);
  } catch (e) {
    error(res, e.message);
  }
};

const refund = async (req, res) => {
  try {
    const { paymentId, receiptId, refundAmount } = req.body;
    if (!paymentId || !receiptId || !refundAmount) {
      return error(res, 'PAYMENT_ID_RECEIPT_ID_REFUND_AMOUNT_REQUIRED');
    }
    
    const result = await svc.refundPayment(req.storeId, paymentId, receiptId, refundAmount);
    success(res, result);
  } catch (e) {
    error(res, e.message);
  }
};

const getDetails = async (req, res) => {
  try {
    const { paymentId } = req.params;
    if (!paymentId) return error(res, 'PAYMENT_ID_REQUIRED');
    
    const result = await svc.getPaymentDetails(req.storeId, paymentId);
    success(res, result);
  } catch (e) {
    error(res, e.message);
  }
};

module.exports = { createOrder, verifyPayment, refund, getDetails };
