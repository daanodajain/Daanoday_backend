const db = require('../config/db');
const bcrypt = require('bcryptjs');

const getAllStores = async () => {
  const [rows] = await db.query(
    `SELECT s.*, u.name as admin_name, u.mobile as admin_mobile
     FROM stores s
     LEFT JOIN users u ON u.id = s.store_admin_id
     ORDER BY s.created_at DESC`
  );
  return rows;
};

const getStoreById = async (id) => {
  const [[store]] = await db.query(
    `SELECT s.*, u.name as admin_name, u.mobile as admin_mobile
     FROM stores s
     LEFT JOIN users u ON u.id = s.store_admin_id
     WHERE s.id = ?`,
    [id]
  );
  if (!store) throw new Error('STORE_NOT_FOUND');
  return store;
};

const updateStore = async (id, data) => {
  const [[existing]] = await db.query('SELECT id FROM stores WHERE id = ?', [id]);
  if (!existing) throw new Error('STORE_NOT_FOUND');
  await db.query(
    'UPDATE stores SET name = ?, online_payment_enabled = ?, active = ? WHERE id = ?',
    [data.name, data.onlinePaymentEnabled ?? false, data.active ?? true, id]
  );
  return getStoreById(id);
};

// Full store + admin creation in one transaction
const createStoreWithAdmin = async ({ storeName, adminName, adminMobile }) => {
  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    // 1. Create store
    const [storeResult] = await conn.query(
      "INSERT INTO stores (name, subscription_status, online_payment_enabled, active) VALUES (?, 'ACTIVE', FALSE, TRUE)",
      [storeName]
    );
    const storeId = storeResult.insertId;

    // 2. Create admin user (first_login = TRUE, no password yet)
    const [[existingUser]] = await conn.query('SELECT id FROM users WHERE mobile = ?', [adminMobile]);
    let userId;
    if (existingUser) {
      userId = existingUser.id;
    } else {
      const [userResult] = await conn.query(
        'INSERT INTO users (name, mobile, first_login, active) VALUES (?, ?, TRUE, TRUE)',
        [adminName, adminMobile]
      );
      userId = userResult.insertId;
    }

    // 3. Create STORE_ADMIN role for this store
    const [roleResult] = await conn.query(
      "INSERT INTO roles (store_id, name) VALUES (?, 'STORE_ADMIN')",
      [storeId]
    );
    const roleId = roleResult.insertId;

    // 4. Assign all permissions except stores.manage and subscriptions.manage
    const [perms] = await conn.query(
      "SELECT id FROM permissions WHERE resource NOT IN ('stores', 'subscriptions')"
    );
    if (perms.length) {
      const vals = perms.map(p => [roleId, p.id]);
      await conn.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [vals]);
    }

    // 5. Assign role to user for this store
    await conn.query(
      'INSERT INTO user_roles (user_id, role_id, store_id) VALUES (?, ?, ?)',
      [userId, roleId, storeId]
    );

    // 6. Set store_admin_id
    await conn.query('UPDATE stores SET store_admin_id = ? WHERE id = ?', [userId, storeId]);

    // 7. Store settings
    await conn.query(
      "INSERT INTO store_settings (store_id, receipt_prefix, challan_prefix, auto_approve_cash, cash_approval_limit) VALUES (?, 'REC', 'CHL', FALSE, 0)",
      [storeId]
    );

    // 8. Sequences
    const year = new Date().getFullYear();
    await conn.query('INSERT INTO receipt_sequences (store_id, year, last_sequence) VALUES (?, ?, 0)', [storeId, year]);
    await conn.query('INSERT INTO challan_sequences (store_id, year, last_sequence) VALUES (?, ?, 0)', [storeId, year]);

    // 9. Subscription (30-day trial)
    await conn.query(
      "INSERT INTO subscriptions (store_id, plan_type, status, end_date) VALUES (?, 'FREE', 'TRIAL', DATE_ADD(NOW(), INTERVAL 30 DAY))",
      [storeId]
    );

    await conn.commit();
    return { storeId, userId, message: 'Store created successfully' };
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

const deleteStore = async (id) => {
  const [[existing]] = await db.query('SELECT id FROM stores WHERE id = ?', [id]);
  if (!existing) throw new Error('STORE_NOT_FOUND');
  await db.query('UPDATE stores SET active = FALSE WHERE id = ?', [id]);
};

module.exports = { getAllStores, getStoreById, updateStore, createStoreWithAdmin, deleteStore };
