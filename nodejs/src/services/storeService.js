const db = require('../config/db');
const bcrypt = require('bcryptjs');

const getAllStores = async () => {
  const [rows] = await db.query(
    `SELECT s.*, u.name as admin_name, u.mobile as admin_mobile, u.email as admin_email
     FROM stores s
     LEFT JOIN users u ON u.id = s.store_admin_id
     ORDER BY s.created_at DESC`
  );
  return rows;
};

const getStoreById = async (id) => {
  const [[store]] = await db.query(
    `SELECT s.*, u.name as admin_name, u.mobile as admin_mobile, u.email as admin_email
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
    `UPDATE stores SET
      name = ?, address = ?, city = ?, state = ?, contact = ?, email = ?,
      online_payment_enabled = ?, subscription_status = ?, active = ?
     WHERE id = ?`,
    [
      data.name,
      data.address || null,
      data.city || null,
      data.state || null,
      data.contact || null,
      data.email || null,
      data.onlinePaymentEnabled ?? false,
      data.subscriptionStatus || 'ACTIVE',
      data.active ?? true,
      id,
    ]
  );

  // Update admin user if provided
  if (data.adminName || data.adminEmail || data.adminMobile || data.adminPassword) {
    const [[store]] = await db.query('SELECT store_admin_id FROM stores WHERE id = ?', [id]);
    if (store?.store_admin_id) {
      const updates = [];
      const vals = [];
      if (data.adminName)   { updates.push('name = ?');   vals.push(data.adminName); }
      if (data.adminEmail)  { updates.push('email = ?');  vals.push(data.adminEmail); }
      if (data.adminMobile) { updates.push('mobile = ?'); vals.push(data.adminMobile); }
      if (data.adminPassword) {
        const hash = await bcrypt.hash(data.adminPassword, 10);
        updates.push('password_hash = ?');
        vals.push(hash);
      }
      if (updates.length) {
        vals.push(store.store_admin_id);
        await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, vals);
      }
    }
  }

  // Update subscription — sync both end_date and status
  if (data.subscriptionExpiresAt || data.subscriptionStatus) {
    const [[sub]] = await db.query('SELECT id FROM subscriptions WHERE store_id = ?', [id]);
    if (sub) {
      const updates = [];
      const vals = [];
      if (data.subscriptionExpiresAt) { updates.push('end_date = ?'); vals.push(data.subscriptionExpiresAt); }
      if (data.subscriptionStatus)    { updates.push('status = ?');   vals.push(data.subscriptionStatus); }
      if (updates.length) {
        vals.push(id);
        await db.query(`UPDATE subscriptions SET ${updates.join(', ')} WHERE store_id = ?`, vals);
      }
    }
  }

  return getStoreById(id);
};

// Full store + admin creation in one transaction — all 13 fields
const createStoreWithAdmin = async (data) => {
  const {
    // Store fields
    name, address, city, state, contact, email,
    onlinePaymentEnabled = false,
    subscriptionStatus = 'ACTIVE',
    subscriptionExpiresAt,
    // Admin fields
    adminName, adminMobile, adminEmail, adminPassword,
  } = data;

  if (!name) throw new Error('STORE_NAME_REQUIRED');
  if (!adminName) throw new Error('ADMIN_NAME_REQUIRED');
  if (!adminEmail && !adminMobile) throw new Error('ADMIN_EMAIL_OR_MOBILE_REQUIRED');
  if (!adminPassword) throw new Error('ADMIN_PASSWORD_REQUIRED');

  // Check duplicate admin email/mobile
  if (adminEmail) {
    const [[byEmail]] = await db.query('SELECT id FROM users WHERE email = ?', [adminEmail]);
    if (byEmail) throw new Error('ADMIN_EMAIL_ALREADY_EXISTS');
  }
  if (adminMobile) {
    const [[byMobile]] = await db.query('SELECT id FROM users WHERE mobile = ?', [adminMobile]);
    if (byMobile) throw new Error('ADMIN_MOBILE_ALREADY_EXISTS');
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    // 1. Create store with all fields
    const [storeResult] = await conn.query(
      `INSERT INTO stores (name, address, city, state, contact, email, subscription_status, online_payment_enabled, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE)`,
      [name, address || null, city || null, state || null, contact || null, email || null, subscriptionStatus, onlinePaymentEnabled]
    );
    const storeId = storeResult.insertId;

    // 2. Hash password and create admin user
    const hash = await bcrypt.hash(adminPassword, 10);
    const [userResult] = await conn.query(
      'INSERT INTO users (name, email, mobile, password_hash, first_login, active) VALUES (?, ?, ?, ?, TRUE, TRUE)',
      [adminName, adminEmail || null, adminMobile || null, hash]
    );
    const userId = userResult.insertId;

    // 3. Create STORE_ADMIN role for this store
    const [roleResult] = await conn.query(
      "INSERT INTO roles (store_id, name) VALUES (?, 'STORE_ADMIN')",
      [storeId]
    );
    const roleId = roleResult.insertId;

    // 4. Assign all permissions except stores/subscriptions management
    const [perms] = await conn.query(
      "SELECT id FROM permissions WHERE resource NOT IN ('stores', 'subscriptions', 'system_settings')"
    );
    if (perms.length) {
      const vals = perms.map(p => [roleId, p.id]);
      await conn.query('INSERT INTO role_permissions (role_id, permission_id) VALUES ?', [vals]);
    }

    // 5. Assign role to admin user
    await conn.query(
      'INSERT INTO user_roles (user_id, role_id, store_id) VALUES (?, ?, ?)',
      [userId, roleId, storeId]
    );

    // 6. Set store_admin_id
    await conn.query('UPDATE stores SET store_admin_id = ? WHERE id = ?', [userId, storeId]);

    // 7. Store settings defaults
    await conn.query(
      "INSERT INTO store_settings (store_id, receipt_prefix, challan_prefix, auto_approve_cash, cash_approval_limit) VALUES (?, 'REC', 'CHL', FALSE, 0)",
      [storeId]
    );

    // 8. Receipt + Challan sequences
    const year = new Date().getFullYear();
    await conn.query('INSERT INTO receipt_sequences (store_id, year, last_sequence) VALUES (?, ?, 0)', [storeId, year]);
    await conn.query('INSERT INTO challan_sequences (store_id, year, last_sequence) VALUES (?, ?, 0)', [storeId, year]);

    // 9. Subscription
    const endDate = subscriptionExpiresAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await conn.query(
      "INSERT INTO subscriptions (store_id, plan_type, status, end_date) VALUES (?, 'FREE', 'TRIAL', ?)",
      [storeId, endDate]
    );

    await conn.commit();
    return { storeId, userId, storeName: name, adminName, message: 'Store created successfully' };
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
