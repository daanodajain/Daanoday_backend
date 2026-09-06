const db = require('../config/db');
const audit = require('./auditLogService');
const notifSvc = require('./notificationService');

const _generateChallanNumber = async (storeId, conn) => {
  const year = new Date().getFullYear();
  const [[settings]] = await conn.query('SELECT challan_prefix FROM store_settings WHERE store_id = ?', [storeId]);
  const prefix = settings?.challan_prefix || 'CHL';

  const [[seq]] = await conn.query(
    'SELECT id, last_sequence FROM challan_sequences WHERE store_id = ? AND year = ? FOR UPDATE',
    [storeId, year]
  );
  if (!seq) {
    await conn.query('INSERT INTO challan_sequences (store_id, year, last_sequence) VALUES (?, ?, 1)', [storeId, year]);
    return `${prefix}${year}000001`;
  }
  const next = seq.last_sequence + 1;
  await conn.query('UPDATE challan_sequences SET last_sequence = ? WHERE id = ?', [next, seq.id]);
  return `${prefix}${year}${String(next).padStart(6, '0')}`;
};

const _checkLockPeriod = async (storeId) => {
  const [[s]] = await db.query('SELECT locked_before_date FROM store_settings WHERE store_id = ?', [storeId]);
  if (s?.locked_before_date && new Date() < new Date(s.locked_before_date))
    throw new Error(`PERIOD_LOCKED: Records locked before ${s.locked_before_date}`);
};

const getAll = async (storeId) => {
  const [rows] = await db.query(
    `SELECT ch.*, s.name as supplier_name, s.mobile as supplier_mobile, u.name as created_by_name
     FROM challans ch
     JOIN suppliers s ON s.id = ch.supplier_id
     JOIN users u ON u.id = ch.created_by
     WHERE ch.store_id = ?
     ORDER BY ch.created_at DESC`,
    [storeId]
  );
  return rows;
};

const getById = async (id, storeId) => {
  const [[challan]] = await db.query(
    `SELECT ch.*, s.name as supplier_name, s.mobile as supplier_mobile, u.name as created_by_name
     FROM challans ch
     JOIN suppliers s ON s.id = ch.supplier_id
     JOIN users u ON u.id = ch.created_by
     WHERE ch.id = ? AND ch.store_id = ?`,
    [id, storeId]
  );
  if (!challan) throw new Error('CHALLAN_NOT_FOUND');
  const [particulars] = await db.query('SELECT * FROM challan_particulars WHERE challan_id = ?', [id]);
  challan.particulars = particulars;
  return challan;
};

const getByDateRange = async (storeId, startDate, endDate) => {
  if (!startDate || !endDate) throw new Error('START_DATE_AND_END_DATE_REQUIRED');
  const [rows] = await db.query(
    `SELECT ch.*, s.name as supplier_name
     FROM challans ch
     JOIN suppliers s ON s.id = ch.supplier_id
     WHERE ch.store_id = ? AND DATE(ch.created_at) BETWEEN ? AND ?
     ORDER BY ch.created_at DESC`,
    [storeId, startDate, endDate]
  );
  return rows;
};

