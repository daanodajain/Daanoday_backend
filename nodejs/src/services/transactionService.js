const db = require('../config/db');

const getAll = async (storeId) => {
  const [rows] = await db.query(
    `SELECT t.*,
            c.name as customer_name,
            s.name as supplier_name
     FROM transactions t
     LEFT JOIN receipts r ON r.id = t.reference_id AND t.type = 'RECEIPT'
     LEFT JOIN customers c ON c.id = r.customer_id
     LEFT JOIN challans ch ON ch.id = t.reference_id AND t.type = 'CHALLAN'
     LEFT JOIN suppliers s ON s.id = ch.supplier_id
     WHERE t.store_id = ?
     ORDER BY t.created_at DESC`,
    [storeId]
  );
  return rows;
};

const getById = async (id, storeId) => {
  const [[row]] = await db.query(
    'SELECT * FROM transactions WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!row) throw new Error('TRANSACTION_NOT_FOUND');
  return row;
};

module.exports = { getAll, getById };
