const db = require('../config/db');

const getAll = async (storeId, type = null) => {
  const [rows] = type
    ? await db.query('SELECT * FROM particulars WHERE store_id = ? AND type = ? AND active = TRUE', [storeId, type])
    : await db.query('SELECT * FROM particulars WHERE store_id = ? AND active = TRUE ORDER BY type, name', [storeId]);
  return rows;
};

const getById = async (id, storeId) => {
  const [[row]] = await db.query('SELECT * FROM particulars WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!row) throw new Error('PARTICULAR_NOT_FOUND');
  return row;
};

const create = async (data, storeId) => {
  const [result] = await db.query(
    'INSERT INTO particulars (store_id, type, name, active) VALUES (?, ?, ?, TRUE)',
    [storeId, data.type, data.name]
  );
  return getById(result.insertId, storeId);
};

const update = async (id, storeId, data) => {
  const [[existing]] = await db.query('SELECT id FROM particulars WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!existing) throw new Error('PARTICULAR_NOT_FOUND');
  await db.query('UPDATE particulars SET name = ?, type = ?, active = ? WHERE id = ?',
    [data.name, data.type, data.active ?? true, id]);
  return getById(id, storeId);
};

const remove = async (id, storeId) => {
  const [[existing]] = await db.query('SELECT id FROM particulars WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!existing) throw new Error('PARTICULAR_NOT_FOUND');
  await db.query('UPDATE particulars SET active = FALSE WHERE id = ?', [id]);
};

module.exports = { getAll, getById, create, update, remove };
