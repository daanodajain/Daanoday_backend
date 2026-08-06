const db = require('../config/db');

const create = async (userId, storeId, { type, message, referenceId = null, referenceType = null }) => {
  await db.query(
    'INSERT INTO notifications (user_id, store_id, type, message, reference_id, reference_type) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, storeId, type, message, referenceId, referenceType]
  );
};

const getAll = async (userId, storeId) => {
  const [rows] = await db.query(
    `SELECT * FROM notifications WHERE user_id = ? AND store_id = ?
     ORDER BY created_at DESC LIMIT 50`,
    [userId, storeId]
  );
  return rows;
};

const markAsRead = async (id, userId) => {
  await db.query('UPDATE notifications SET read_status = TRUE WHERE id = ? AND user_id = ?', [id, userId]);
};

const markAllAsRead = async (userId, storeId) => {
  await db.query(
    'UPDATE notifications SET read_status = TRUE WHERE user_id = ? AND store_id = ? AND read_status = FALSE',
    [userId, storeId]
  );
};

const remove = async (id, userId) => {
  await db.query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [id, userId]);
};

module.exports = { create, getAll, markAsRead, markAllAsRead, remove };
