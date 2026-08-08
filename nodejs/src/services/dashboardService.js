const db = require('../config/db');

const getStats = async (storeId) => {
  const today = new Date().toISOString().split('T')[0];
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];

  const [[todayStats]] = await db.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
     FROM receipts WHERE store_id = ? AND DATE(created_at) = ? AND receipt_state = 'APPROVED'`,
    [storeId, today]
  );
  const [[monthStats]] = await db.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
     FROM receipts WHERE store_id = ? AND DATE(created_at) >= ? AND receipt_state = 'APPROVED'`,
    [storeId, monthStart]
  );
  const [[totalStats]] = await db.query(
    `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
     FROM receipts WHERE store_id = ? AND receipt_state = 'APPROVED'`,
    [storeId]
  );
  const [[pending]] = await db.query(
    "SELECT COUNT(*) as count FROM receipts WHERE store_id = ? AND receipt_state = 'PENDING_APPROVAL'",
    [storeId]
  );
  const [[pendingCR]] = await db.query(
    "SELECT COUNT(*) as count FROM change_requests WHERE store_id = ? AND status = 'PENDING'",
    [storeId]
  );
  const [[customers]] = await db.query(
    'SELECT COUNT(*) as count FROM customer_store_access WHERE store_id = ?', [storeId]
  );

  return {
    today:    { receipts: todayStats.count, collection: Number(todayStats.amount) },
    month:    { receipts: monthStats.count, collection: Number(monthStats.amount) },
    total:    { receipts: totalStats.count, collection: Number(totalStats.amount) },
    pendingApprovals: pending.count,
    pendingChangeRequests: pendingCR.count,
    totalCustomers: customers.count,
  };
};

const getRevenueData = async (storeId, days = 30) => {
  const [rows] = await db.query(
    `SELECT DATE(created_at) as date, COALESCE(SUM(total_amount), 0) as amount
     FROM receipts
     WHERE store_id = ? AND receipt_state = 'APPROVED'
       AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(created_at) ORDER BY date ASC`,
    [storeId, days]
  );
  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split('T')[0];
    const found = rows.find(r => (r.date instanceof Date ? r.date.toISOString().split('T')[0] : r.date) === dateStr);
    result.push({ date: dateStr, amount: found ? Number(found.amount) : 0 });
  }
  return result;
};

const getPaymentModeDistribution = async (storeId) => {
  const [rows] = await db.query(
    `SELECT payment_mode as mode, COUNT(*) as count, COALESCE(SUM(total_amount), 0) as amount
     FROM receipts
     WHERE store_id = ? AND receipt_state = 'APPROVED'
       AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     GROUP BY payment_mode`,
    [storeId]
  );
  return rows.map(r => ({ ...r, amount: Number(r.amount) }));
};

const getMonthlyComparison = async (storeId) => {
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') as month,
            COALESCE(SUM(total_amount), 0) as amount, COUNT(*) as count
     FROM receipts
     WHERE store_id = ? AND receipt_state = 'APPROVED'
       AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
     GROUP BY DATE_FORMAT(created_at, '%Y-%m')
     ORDER BY month ASC`,
    [storeId]
  );
  return rows.map(r => ({ ...r, amount: Number(r.amount) }));
};

const getRecentReceipts = async (storeId, limit = 10) => {
  const [rows] = await db.query(
    `SELECT r.id, r.receipt_number, r.total_amount, r.receipt_state, r.payment_mode,
            r.created_at, c.name as customer_name
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     WHERE r.store_id = ?
     ORDER BY r.created_at DESC LIMIT ?`,
    [storeId, limit]
  );
  return rows;
};



const getPendingApprovals = async (storeId) => {
  const [receipts] = await db.query(
    `SELECT r.id, r.receipt_number, r.total_amount, r.payment_mode, r.created_at,
            c.name as customer_name, c.mobile as customer_mobile
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     WHERE r.store_id = ? AND r.receipt_state = 'PENDING_APPROVAL'
     ORDER BY r.created_at DESC`,
    [storeId]
  );
  const [changeRequests] = await db.query(
    `SELECT cr.id, cr.entity_type, cr.change_type, cr.created_at, u.name as created_by_name
     FROM change_requests cr
     JOIN users u ON u.id = cr.created_by
     WHERE cr.store_id = ? AND cr.status = 'PENDING'
     ORDER BY cr.created_at DESC`,
    [storeId]
  );
  return { receipts, changeRequests };
};

const getReceiptTypeDistribution = async (storeId) => {
  const [rows] = await db.query(
    `SELECT rp.particular_name as type, COUNT(*) as count, COALESCE(SUM(rp.amount), 0) as amount
     FROM receipt_particulars rp
     JOIN receipts r ON r.id = rp.receipt_id
     WHERE r.store_id = ? AND r.receipt_state = 'APPROVED'
       AND DATE(r.created_at) >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     GROUP BY rp.particular_name
     ORDER BY amount DESC`,
    [storeId]
  );
  return rows.map(r => ({ ...r, amount: Number(r.amount) }));
};

const getCustomerGrowth = async (storeId) => {
  const [rows] = await db.query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m') as month, COUNT(*) as newCustomers
     FROM customer_store_access
     WHERE store_id = ?
       AND created_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
     GROUP BY DATE_FORMAT(created_at, '%Y-%m')
     ORDER BY month ASC`,
    [storeId]
  );
  return rows;
};

const getDailyTrend = async (storeId) => {
  const [rows] = await db.query(
    `SELECT DATE(created_at) as date,
            COUNT(*) as receipts,
            COALESCE(SUM(total_amount), 0) as amount
     FROM receipts
     WHERE store_id = ? AND receipt_state = 'APPROVED'
       AND DATE(created_at) >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
     GROUP BY DATE(created_at)
     ORDER BY date ASC`,
    [storeId]
  );
  return rows.map(r => ({ ...r, amount: Number(r.amount) }));
};

const getYearlyComparison = async (storeId) => {
  const [rows] = await db.query(
    `SELECT YEAR(created_at) as year,
            MONTH(created_at) as month,
            COALESCE(SUM(total_amount), 0) as amount,
            COUNT(*) as receipts
     FROM receipts
     WHERE store_id = ? AND receipt_state = 'APPROVED'
       AND YEAR(created_at) >= YEAR(CURDATE()) - 1
     GROUP BY YEAR(created_at), MONTH(created_at)
     ORDER BY year, month`,
    [storeId]
  );
  return rows.map(r => ({ ...r, amount: Number(r.amount) }));
};

module.exports = { getStats, getRevenueData, getPaymentModeDistribution, getMonthlyComparison, getRecentReceipts, getPendingApprovals, getReceiptTypeDistribution, getCustomerGrowth, getDailyTrend, getYearlyComparison };
