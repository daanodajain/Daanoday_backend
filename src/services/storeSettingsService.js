const db = require('../config/db');
const auditLog = require('./auditLogService');

const getByStore = async (storeId) => {
  const [[settings]] = await db.query('SELECT * FROM store_settings WHERE store_id = ?', [storeId]);
  if (!settings) throw new Error('STORE_SETTINGS_NOT_FOUND');
  return settings;
};

const update = async (storeId, data, userId) => {
  const [[existing]] = await db.query('SELECT id FROM store_settings WHERE store_id = ?', [storeId]);

  const camelToSnake = {
    receiptPrefix: 'receipt_prefix', challanPrefix: 'challan_prefix',
    autoApproveCash: 'auto_approve_cash', cashApprovalLimit: 'cash_approval_limit',
    razorpayKeyId: 'razorpay_key_id', razorpayKeySecret: 'razorpay_key_secret',
    smsEnabled: 'sms_enabled', emailEnabled: 'email_enabled',
    lockedBeforeDate: 'locked_before_date', enable80g: 'enable_80g',
    receiptTemplate: 'receipt_template', receiptHeaderText: 'receipt_header_text',
    autoSendReceiptSms: 'auto_send_receipt_sms', autoSendReceiptEmail: 'auto_send_receipt_email',
    sessionTimeoutMinutes: 'session_timeout_minutes', inactivityLockMinutes: 'inactivity_lock_minutes'
  };

  if (data.sessionTimeoutMinutes !== undefined && data.sessionTimeoutMinutes !== null) {
    if (!Number.isInteger(data.sessionTimeoutMinutes) || data.sessionTimeoutMinutes <= 0) {
      throw new Error('INVALID_SESSION_TIMEOUT');
    }
  }
  if (data.inactivityLockMinutes !== undefined && data.inactivityLockMinutes !== null) {
    if (!Number.isInteger(data.inactivityLockMinutes) || data.inactivityLockMinutes <= 0) {
      throw new Error('INVALID_INACTIVITY_LOCK');
    }
  }
  if (
    data.sessionTimeoutMinutes && data.inactivityLockMinutes &&
    data.inactivityLockMinutes >= data.sessionTimeoutMinutes
  ) {
    throw new Error('INACTIVITY_LOCK_MUST_BE_LESS_THAN_SESSION_TIMEOUT');
  }

  const sets = [];
  const vals = [];
  for (const [camel, col] of Object.entries(camelToSnake)) {
    if (data[camel] !== undefined) { sets.push(`${col} = ?`); vals.push(data[camel]); }
  }

  if (!existing) {
    await db.query(
      "INSERT INTO store_settings (store_id, receipt_prefix, challan_prefix) VALUES (?, 'REC', 'CHL')",
      [storeId]
    );
  }
  if (sets.length) {
    vals.push(storeId);
    await db.query(`UPDATE store_settings SET ${sets.join(', ')} WHERE store_id = ?`, vals);
  }

  await auditLog.log({ storeId, userId, action: 'SETTINGS_UPDATED', entityType: 'STORE_SETTINGS', entityId: storeId });
  return getByStore(storeId);
};

module.exports = { getByStore, update };
