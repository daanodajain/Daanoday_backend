const db = require('../config/db');
const { findOrCreateCustomerForStore } = require('./customerService');

// ── Number generation ────────────────────────────────────────
const _generateReceiptNumber = async (storeId, conn) => {
  const year = new Date().getFullYear();
  const [[settings]] = await conn.query('SELECT receipt_prefix FROM store_settings WHERE store_id = ?', [storeId]);
  const prefix = settings?.receipt_prefix || 'REC';

  const [[seq]] = await conn.query(
    'SELECT id, last_sequence FROM receipt_sequences WHERE store_id = ? AND year = ? FOR UPDATE',
    [storeId, year]
  );
  if (!seq) {
    await conn.query('INSERT INTO receipt_sequences (store_id, year, last_sequence) VALUES (?, ?, 1)', [storeId, year]);
    return `${prefix}${year}000001`;
  }
  const next = seq.last_sequence + 1;
  await conn.query('UPDATE receipt_sequences SET last_sequence = ? WHERE id = ?', [next, seq.id]);
  return `${prefix}${year}${String(next).padStart(6, '0')}`;
};

// ── Lock period guard ────────────────────────────────────────
const _checkLockPeriod = async (storeId) => {
  const [[s]] = await db.query('SELECT locked_before_date FROM store_settings WHERE store_id = ?', [storeId]);
  if (s?.locked_before_date && new Date() < new Date(s.locked_before_date)) {
    throw new Error(`PERIOD_LOCKED: Records locked before ${s.locked_before_date}`);
  }
};

// ── Read ─────────────────────────────────────────────────────
const getAll = async (storeId) => {
  const [rows] = await db.query(
    `SELECT r.*, c.name as customer_name, c.mobile as customer_mobile,
            csa.account_number, u.name as created_by_name
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = r.store_id
     JOIN users u ON u.id = r.created_by
     WHERE r.store_id = ?
     ORDER BY r.created_at DESC`,
    [storeId]
  );
  return rows;
};

const getById = async (id, storeId) => {
  const [[receipt]] = await db.query(
    `SELECT r.*, c.name as customer_name, c.mobile as customer_mobile,
            csa.account_number, u.name as created_by_name
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = r.store_id
     JOIN users u ON u.id = r.created_by
     WHERE r.id = ? AND r.store_id = ?`,
    [id, storeId]
  );
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
  const [particulars] = await db.query('SELECT * FROM receipt_particulars WHERE receipt_id = ?', [id]);
  receipt.particulars = particulars;
  return receipt;
};

const getPendingApprovals = async (storeId) => {
  const [rows] = await db.query(
    `SELECT r.*, c.name as customer_name, c.mobile as customer_mobile
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     WHERE r.store_id = ? AND r.receipt_state = 'PENDING_APPROVAL'
     ORDER BY r.created_at DESC`,
    [storeId]
  );
  return rows;
};

const getByDateRange = async (storeId, startDate, endDate) => {
  const [rows] = await db.query(
    `SELECT r.*, c.name as customer_name
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     WHERE r.store_id = ? AND DATE(r.created_at) BETWEEN ? AND ?
     ORDER BY r.created_at DESC`,
    [storeId, startDate, endDate]
  );
  return rows;
};

