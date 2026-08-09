const db = require('../config/db');
const auditLog = require('./auditLogService');

// ── System Settings ───────────────────────────────────────────
const getAllSystemSettings = async () => {
  const [rows] = await db.query('SELECT * FROM system_settings ORDER BY category, setting_key');
  return rows;
};

const upsertSystemSetting = async (key, value, category, userId) => {
  const [[existing]] = await db.query('SELECT id FROM system_settings WHERE setting_key = ?', [key]);
  if (existing) {
    await db.query('UPDATE system_settings SET setting_value = ? WHERE setting_key = ?', [value, key]);
  } else {
    await db.query(
      'INSERT INTO system_settings (setting_key, setting_value, category) VALUES (?, ?, ?)',
      [key, value, category]
    );
  }
  await auditLog.log({ userId, action: 'SYSTEM_SETTING_UPDATED', details: { key, value } });
};

// ── Subscriptions ─────────────────────────────────────────────
const getAllSubscriptions = async () => {
  const [rows] = await db.query(
    `SELECT sub.*, s.name as store_name
     FROM subscriptions sub
     JOIN stores s ON s.id = sub.store_id
     ORDER BY sub.created_at DESC`
  );
  return rows;
};

const getSubscriptionByStore = async (storeId) => {
  const [[row]] = await db.query('SELECT * FROM subscriptions WHERE store_id = ?', [storeId]);
  return row || null;
};

const upsertSubscription = async (storeId, data, userId) => {
  const [[existing]] = await db.query('SELECT id FROM subscriptions WHERE store_id = ?', [storeId]);
  if (existing) {
    await db.query(
      'UPDATE subscriptions SET plan_type = ?, status = ?, end_date = ?, monthly_fee = ?, notes = ? WHERE store_id = ?',
      [data.planType, data.status, data.endDate, data.monthlyFee || 0, data.notes || null, storeId]
    );
  } else {
    await db.query(
      'INSERT INTO subscriptions (store_id, plan_type, status, end_date, monthly_fee) VALUES (?, ?, ?, ?, ?)',
      [storeId, data.planType || 'FREE', data.status || 'TRIAL', data.endDate, data.monthlyFee || 0]
    );
  }
  // Sync stores.subscription_status
  await db.query('UPDATE stores SET subscription_status = ? WHERE id = ?', [data.status, storeId]);
  await auditLog.log({ userId, action: 'SUBSCRIPTION_UPDATED', entityType: 'STORE', entityId: storeId });
  return getSubscriptionByStore(storeId);
};

const extendSubscription = async (storeId, months, userId) => {
  const [[sub]] = await db.query('SELECT id FROM subscriptions WHERE store_id = ?', [storeId]);
  if (!sub) throw new Error('SUBSCRIPTION_NOT_FOUND');
  await db.query(
    "UPDATE subscriptions SET end_date = DATE_ADD(end_date, INTERVAL ? MONTH), status = 'ACTIVE' WHERE store_id = ?",
    [months, storeId]
  );
  await db.query("UPDATE stores SET subscription_status = 'ACTIVE' WHERE id = ?", [storeId]);
  await auditLog.log({ userId, action: 'SUBSCRIPTION_EXTENDED', entityType: 'STORE', entityId: storeId, details: { months } });
  return getSubscriptionByStore(storeId);
};

const suspendSubscription = async (storeId, reason, userId) => {
  const [[sub]] = await db.query('SELECT id FROM subscriptions WHERE store_id = ?', [storeId]);
  if (!sub) throw new Error('SUBSCRIPTION_NOT_FOUND');
  await db.query(
    "UPDATE subscriptions SET status = 'SUSPENDED', notes = ? WHERE store_id = ?",
    [reason || null, storeId]
  );
  await db.query("UPDATE stores SET subscription_status = 'SUSPENDED' WHERE id = ?", [storeId]);
  await auditLog.log({ userId, action: 'SUBSCRIPTION_SUSPENDED', entityType: 'STORE', entityId: storeId });
  return getSubscriptionByStore(storeId);
};

const getAllStoresWithSubscription = async () => {
  const [rows] = await db.query(
    `SELECT s.id, s.name, s.address, s.city, s.state, s.contact, s.email,
            s.subscription_status as subscriptionStatus,
            s.online_payment_enabled as onlinePaymentEnabled,
            s.active, s.created_at,
            u.name as admin_name, u.mobile as admin_mobile, u.email as admin_email,
            sub.plan_type, sub.status as sub_status, sub.end_date as subscriptionExpiresAt
     FROM stores s
     LEFT JOIN users u ON u.id = s.store_admin_id
     LEFT JOIN subscriptions sub ON sub.store_id = s.id
     WHERE s.active = TRUE
     ORDER BY s.created_at DESC`
  );
  return rows;
};

module.exports = {
  getAllSystemSettings, upsertSystemSetting,
  getAllSubscriptions, getSubscriptionByStore, upsertSubscription,
  extendSubscription, suspendSubscription, getAllStoresWithSubscription
};
