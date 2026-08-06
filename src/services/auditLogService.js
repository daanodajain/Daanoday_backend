const db = require('../config/db');

const log = async ({ storeId = null, userId = null, action, entityType = null, entityId = null, details = null }) => {
  await db.query(
    'INSERT INTO audit_logs (store_id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
    [storeId, userId, action, entityType, entityId, details ? JSON.stringify(details) : null]
  );
};

const getAll = async (storeId, limit = 100) => {
  const [rows] = await db.query(
    `SELECT al.*, u.name as user_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.store_id = ?
     ORDER BY al.created_at DESC LIMIT ?`,
    [storeId, limit]
  );
  return rows;
};

module.exports = { log, getAll };