// ── Create (state machine entry point) ───────────────────────
const create = async (data, storeId, userId) => {
  await _checkLockPeriod(storeId);

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    // Resolve customer — create if needed, link staff user
    const { customerId } = await findOrCreateCustomerForStore(
      data.customerMobile, data.customerName, storeId, userId, conn
    );

    const [[settings]] = await conn.query(
      'SELECT auto_approve_cash, cash_approval_limit FROM store_settings WHERE store_id = ?',
      [storeId]
    );

    const needsApproval = data.paymentMode === 'CASH'
      && settings
      && !settings.auto_approve_cash
      && Number(data.totalAmount) > Number(settings.cash_approval_limit || 0);

    const receiptState = needsApproval ? 'PENDING_APPROVAL' : 'APPROVED';
    const status = needsApproval ? 'UNPAID' : 'PAID';

    const receiptNumber = await _generateReceiptNumber(storeId, conn);

    const [result] = await conn.query(
      `INSERT INTO receipts (store_id, receipt_number, customer_id, total_amount, payment_mode, receipt_state, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [storeId, receiptNumber, customerId, data.totalAmount, data.paymentMode, receiptState, status, userId]
    );
    const receiptId = result.insertId;

    // Insert particulars
    if (data.particulars?.length) {
      const vals = data.particulars.map(p => [receiptId, p.particularId, p.particularName, p.amount]);
      await conn.query(
        'INSERT INTO receipt_particulars (receipt_id, particular_id, particular_name, amount) VALUES ?',
        [vals]
      );
    }

    // Create transaction record
    const txnStatus = needsApproval ? 'INITIATED' : 'SUCCESS';
    await conn.query(
      'INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status) VALUES (?, ?, ?, ?, ?, ?)',
      [storeId, 'RECEIPT', receiptId, data.totalAmount, data.paymentMode, txnStatus]
    );

    await conn.commit();
    return getById(receiptId, storeId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ── Approve (PENDING_APPROVAL → APPROVED) ────────────────────
const approveReceipt = async (id, storeId, userId, note) => {
  const [[receipt]] = await db.query(
    'SELECT * FROM receipts WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
  if (receipt.receipt_state !== 'PENDING_APPROVAL') throw new Error('NOT_PENDING_APPROVAL');

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query(
      "UPDATE receipts SET receipt_state = 'APPROVED', status = 'PAID' WHERE id = ?", [id]
    );
    await conn.query(
      "INSERT INTO receipt_approvals (receipt_id, approved_by, action, note) VALUES (?, ?, 'APPROVED', ?)",
      [id, userId, note || null]
    );
    await conn.query(
      "UPDATE transactions SET status = 'SUCCESS' WHERE type = 'RECEIPT' AND reference_id = ?", [id]
    );
    await conn.commit();
    return getById(id, storeId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ── Reject (PENDING_APPROVAL → REJECTED) ─────────────────────
const rejectReceipt = async (id, storeId, userId, note) => {
  const [[receipt]] = await db.query(
    'SELECT * FROM receipts WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
  if (receipt.receipt_state !== 'PENDING_APPROVAL') throw new Error('NOT_PENDING_APPROVAL');

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query(
      "UPDATE receipts SET receipt_state = 'REJECTED' WHERE id = ?", [id]
    );
    await conn.query(
      "INSERT INTO receipt_approvals (receipt_id, approved_by, action, note) VALUES (?, ?, 'REJECTED', ?)",
      [id, userId, note || null]
    );
    await conn.query(
      "UPDATE transactions SET status = 'FAILED' WHERE type = 'RECEIPT' AND reference_id = ?", [id]
    );
    await conn.commit();
    return getById(id, storeId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};



// State change (generic — covers VOID, CANCELLED etc.)
const changeState = async (id, storeId, userId, newState, note) => {
  const [[receipt]] = await db.query(
    'SELECT * FROM receipts WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');

  await db.query('UPDATE receipts SET receipt_state = ? WHERE id = ?', [newState, id]);
  await db.query(
    'INSERT INTO receipt_approvals (receipt_id, approved_by, action, note) VALUES (?, ?, ?, ?)',
    [id, userId, newState, note || null]
  );
  return getById(id, storeId);
};

// Mark receipt as paid (UNPAID → PAID)
const markPaid = async (id, storeId, userId) => {
  const [[receipt]] = await db.query(
    'SELECT * FROM receipts WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
  if (receipt.status === 'PAID') throw new Error('ALREADY_PAID');

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query("UPDATE receipts SET status = 'PAID' WHERE id = ?", [id]);
    await conn.query(
      "UPDATE transactions SET status = 'SUCCESS' WHERE type = 'RECEIPT' AND reference_id = ?", [id]
    );
    await conn.commit();
    return getById(id, storeId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// Get approval history for a receipt
const getApprovals = async (id, storeId) => {
  const [[receipt]] = await db.query(
    'SELECT id FROM receipts WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');

  const [rows] = await db.query(
    `SELECT ra.*, u.name as approved_by_name
     FROM receipt_approvals ra
     LEFT JOIN users u ON u.id = ra.approved_by
     WHERE ra.receipt_id = ?
     ORDER BY ra.created_at ASC`,
    [id]
  );
  return rows;
};

module.exports = { getAll, getById, create, approveReceipt, rejectReceipt, getPendingApprovals, getByDateRange, changeState, markPaid, getApprovals };
