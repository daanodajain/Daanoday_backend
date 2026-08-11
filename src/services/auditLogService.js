const db = require('../config/db');
const XLSX = require('xlsx');

const log = async ({ storeId = null, userId = null, action, entityType = null, entityId = null, details = null }) => {
  await db.query(
    'INSERT INTO audit_logs (store_id, user_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?, ?)',
    [storeId, userId, action, entityType, entityId, details ? JSON.stringify(details) : null]
  );
};

const _buildWhere = (storeId, filters = {}) => {
  let where = 'al.store_id = ?';
  const params = [storeId];
  if (filters.action)      { where += ' AND al.action = ?';                params.push(filters.action); }
  if (filters.entityType)  { where += ' AND al.entity_type = ?';           params.push(filters.entityType); }
  if (filters.startDate)   { where += ' AND DATE(al.created_at) >= ?';     params.push(filters.startDate); }
  if (filters.endDate)     { where += ' AND DATE(al.created_at) <= ?';     params.push(filters.endDate); }
  return { where, params };
};

const getAll = async (storeId, filters = {}, limit = 200) => {
  const { where, params } = _buildWhere(storeId, filters);
  const [rows] = await db.query(
    `SELECT al.*, u.name as user_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE ${where}
     ORDER BY al.created_at DESC LIMIT ?`,
    [...params, limit]
  );
  return rows;
};

const getByEntity = async (storeId, entityType, entityId) => {
  const [rows] = await db.query(
    `SELECT al.*, u.name as user_name
     FROM audit_logs al
     LEFT JOIN users u ON u.id = al.user_id
     WHERE al.store_id = ? AND al.entity_type = ? AND al.entity_id = ?
     ORDER BY al.created_at DESC`,
    [storeId, entityType, entityId]
  );
  return rows;
};

const exportAsXlsx = async (storeId, filters = {}) => {
  const rows = await getAll(storeId, filters, 10000);
  const sheetRows = rows.map(r => ({
    'Date & Time': new Date(r.created_at).toLocaleString('en-IN'),
    'Action': r.action,
    'Entity Type': r.entity_type || '',
    'Entity ID': r.entity_id || '',
    'Done By': r.user_name || `User #${r.user_id}`,
    'Details': r.details ? JSON.stringify(r.details) : '',
  }));
  const worksheet = XLSX.utils.json_to_sheet(sheetRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Audit Logs');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

module.exports = { log, getAll, getByEntity, exportAsXlsx };
