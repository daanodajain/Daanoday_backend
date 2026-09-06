const db = require('../config/db');
const audit = require('./auditLogService');

// ─────────────────────────────────────────────────────────────
// CORE: single reusable function — called by receipt creation
// and anywhere a customer needs to be linked to a store.
// ─────────────────────────────────────────────────────────────
const findOrCreateCustomerForStore = async (mobile, name, storeId, callerUserId = null, conn = null) => {
  const q = conn || db;

  // 1. Find or create customer (global by mobile)
  let [[customer]] = await q.query('SELECT id, name FROM customers WHERE mobile = ?', [mobile]);
  if (!customer) {
    const [result] = await q.query(
      'INSERT INTO customers (name, mobile, first_login) VALUES (?, ?, TRUE)',
      [name, mobile]
    );
    customer = { id: result.insertId, name };
  }

  // 2. Find or create store access with store-specific account number
  let [[access]] = await q.query(
    'SELECT id, account_number FROM customer_store_access WHERE customer_id = ? AND store_id = ?',
    [customer.id, storeId]
  );
  if (!access) {
    const accountNumber = await _generateAccountNumber(storeId, q);
    // First store this customer is linked to becomes their primary store
    const [[existingCount]] = await q.query(
      'SELECT COUNT(*) as cnt FROM customer_store_access WHERE customer_id = ?',
      [customer.id]
    );
    const isPrimary = existingCount.cnt === 0;
    await q.query(
      'INSERT INTO customer_store_access (customer_id, store_id, account_number, is_primary_store) VALUES (?, ?, ?, ?)',
      [customer.id, storeId, accountNumber, isPrimary]
    );
    access = { account_number: accountNumber };
  }

  // 3. Link to staff user if caller is logged-in staff and not yet linked
  if (callerUserId) {
    await q.query(
      'UPDATE users SET linked_customer_id = ? WHERE id = ? AND linked_customer_id IS NULL',
      [customer.id, callerUserId]
    );
  }

  return { customerId: customer.id, accountNumber: access.account_number };
};

const _generateAccountNumber = async (storeId, q) => {
  const [[settings]] = await q.query('SELECT receipt_prefix FROM store_settings WHERE store_id = ?', [storeId]);
  const prefix = settings ? `CUST${storeId}` : `CUST${storeId}`;
  const [[cnt]] = await q.query(
    'SELECT COUNT(*) as cnt FROM customer_store_access WHERE store_id = ?', [storeId]
  );
  return `${prefix}${String(cnt.cnt + 1).padStart(6, '0')}`;
};

// ─────────────────────────────────────────────────────────────
// CRUD
// ─────────────────────────────────────────────────────────────
const getAllCustomers = async (storeId) => {
  const [rows] = await db.query(
    `SELECT c.id, c.name, c.mobile, c.first_login, c.created_at,
            csa.account_number, csa.is_primary_store
     FROM customers c
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = ?
     ORDER BY c.name`,
    [storeId]
  );
  return rows;
};

const getCustomerById = async (id, storeId) => {
  const [[row]] = await db.query(
    `SELECT c.id, c.name, c.mobile, c.first_login, c.created_at,
            csa.account_number, csa.is_primary_store
     FROM customers c
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = ?
     WHERE c.id = ?`,
    [storeId, id]
  );
  if (!row) throw new Error('CUSTOMER_NOT_FOUND');
  return row;
};

const createCustomer = async (data, storeId, callerUserId = null) => {
  const { customerId } = await findOrCreateCustomerForStore(
    data.mobile, data.name, storeId, callerUserId
  );
  // Update extra fields if provided
  const fields = [];
  const vals = [];
  if (data.email !== undefined)   { fields.push('email = ?');   vals.push(data.email || null); }
  if (data.address !== undefined) { fields.push('address = ?'); vals.push(data.address || null); }
  if (data.password) {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(data.password, 10);
    fields.push('password_hash = ?', 'first_login = FALSE');
    vals.push(hash);
  }
  if (fields.length) {
    vals.push(customerId);
    await db.query(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`, vals);
  }
  await audit.log({ storeId, userId: callerUserId, action: 'CUSTOMER_CREATED', entityType: 'CUSTOMER', entityId: customerId,
    details: { name: data.name, mobile: data.mobile } });
  return getCustomerById(customerId, storeId);
};

const updateCustomer = async (id, storeId, data) => {
  const [[access]] = await db.query(
    'SELECT id FROM customer_store_access WHERE customer_id = ? AND store_id = ?', [id, storeId]
  );
  if (!access) throw new Error('CUSTOMER_NOT_FOUND');
  const fields = ['name = ?', 'mobile = ?'];
  const vals = [data.name, data.mobile];
  if (data.email !== undefined)   { fields.push('email = ?');   vals.push(data.email || null); }
  if (data.address !== undefined) { fields.push('address = ?'); vals.push(data.address || null); }
  if (data.password) {
    const bcrypt = require('bcryptjs');
    const hash = await bcrypt.hash(data.password, 10);
    fields.push('password_hash = ?', 'first_login = FALSE');
    vals.push(hash);
  }
  vals.push(id);
  await db.query(`UPDATE customers SET ${fields.join(', ')} WHERE id = ?`, vals);
  return getCustomerById(id, storeId);
};

const deleteCustomer = async (id, storeId) => {
  const [[access]] = await db.query(
    'SELECT id FROM customer_store_access WHERE customer_id = ? AND store_id = ?', [id, storeId]
  );
  if (!access) throw new Error('CUSTOMER_NOT_FOUND');
  // Soft-remove from store access only — customer record stays (may exist in other stores)
  await db.query('DELETE FROM customer_store_access WHERE customer_id = ? AND store_id = ?', [id, storeId]);
};

const searchCustomers = async (storeId, query) => {
  const [rows] = await db.query(
    `SELECT c.id, c.name, c.mobile, csa.account_number
     FROM customers c
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = ?
     WHERE c.name LIKE ? OR c.mobile LIKE ? OR csa.account_number LIKE ?
     LIMIT 20`,
    [storeId, `%${query}%`, `%${query}%`, `%${query}%`]
  );
  return rows;
};

module.exports = {
  findOrCreateCustomerForStore,
  getAllCustomers, getCustomerById, createCustomer, updateCustomer, deleteCustomer, searchCustomers
};
