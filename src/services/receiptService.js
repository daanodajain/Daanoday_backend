const db = require('../config/db');
const { findOrCreateCustomerForStore } = require('./customerService');
const notifSvc = require('./notificationService');
const audit = require('./auditLogService');

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
const getAll = async (storeId, filters = {}) => {
  const { search, status, receipt_state, startDate, endDate, limit = 50, offset = 0 } = filters;
  const conditions = ['r.store_id = ?'];
  const params = [storeId];

  if (search) {
    conditions.push('(c.name LIKE ? OR c.mobile LIKE ? OR r.receipt_number LIKE ? OR csa.account_number LIKE ?)');
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }
  if (status) { conditions.push('r.status = ?'); params.push(status); }
  if (receipt_state) { conditions.push('r.receipt_state = ?'); params.push(receipt_state); }
  if (startDate) { conditions.push('DATE(r.created_at) >= ?'); params.push(startDate); }
  if (endDate) { conditions.push('DATE(r.created_at) <= ?'); params.push(endDate); }

  const finalLimit = Math.min(Number(limit) || 50, 500);
  const finalOffset = Math.max(Number(offset) || 0, 0);

  const [[{ total }]] = await db.query(
    `SELECT COUNT(*) as total FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = r.store_id
     WHERE ${conditions.join(' AND ')}`,
    params
  );

  const [rows] = await db.query(
    `SELECT r.*, c.name as customer_name, c.mobile as customer_mobile,
            csa.account_number, u.name as created_by_name
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = r.store_id
     JOIN users u ON u.id = r.created_by
     WHERE ${conditions.join(' AND ')}
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, finalLimit, finalOffset]
  );
  return { rows, total, limit: finalLimit, offset: finalOffset };
};

const getById = async (id, storeId) => {
  const [[receipt]] = await db.query(
    `SELECT r.*, c.name as customer_name, c.mobile as customer_mobile,
            csa.account_number, u.name as created_by_name,
            s.name as store_name, s.address as store_address,
            s.contact as store_contact, s.email as store_email
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = r.store_id
     JOIN users u ON u.id = r.created_by
     JOIN stores s ON s.id = r.store_id
     WHERE r.id = ? AND r.store_id = ?`,
    [id, storeId]
  );
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
  const [particulars] = await db.query('SELECT * FROM receipt_particulars WHERE receipt_id = ?', [id]);
  receipt.particulars = particulars;
  return receipt;
};

const getPendingApprovals = async (storeId, limit = 50, offset = 0) => {
  const finalLimit = Math.min(Number(limit) || 50, 500);
  const finalOffset = Math.max(Number(offset) || 0, 0);
  const [rows] = await db.query(
    `SELECT r.*, c.name as customer_name, c.mobile as customer_mobile
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     WHERE r.store_id = ? AND r.receipt_state = 'PENDING_APPROVAL'
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [storeId, finalLimit, finalOffset]
  );
  return rows;
};

const getByDateRange = async (storeId, startDate, endDate, limit = 50, offset = 0) => {
  if (!startDate || !endDate) throw new Error('START_DATE_AND_END_DATE_REQUIRED');
  const finalLimit = Math.min(Number(limit) || 50, 500);
  const finalOffset = Math.max(Number(offset) || 0, 0);
  const [rows] = await db.query(
    `SELECT r.*, c.name as customer_name, c.mobile as customer_mobile,
            csa.account_number, u.name as created_by_name
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = r.store_id
     JOIN users u ON u.id = r.created_by
     WHERE r.store_id = ? AND DATE(r.created_at) BETWEEN ? AND ?
     ORDER BY r.created_at DESC
     LIMIT ? OFFSET ?`,
    [storeId, startDate, endDate, finalLimit, finalOffset]
  );
  return rows;
};

