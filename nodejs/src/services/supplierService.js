const db = require('../config/db');

const getAll = async (storeId) => {
  const [rows] = await db.query(
    'SELECT * FROM suppliers WHERE store_id = ? AND active = TRUE ORDER BY name',
    [storeId]
  );
  return rows;
};

const getById = async (id, storeId) => {
  const [[row]] = await db.query('SELECT * FROM suppliers WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!row) throw new Error('SUPPLIER_NOT_FOUND');
  return row;
};

const create = async (data, storeId) => {
  const [result] = await db.query(
    'INSERT INTO suppliers (store_id, name, mobile, active) VALUES (?, ?, ?, TRUE)',
    [storeId, data.name, data.mobile || null]
  );
  return getById(result.insertId, storeId);
};

const update = async (id, storeId, data) => {
  const [[existing]] = await db.query('SELECT id FROM suppliers WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!existing) throw new Error('SUPPLIER_NOT_FOUND');
  await db.query('UPDATE suppliers SET name = ?, mobile = ?, active = ? WHERE id = ?',
    [data.name, data.mobile || null, data.active ?? true, id]);
  return getById(id, storeId);
};

const remove = async (id, storeId) => {
  const [[existing]] = await db.query('SELECT id FROM suppliers WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!existing) throw new Error('SUPPLIER_NOT_FOUND');
  await db.query('UPDATE suppliers SET active = FALSE WHERE id = ?', [id]);
};

module.exports = { getAll, getById, create, update, remove };
