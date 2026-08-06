const db = require('../config/db');

const getAll = async (storeId) => {
  const [rows] = await db.query(
    'SELECT * FROM news_events WHERE store_id = ? AND active = TRUE ORDER BY priority DESC, publish_date DESC',
    [storeId]
  );
  return rows;
};

const getById = async (id, storeId) => {
  const [[row]] = await db.query('SELECT * FROM news_events WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!row) throw new Error('NEWS_EVENT_NOT_FOUND');
  return row;
};

const create = async (data, storeId, userId) => {
  const [result] = await db.query(
    'INSERT INTO news_events (store_id, type, title, content, publish_date, priority, active, created_by_user_id) VALUES (?, ?, ?, ?, ?, ?, TRUE, ?)',
    [storeId, data.type, data.title, data.content || null, data.publishDate || null, data.priority || 0, userId]
  );
  return getById(result.insertId, storeId);
};

const update = async (id, storeId, data) => {
  const [[existing]] = await db.query('SELECT id FROM news_events WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!existing) throw new Error('NEWS_EVENT_NOT_FOUND');
  await db.query(
    'UPDATE news_events SET type = ?, title = ?, content = ?, publish_date = ?, priority = ?, active = ? WHERE id = ?',
    [data.type, data.title, data.content || null, data.publishDate || null, data.priority ?? 0, data.active ?? true, id]
  );
  return getById(id, storeId);
};

const remove = async (id, storeId) => {
  const [[existing]] = await db.query('SELECT id FROM news_events WHERE id = ? AND store_id = ?', [id, storeId]);
  if (!existing) throw new Error('NEWS_EVENT_NOT_FOUND');
  await db.query('UPDATE news_events SET active = FALSE WHERE id = ?', [id]);
};

module.exports = { getAll, getById, create, update, remove };
