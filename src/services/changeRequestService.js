const db = require('../config/db');

// ── Helpers ──────────────────────────────────────────────────
const _checkLockPeriod = async (storeId, entityType, entityId) => {
  const [[s]] = await db.query('SELECT locked_before_date FROM store_settings WHERE store_id = ?', [storeId]);
  if (!s?.locked_before_date) return;

  const table = entityType === 'RECEIPT' ? 'receipts' : 'challans';
  const [[entity]] = await db.query(`SELECT created_at FROM ${table} WHERE id = ?`, [entityId]);
  if (entity && new Date(entity.created_at) < new Date(s.locked_before_date))
    throw new Error(`PERIOD_LOCKED: This record is locked before ${s.locked_before_date}`);
};

const _getRequesterRole = async (userId, storeId) => {
  const [[row]] = await db.query(
    `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? AND ur.store_id = ?`,
    [userId, storeId]
  );
  if (row) return row.name;
  // Check global SUPER_ADMIN
  const [[sa]] = await db.query(
    `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = ? AND r.name = 'SUPER_ADMIN'`,
    [userId]
  );
  return sa?.name || null;
};

// Returns array of user_ids who should approve this request
const _resolveApprovers = async (requestedByUserId, storeId, requesterRole) => {
  if (requesterRole !== 'STORE_ADMIN' && requesterRole !== 'SUPER_ADMIN') {
    // Staff → any STORE_ADMIN in this store
    const [admins] = await db.query(
      `SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
       WHERE ur.store_id = ? AND r.name = 'STORE_ADMIN'`,
      [storeId]
    );
    return admins.map(a => a.user_id);
  }

  // STORE_ADMIN → other admins in same store, else escalate to SUPER_ADMIN
  const [otherAdmins] = await db.query(
    `SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE ur.store_id = ? AND r.name = 'STORE_ADMIN' AND ur.user_id != ?`,
    [storeId, requestedByUserId]
  );
  if (otherAdmins.length) return otherAdmins.map(a => a.user_id);

  // Escalate to SUPER_ADMIN
  const [superAdmins] = await db.query(
    `SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE r.name = 'SUPER_ADMIN'`
  );
  return superAdmins.map(a => a.user_id);
};

// ── Create change request ────────────────────────────────────
const createChangeRequest = async ({ storeId, entityType, entityId, action, requestedBy, newData, reason }) => {
  await _checkLockPeriod(storeId, entityType, entityId);

  // Duplicate pending guard
  const [[existing]] = await db.query(
    "SELECT id FROM change_requests WHERE entity_type = ? AND entity_id = ? AND status = 'PENDING'",
    [entityType, entityId]
  );
  if (existing) throw new Error('PENDING_REQUEST_EXISTS: A change request is already pending for this record');

  // Snapshot current state
  const table = entityType === 'RECEIPT' ? 'receipts' : 'challans';
  const [[entity]] = await db.query(`SELECT * FROM ${table} WHERE id = ? AND store_id = ?`, [entityId, storeId]);
  if (!entity) throw new Error(`${entityType}_NOT_FOUND`);

  const [result] = await db.query(
    `INSERT INTO change_requests (store_id, entity_type, entity_id, action, requested_by, old_data, new_data, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [storeId, entityType, entityId, action, requestedBy, JSON.stringify(entity), newData ? JSON.stringify(newData) : null, reason]
  );
  const crId = result.insertId;

  // Notify approvers
  const requesterRole = await _getRequesterRole(requestedBy, storeId);
  const approverIds = await _resolveApprovers(requestedBy, storeId, requesterRole);

  if (approverIds.length) {
    const notifVals = approverIds.map(uid => [
      uid, storeId, 'CHANGE_REQUEST',
      `${action} request for ${entityType} #${entityId} needs your approval`,
      crId, 'CHANGE_REQUEST'
    ]);
    await db.query(
      'INSERT INTO notifications (user_id, store_id, type, message, reference_id, reference_type) VALUES ?',
      [notifVals]
    );
  }

  return getById(crId);
};