const create = async (data, storeId, userId) => {
  await _checkLockPeriod(storeId);

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    const challanNumber = await _generateChallanNumber(storeId, conn);

    const [[settings]] = await conn.query(
      'SELECT auto_approve_cash, cash_approval_limit FROM store_settings WHERE store_id = ?',
      [storeId]
    );

    const needsApproval = data.paymentMode === 'CASH'
      && settings
      && !settings.auto_approve_cash
      && Number(data.totalAmount) > Number(settings.cash_approval_limit || 0);

    const challanState = needsApproval ? 'PENDING_APPROVAL' : 'APPROVED';
    const status = 'UNPAID';

    const [result] = await conn.query(
      `INSERT INTO challans (store_id, challan_number, supplier_id, total_amount, payment_mode, challan_state, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [storeId, challanNumber, data.supplierId, data.totalAmount, data.paymentMode, challanState, status, userId]
    );
    const challanId = result.insertId;

    if (data.particulars?.length) {
      const vals = data.particulars.map(p => [challanId, p.particularId, p.particularName, p.amount]);
      await conn.query(
        'INSERT INTO challan_particulars (challan_id, particular_id, particular_name, amount) VALUES ?',
        [vals]
      );
    }

    await conn.query(
      "INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status) VALUES (?, 'CHALLAN', ?, ?, ?, 'INITIATED')",
      [storeId, challanId, data.totalAmount, data.paymentMode]
    );

    await conn.commit();
    await audit.log({ storeId, userId, action: 'CHALLAN_CREATED', entityType: 'CHALLAN', entityId: challanId,
      details: { challan_number: challanNumber, amount: data.totalAmount, supplier_id: data.supplierId, state: challanState } });

    if (challanState === 'PENDING_APPROVAL') {
      try {
        const [admins] = await db.query(
          `SELECT u.id FROM users u JOIN user_roles ur ON ur.user_id = u.id
           JOIN roles r ON r.id = ur.role_id
           WHERE ur.store_id = ? AND r.name IN ('STORE_ADMIN','SUB_ADMIN') AND u.id != ?`,
          [storeId, userId]
        );
        for (const admin of admins) {
          await notifSvc.create(admin.id, storeId, {
            type: 'CHALLAN_APPROVAL',
            message: `New challan ${challanNumber} of ₹${data.totalAmount} requires approval`,
            referenceId: challanId, referenceType: 'CHALLAN'
          });
        }
      } catch(e) {}
    }
    return getById(challanId, storeId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// Approve challan (PENDING_APPROVAL → APPROVED)
const approveChallan = async (id, storeId, userId, note) => {
  const [[challan]] = await db.query(
    'SELECT * FROM challans WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!challan) throw new Error('CHALLAN_NOT_FOUND');
  if (challan.challan_state !== 'PENDING_APPROVAL') throw new Error('NOT_PENDING_APPROVAL');

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query(
      "UPDATE challans SET challan_state = 'APPROVED' WHERE id = ?", [id]
    );
    await conn.query(
      "UPDATE transactions SET status = 'SUCCESS' WHERE type = 'CHALLAN' AND reference_id = ?", [id]
    );
    await conn.commit();
    await audit.log({ storeId, userId, action: 'CHALLAN_APPROVED', entityType: 'CHALLAN', entityId: id,
      details: { challan_number: challan.challan_number, amount: challan.total_amount, note } });
    try {
      await notifSvc.create(challan.created_by, storeId, {
        type: 'SUCCESS',
        message: `Challan ${challan.challan_number} of ₹${challan.total_amount} has been approved`,
        referenceId: id, referenceType: 'CHALLAN'
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

// Reject challan (PENDING_APPROVAL → REJECTED)
const rejectChallan = async (id, storeId, userId, note) => {
  const [[challan]] = await db.query(
    'SELECT * FROM challans WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!challan) throw new Error('CHALLAN_NOT_FOUND');
  if (challan.challan_state !== 'PENDING_APPROVAL') throw new Error('NOT_PENDING_APPROVAL');

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query("UPDATE challans SET challan_state = 'REJECTED', status = 'REJECTED' WHERE id = ?", [id]);
    await conn.query(
      "UPDATE transactions SET status = 'FAILED' WHERE type = 'CHALLAN' AND reference_id = ?", [id]
    );
    await conn.commit();
    await audit.log({ storeId, userId, action: 'CHALLAN_REJECTED', entityType: 'CHALLAN', entityId: id,
      details: { challan_number: challan.challan_number, amount: challan.total_amount, note } });
    try {
      await notifSvc.create(challan.created_by, storeId, {
        type: 'ERROR',
        message: `Challan ${challan.challan_number} of ₹${challan.total_amount} has been rejected${note ? ': ' + note : ''}`,
        referenceId: id, referenceType: 'CHALLAN'
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

// Mark challan as paid (UNPAID → PAID)
const markChallanPaid = async (id, storeId, userId) => {
  const [[challan]] = await db.query(
    'SELECT * FROM challans WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!challan) throw new Error('CHALLAN_NOT_FOUND');
  if (challan.status === 'PAID') throw new Error('ALREADY_PAID');
  if (challan.challan_state === 'PENDING_APPROVAL') throw new Error('CHALLAN_PENDING_APPROVAL');
  if (['REJECTED', 'CANCELLED'].includes(challan.challan_state)) throw new Error('CANNOT_PAY_REJECTED_OR_CANCELLED_CHALLAN');

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query("UPDATE challans SET status = 'PAID' WHERE id = ?", [id]);
    await conn.query(
      "UPDATE transactions SET status = 'SUCCESS' WHERE type = 'CHALLAN' AND reference_id = ?", [id]
    );
    await conn.commit();
    await audit.log({ storeId, userId, action: 'CHALLAN_MARKED_PAID', entityType: 'CHALLAN', entityId: id,
      details: { challan_number: challan.challan_number, amount: challan.total_amount } });
    return getById(id, storeId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

module.exports = { getAll, getById, create, getByDateRange, approveChallan, rejectChallan, markChallanPaid };