// ── Create (state machine entry point) ───────────────────────
const create = async (data, storeId, userId) => {
  await _checkLockPeriod(storeId);

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const { customerId, accountNumber } = await findOrCreateCustomerForStore(
      data.customerMobile, data.customerName, storeId, userId, conn
    );
    const [[customerRow]] = await conn.query('SELECT name FROM customers WHERE id = ?', [customerId]);
    const customerName = customerRow?.name || data.customerName;

    const isDue = data.isDue === true || data.isDue === 'true';
    const isPartial = !isDue && (data.isPartial === true || data.isPartial === 'true');

    // Partial payment: sum whatever was actually paid per-particular (falls
    // back to the flat data.paidAmount if particulars don't carry their own
    // paidAmount). Due receipts are always 0 paid; full receipts are fully paid.
    let paidAmount;
    if (isDue) {
      paidAmount = 0;
    } else if (isPartial) {
      if (data.particulars?.some(p => p.paidAmount !== undefined)) {
        paidAmount = data.particulars.reduce((sum, p) => sum + Number(p.paidAmount || 0), 0);
      } else {
        paidAmount = Number(data.paidAmount || 0);
      }
      if (paidAmount <= 0) throw new Error('PARTIAL_PAYMENT_MUST_BE_GREATER_THAN_ZERO');
      if (paidAmount >= Number(data.totalAmount)) throw new Error('PARTIAL_PAYMENT_MUST_BE_LESS_THAN_TOTAL');
    } else {
      paidAmount = Number(data.totalAmount);
    }

    const [[settings]] = await conn.query(
      'SELECT auto_approve_cash, cash_approval_limit FROM store_settings WHERE store_id = ?',
      [storeId]
    );

    // Due receipt — apply cash approval check too
    let receiptState, status;
    if (isDue) {
      const needsApproval = settings
        && !settings.auto_approve_cash
        && Number(data.totalAmount) > Number(settings.cash_approval_limit || 0);
      receiptState = needsApproval ? 'PENDING_APPROVAL' : 'APPROVED';
      status = 'UNPAID';
    } else {
      const needsApproval = data.paymentMode === 'CASH'
        && settings
        && !settings.auto_approve_cash
        && Number(data.totalAmount) > Number(settings.cash_approval_limit || 0);
      receiptState = needsApproval ? 'PENDING_APPROVAL' : 'APPROVED';
      status = needsApproval ? 'UNPAID' : (isPartial ? 'PARTIAL' : 'PAID');
    }

    const receiptNumber = await _generateReceiptNumber(storeId, conn);
    const receiptDate = data.receiptDate || new Date().toISOString().split('T')[0];
    const paymentDate = isDue ? null : (data.paymentDate || receiptDate);
    const paymentMode = isDue ? null : (data.paymentMode || 'CASH');

    const [result] = await conn.query(
      `INSERT INTO receipts
        (store_id, receipt_number, customer_id, total_amount, paid_amount, payment_mode,
         receipt_date, payment_date, is_due, remarks,
         receipt_state, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [storeId, receiptNumber, customerId, data.totalAmount, paidAmount, paymentMode,
       receiptDate, paymentDate, isDue, data.remarks || null,
       receiptState, status, userId]
    );
    const receiptId = result.insertId;

    if (data.particulars?.length) {
      const vals = data.particulars.map(p => {
        // Each particular's own paid amount: explicit value if partial with
        // per-line tracking, else fully paid/unpaid matching the receipt.
        let pPaid;
        if (isDue) pPaid = 0;
        else if (isPartial && p.paidAmount !== undefined) pPaid = Number(p.paidAmount || 0);
        else if (isPartial) pPaid = 0; // flat partial without per-line split — reconciled later
        else pPaid = Number(p.amount);
        return [receiptId, p.particularId, p.particularName, p.amount, pPaid];
      });
      await conn.query(
        'INSERT INTO receipt_particulars (receipt_id, particular_id, particular_name, amount, paid_amount) VALUES ?',
        [vals]
      );
    }

    const txnStatus = status === 'PAID' ? 'SUCCESS' : (status === 'PARTIAL' ? 'SUCCESS' : 'INITIATED');
    await conn.query(
      'INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status) VALUES (?, ?, ?, ?, ?, ?)',
      [storeId, 'RECEIPT', receiptId, paidAmount, paymentMode, txnStatus]
    );

    await conn.commit();
    // Audit log
    await audit.log({ storeId, userId, action: 'RECEIPT_CREATED', entityType: 'RECEIPT', entityId: receiptId,
      details: { receipt_number: receiptNumber, amount: data.totalAmount, customer_name: customerName, account_number: accountNumber, state: receiptState } });
    // Notify store admins if pending approval
    if (receiptState === 'PENDING_APPROVAL') {
      try {
        const [admins] = await db.query(
          `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
           WHERE ur.store_id = ? AND r.name IN ('STORE_ADMIN','SUB_ADMIN') AND u.id != ?`,
          [storeId, userId]
        );
        for (const admin of admins) {
          await notifSvc.create(admin.id, storeId, {
            type: 'RECEIPT_APPROVAL',
            message: `New receipt ${receiptNumber} of ₹${data.totalAmount} requires approval`,
            referenceId: receiptId, referenceType: 'RECEIPT'
          });
        }
      } catch(e) { /* notification failure should not block receipt creation */ }
    }
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
    // Status must reflect actual paid_amount vs total_amount — NOT be
    // hardcoded to PAID. A partial-payment or due receipt that needed cash
    // approval must stay PARTIAL/UNPAID after approval, not silently become
    // fully paid (that was making customers who still owe money show as
    // fully settled the moment their receipt got approved).
    const paidAmount = Number(receipt.paid_amount || 0);
    const totalAmount = Number(receipt.total_amount);
    const status = paidAmount <= 0 ? 'UNPAID' : (paidAmount >= totalAmount ? 'PAID' : 'PARTIAL');

    await conn.query(
      "UPDATE receipts SET receipt_state = 'APPROVED', status = ? WHERE id = ?", [status, id]
    );
    await conn.query(
      "INSERT INTO receipt_approvals (receipt_id, approved_by, action, note) VALUES (?, ?, 'APPROVED', ?)",
      [id, userId, note || null]
    );
    await conn.query(
      "UPDATE transactions SET status = 'SUCCESS' WHERE type = 'RECEIPT' AND reference_id = ?", [id]
    );
    await conn.commit();
    await audit.log({ storeId, userId, action: 'RECEIPT_APPROVED', entityType: 'RECEIPT', entityId: id,
      details: { receipt_number: receipt.receipt_number, amount: receipt.total_amount, note } });
    // Notify receipt creator
    try {
      await notifSvc.create(receipt.created_by, storeId, {
        type: 'SUCCESS',
        message: `Receipt ${receipt.receipt_number} of ₹${receipt.total_amount} has been approved`,
        referenceId: id, referenceType: 'RECEIPT'
      });
    } catch(e) {}
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
      "UPDATE receipts SET receipt_state = 'REJECTED', status = 'REJECTED' WHERE id = ?", [id]
    );
    await conn.query(
      "INSERT INTO receipt_approvals (receipt_id, approved_by, action, note) VALUES (?, ?, 'REJECTED', ?)",
      [id, userId, note || null]
    );
    await conn.query(
      "UPDATE transactions SET status = 'FAILED' WHERE type = 'RECEIPT' AND reference_id = ?", [id]
    );
    await conn.commit();
    await audit.log({ storeId, userId, action: 'RECEIPT_REJECTED', entityType: 'RECEIPT', entityId: id,
      details: { receipt_number: receipt.receipt_number, amount: receipt.total_amount, note } });
    // Notify receipt creator of rejection
    try {
      await notifSvc.create(receipt.created_by, storeId, {
        type: 'ERROR',
        message: `Receipt ${receipt.receipt_number} of ₹${receipt.total_amount} has been rejected${note ? ': ' + note : ''}`,
        referenceId: id, referenceType: 'RECEIPT'
      });
    } catch(e) {}
    return getById(id, storeId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};



// State change (generic — covers VOID, CANCELLED etc.)
// Only APPROVED → CANCELLED is currently a valid transition via this path.
// receipt_approvals.action ENUM only accepts 'APPROVED'|'REJECTED' so we
// log 'APPROVED' for a cancellation action (it means "change approved").
const changeState = async (id, storeId, userId, newState, note) => {
  const VALID_STATES = ['CANCELLED'];
  if (!VALID_STATES.includes(newState)) throw new Error(`INVALID_STATE: ${newState}. Valid: ${VALID_STATES.join(',')}`);

  const [[receipt]] = await db.query(
    'SELECT * FROM receipts WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
  if (receipt.receipt_state === newState) throw new Error('ALREADY_IN_STATE');

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query('UPDATE receipts SET receipt_state = ? WHERE id = ?', [newState, id]);
    if (newState === 'CANCELLED') {
      await conn.query(
        "UPDATE transactions SET status = 'FAILED' WHERE type = 'RECEIPT' AND reference_id = ?", [id]
      );
    }
    // receipt_approvals ENUM only has APPROVED/REJECTED — log as APPROVED (the state-change request was approved)
    await conn.query(
      "INSERT INTO receipt_approvals (receipt_id, approved_by, action, note) VALUES (?, ?, 'APPROVED', ?)",
      [id, userId, note || null]
    );
    await conn.commit();
    await audit.log({ storeId, userId, action: `RECEIPT_STATE_CHANGED_TO_${newState}`, entityType: 'RECEIPT', entityId: id,
      details: { receipt_number: receipt.receipt_number, from_state: receipt.receipt_state, to_state: newState, note } });
    return getById(id, storeId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// Mark receipt as paid (UNPAID → PAID or UNPAID → PENDING_APPROVAL).
// paymentMode is required when the receipt was created as "due" (no payment
// mode was known at creation time).
// If the payment mode is CASH and the store's cash_approval_limit applies,
// the receipt goes to PENDING_APPROVAL instead of being directly paid — same
// logic as the create() flow, closing the due-receipt approval bypass.
const markPaid = async (id, storeId, userId, paymentMode) => {
  const [[receipt]] = await db.query(
    'SELECT * FROM receipts WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
  if (receipt.status === 'PAID') throw new Error('ALREADY_PAID');
  if (receipt.receipt_state === 'PENDING_APPROVAL') throw new Error('ALREADY_PENDING_APPROVAL');
  if (['REJECTED', 'CANCELLED'].includes(receipt.receipt_state)) throw new Error('CANNOT_PAY_REJECTED_OR_CANCELLED_RECEIPT');
  if (!receipt.payment_mode && !paymentMode) throw new Error('PAYMENT_MODE_REQUIRED');

  const finalMode = paymentMode || receipt.payment_mode;
  const today = new Date().toISOString().split('T')[0];

  // Cash approval check — same rule as create()
  const [[settings]] = await db.query(
    'SELECT auto_approve_cash, cash_approval_limit FROM store_settings WHERE store_id = ?',
    [storeId]
  );
  const needsApproval = finalMode === 'CASH'
    && settings
    && !settings.auto_approve_cash
    && Number(receipt.total_amount) > Number(settings.cash_approval_limit || 0);

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    if (needsApproval) {
      // Send for approval — don't mark paid yet
      await conn.query(
        "UPDATE receipts SET receipt_state = 'PENDING_APPROVAL', payment_mode = ? WHERE id = ?",
        [finalMode, id]
      );
      await conn.query(
        "UPDATE transactions SET payment_mode = ? WHERE type = 'RECEIPT' AND reference_id = ?",
        [finalMode, id]
      );
      await conn.commit();
      await audit.log({ storeId, userId, action: 'RECEIPT_PAYMENT_PENDING_APPROVAL', entityType: 'RECEIPT', entityId: id,
        details: { receipt_number: receipt.receipt_number, amount: receipt.total_amount, payment_mode: finalMode } });
      // Notify approvers
      try {
        const [admins] = await db.query(
          `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
           WHERE ur.store_id = ? AND r.name IN ('STORE_ADMIN','SUB_ADMIN') AND u.id != ?`,
          [storeId, userId]
        );
        for (const admin of admins) {
          await notifSvc.create(admin.id, storeId, {
            type: 'RECEIPT_APPROVAL',
            message: `Receipt ${receipt.receipt_number} of ₹${receipt.total_amount} payment requires approval`,
            referenceId: id, referenceType: 'RECEIPT'
          });
        }
      } catch(e) {}
    } else {
      await conn.query(
        "UPDATE receipts SET status = 'PAID', payment_mode = ?, payment_date = COALESCE(payment_date, ?), paid_amount = total_amount WHERE id = ?",
        [finalMode, today, id]
      );
      await conn.query(
        "UPDATE transactions SET status = 'SUCCESS', payment_mode = ?, amount = ? WHERE type = 'RECEIPT' AND reference_id = ?",
        [finalMode, receipt.total_amount, id]
      );
      // Also mark particulars as fully paid
      await conn.query(
        'UPDATE receipt_particulars SET paid_amount = amount WHERE receipt_id = ?',
        [id]
      );
      await conn.commit();
      await audit.log({ storeId, userId, action: 'RECEIPT_MARKED_PAID', entityType: 'RECEIPT', entityId: id,
        details: { receipt_number: receipt.receipt_number, amount: receipt.total_amount, payment_mode: finalMode } });
    }
    return getById(id, storeId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// Collect the remaining due amount on a PARTIAL receipt, closing it to PAID.
// Distributes the newly collected amount across particulars in order until
// each particular's own remaining due is covered (so particular-level
// paid_amount stays accurate even if the original partial payment wasn't
// split evenly across particulars).
const collectRemaining = async (id, storeId, userId, paymentMode, paymentDate) => {
  const [[receipt]] = await db.query(
    'SELECT * FROM receipts WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
  if (receipt.status !== 'PARTIAL') throw new Error('RECEIPT_NOT_PARTIAL');

  const remaining = Number(receipt.total_amount) - Number(receipt.paid_amount);
  if (remaining <= 0) throw new Error('NOTHING_REMAINING_TO_COLLECT');

  const finalMode = paymentMode || receipt.payment_mode;
  if (!finalMode) throw new Error('PAYMENT_MODE_REQUIRED');
  if (receipt.receipt_state === 'PENDING_APPROVAL') throw new Error('ALREADY_PENDING_APPROVAL');
  const today = new Date().toISOString().split('T')[0];

  // Cash approval check on the remaining amount — same rule as create() / markPaid()
  const [[settings]] = await db.query(
    'SELECT auto_approve_cash, cash_approval_limit FROM store_settings WHERE store_id = ?',
    [storeId]
  );
  const needsApproval = finalMode === 'CASH'
    && settings
    && !settings.auto_approve_cash
    && remaining > Number(settings.cash_approval_limit || 0);

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    if (needsApproval) {
      // Send remaining payment for approval
      await conn.query(
        "UPDATE receipts SET receipt_state = 'PENDING_APPROVAL', payment_mode = ? WHERE id = ?",
        [finalMode, id]
      );
      await conn.commit();
      await audit.log({ storeId, userId, action: 'RECEIPT_COLLECT_PENDING_APPROVAL', entityType: 'RECEIPT', entityId: id,
        details: { receipt_number: receipt.receipt_number, remaining_amount: remaining, payment_mode: finalMode } });
      try {
        const [admins] = await db.query(
          `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
           WHERE ur.store_id = ? AND r.name IN ('STORE_ADMIN','SUB_ADMIN') AND u.id != ?`,
          [storeId, userId]
        );
        for (const admin of admins) {
          await notifSvc.create(admin.id, storeId, {
            type: 'RECEIPT_APPROVAL',
            message: `Remaining ₹${remaining} for receipt ${receipt.receipt_number} requires approval`,
            referenceId: id, referenceType: 'RECEIPT'
          });
        }
      } catch(e) {}
      conn.release();
      return getById(id, storeId);
    }

    const [particulars] = await conn.query(
      'SELECT id, amount, paid_amount FROM receipt_particulars WHERE receipt_id = ? ORDER BY id', [id]
    );
    let leftToApply = remaining;
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
      "UPDATE receipts SET status = 'PAID', paid_amount = total_amount, payment_mode = ?, payment_date = ? WHERE id = ?",
      [finalMode, paymentDate || today, id]
    );
    await conn.query(
      'INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status) VALUES (?, ?, ?, ?, ?, ?)',
      [storeId, 'RECEIPT', id, remaining, finalMode, 'SUCCESS']
    );
    await conn.commit();
    await audit.log({ storeId, userId, action: 'RECEIPT_REMAINING_COLLECTED', entityType: 'RECEIPT', entityId: id,
      details: { receipt_number: receipt.receipt_number, remaining_collected: remaining, payment_mode: finalMode } });
    try {
      await notifSvc.create(receipt.created_by, storeId, {
        type: 'PAYMENT_RECEIVED',
        message: `Remaining ₹${remaining} collected for receipt ${receipt.receipt_number} — now fully paid`,
        referenceId: id, referenceType: 'RECEIPT'
      });
    } catch (e) {}
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

module.exports = { getAll, getById, create, approveReceipt, rejectReceipt, getPendingApprovals, getByDateRange, changeState, markPaid, collectRemaining, getApprovals };
