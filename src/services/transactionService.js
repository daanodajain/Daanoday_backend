const db = require('../config/db');

const getAll = async (storeId, filters = {}) => {
  const conditions = ['t.store_id = ?'];
  const params = [storeId];

  if (filters.type && filters.type !== 'ALL') {
    conditions.push('t.type = ?');
    params.push(filters.type);
  }

  const where = conditions.join(' AND ');

  const [rows] = await db.query(
    `SELECT t.id, t.type, t.amount, t.payment_mode, t.status, t.created_at,
            r.receipt_number  as reference_number,
            ch.challan_number as challan_reference_number,
            c.name  as customer_name,
            s.name  as supplier_name
     FROM transactions t
     LEFT JOIN receipts r  ON r.id  = t.reference_id AND t.type = 'RECEIPT'
     LEFT JOIN customers c ON c.id  = r.customer_id
     LEFT JOIN challans ch ON ch.id = t.reference_id AND t.type = 'CHALLAN'
     LEFT JOIN suppliers s ON s.id  = ch.supplier_id
     WHERE ${where}
     ORDER BY t.created_at DESC`,
    params
  );

  const totalReceipts = rows
    .filter(r => r.type === 'RECEIPT' && r.status === 'SUCCESS')
    .reduce((sum, r) => sum + Number(r.amount), 0);

  const totalChallans = rows
    .filter(r => r.type === 'CHALLAN' && r.status === 'SUCCESS')
    .reduce((sum, r) => sum + Number(r.amount), 0);

  return {
    transactions: rows.map(r => ({
      id: r.id,
      type: r.type,
      amount: Number(r.amount),
      payment_mode: r.payment_mode,
      status: r.status,
      created_at: r.created_at,
      reference_number: r.reference_number || r.challan_reference_number,
      customer_name: r.customer_name,
      supplier_name: r.supplier_name,
    })),
    total: rows.length,
    summary: {
      totalReceipts,
      totalChallans,
      netBalance: totalReceipts - totalChallans,
    },
  };
};

const getById = async (id, storeId) => {
  const [[row]] = await db.query(
    'SELECT * FROM transactions WHERE id = ? AND store_id = ?', [id, storeId]
  );
  if (!row) throw new Error('TRANSACTION_NOT_FOUND');
  return row;
};

module.exports = { getAll, getById };
