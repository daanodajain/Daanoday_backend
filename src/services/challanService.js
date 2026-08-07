const db = require('../config/db');

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

    const [result] = await conn.query(
      `INSERT INTO challans (store_id, challan_number, supplier_id, total_amount, payment_mode, status, created_by)
       VALUES (?, ?, ?, ?, ?, 'UNPAID', ?)`,
      [storeId, challanNumber, data.supplierId, data.totalAmount, data.paymentMode, userId]
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
      "INSERT INTO transactions (store_id, type, reference_id, amount, payment_mode, status) VALUES (?, 'CHALLAN', ?, ?, ?, 'SUCCESS')",
      [storeId, challanId, data.totalAmount, data.paymentMode]
    );

    await conn.commit();
    return getById(challanId, storeId);
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// No direct update/delete — must go through change_requests

// Reject a challan (UNPAID → REJECTED)
const rejectChallan = async (id, storeId, userId, note) => {
  const [[challan]] = await db.query(
    'SELECT * FROM challans WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!challan) throw new Error('CHALLAN_NOT_FOUND');
  if (challan.status === 'PAID') throw new Error('CANNOT_REJECT_PAID_CHALLAN');

  const conn = await db.getConnection();
  await conn.beginTransaction();
  try {
    await conn.query("UPDATE challans SET status = 'REJECTED' WHERE id = ?", [id]);
    await conn.query(
      "UPDATE transactions SET status = 'FAILED' WHERE type = 'CHALLAN' AND reference_id = ?", [id]
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

module.exports = { getAll, getById, create, getByDateRange, rejectChallan };