// ── Approve ──────────────────────────────────────────────────
const approveChangeRequest = async (id, reviewedBy, reviewNote) => {
  const [[cr]] = await db.query('SELECT * FROM change_requests WHERE id = ?', [id]);
  if (!cr) throw new Error('CHANGE_REQUEST_NOT_FOUND');
  if (cr.status !== 'PENDING') throw new Error('REQUEST_NOT_PENDING');

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    // 1. Update change_request status
    await conn.query(
      "UPDATE change_requests SET status = 'APPROVED', reviewed_by = ?, review_note = ?, reviewed_at = NOW() WHERE id = ?",
      [reviewedBy, reviewNote || null, id]
    );

    // 2. Apply the change atomically
    const table = cr.entity_type === 'RECEIPT' ? 'receipts' : 'challans';
    if (cr.action === 'DELETE') {
      if (cr.entity_type === 'RECEIPT') {
        await conn.query(
          "UPDATE receipts SET receipt_state = 'CANCELLED', cancel_reason = ? WHERE id = ?",
          [cr.reason, cr.entity_id]
        );
        await conn.query(
          "UPDATE transactions SET status = 'FAILED' WHERE type = 'RECEIPT' AND reference_id = ?",
          [cr.entity_id]
        );
      } else {
        await conn.query(
          "UPDATE challans SET status = 'CANCELLED', cancel_reason = ? WHERE id = ?",
          [cr.reason, cr.entity_id]
        );
        await conn.query(
          "UPDATE transactions SET status = 'FAILED' WHERE type = 'CHALLAN' AND reference_id = ?",
          [cr.entity_id]
        );
      }
    } else if (cr.action === 'UPDATE') {
      // NOTE: new_data is a MySQL JSON column — mysql2 auto-parses it into a
      // JS object on read, so cr.new_data is already an object here, not a
      // string. Calling JSON.parse() on it stringifies to "[object Object]"
      // first and then fails to parse — that was the "not valid JSON" 400.
      const newData = typeof cr.new_data === 'string' ? JSON.parse(cr.new_data) : cr.new_data;
      // Only allow safe fields to be updated
      const allowed = cr.entity_type === 'RECEIPT'
        ? ['total_amount', 'payment_mode']
        : ['total_amount', 'payment_mode', 'supplier_id'];
      const sets = [];
      const vals = [];
      for (const field of allowed) {
        if (newData[field] !== undefined) { sets.push(`${field} = ?`); vals.push(newData[field]); }
      }
      if (sets.length) {
        vals.push(cr.entity_id);
        await conn.query(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ?`, vals);
      }
    }

    // 3. Audit log
    await conn.query(
      `INSERT INTO audit_logs (store_id, user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, 'CHANGE_REQUEST_APPROVED', ?, ?, ?)`,
      [cr.store_id, reviewedBy, cr.entity_type, cr.entity_id, JSON.stringify({ changeRequestId: id, action: cr.action })]
    );

    await conn.commit();
    return getById(id);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ── Reject ───────────────────────────────────────────────────
const rejectChangeRequest = async (id, reviewedBy, reviewNote) => {
  const [[cr]] = await db.query('SELECT * FROM change_requests WHERE id = ?', [id]);
  if (!cr) throw new Error('CHANGE_REQUEST_NOT_FOUND');
  if (cr.status !== 'PENDING') throw new Error('REQUEST_NOT_PENDING');

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query(
      "UPDATE change_requests SET status = 'REJECTED', reviewed_by = ?, review_note = ?, reviewed_at = NOW() WHERE id = ?",
      [reviewedBy, reviewNote || null, id]
    );
    await conn.query(
      `INSERT INTO audit_logs (store_id, user_id, action, entity_type, entity_id, details)
       VALUES (?, ?, 'CHANGE_REQUEST_REJECTED', ?, ?, ?)`,
      [cr.store_id, reviewedBy, cr.entity_type, cr.entity_id, JSON.stringify({ changeRequestId: id })]
    );
    await conn.commit();
    return getById(id);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// ── Read ─────────────────────────────────────────────────────
const getAll = async (storeId, status = null) => {
  const where = status ? 'WHERE cr.store_id = ? AND cr.status = ?' : 'WHERE cr.store_id = ?';
  const params = status ? [storeId, status] : [storeId];
  const [rows] = await db.query(
    `SELECT cr.*, u.name as requested_by_name, rv.name as reviewed_by_name
     FROM change_requests cr
     JOIN users u ON u.id = cr.requested_by
     LEFT JOIN users rv ON rv.id = cr.reviewed_by
     ${where}
     ORDER BY cr.created_at DESC`,
    params
  );
  return rows;
};

const getById = async (id) => {
  const [[row]] = await db.query(
    `SELECT cr.*, u.name as requested_by_name, rv.name as reviewed_by_name
     FROM change_requests cr
     JOIN users u ON u.id = cr.requested_by
     LEFT JOIN users rv ON rv.id = cr.reviewed_by
     WHERE cr.id = ?`,
    [id]
  );
  if (!row) throw new Error('CHANGE_REQUEST_NOT_FOUND');
  return row;
};

module.exports = { createChangeRequest, approveChangeRequest, rejectChangeRequest, getAll, getById };
