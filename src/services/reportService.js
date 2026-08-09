const db = require('../config/db');
const XLSX = require('xlsx');

// Build an .xlsx workbook buffer from an array of plain objects (keys = column headers)
const toXlsxBuffer = (sheetName, rows) => {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const getReceiptReport = async (storeId, filters = {}) => {
  let where = 'r.store_id = ?';
  const params = [storeId];

  if (filters.startDate) { where += ' AND DATE(r.created_at) >= ?'; params.push(filters.startDate); }
  if (filters.endDate)   { where += ' AND DATE(r.created_at) <= ?'; params.push(filters.endDate); }
  if (filters.paymentMode) { where += ' AND r.payment_mode = ?'; params.push(filters.paymentMode); }
  if (filters.state)     { where += ' AND r.receipt_state = ?'; params.push(filters.state); }

  const [rows] = await db.query(
    `SELECT r.id, r.receipt_number, r.total_amount, r.payment_mode, r.receipt_state,
            r.status, r.created_at, c.name as customer_name, c.mobile as customer_mobile,
            csa.account_number, u.name as created_by_name
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = r.store_id
     JOIN users u ON u.id = r.created_by
     WHERE ${where}
     ORDER BY r.created_at DESC`,
    params
  );
  return rows;
};

const getFinancialReport = async (storeId, filters = {}) => {
  const startDate = filters.startDate || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const endDate   = filters.endDate   || new Date().toISOString().split('T')[0];

  const [[totals]] = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) as totalReceipts,
            COUNT(*) as receiptCount
     FROM receipts
     WHERE store_id = ? AND receipt_state = 'APPROVED'
       AND DATE(created_at) BETWEEN ? AND ?`,
    [storeId, startDate, endDate]
  );

  const [[challanTotals]] = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) as totalChallans,
            COUNT(*) as challanCount
     FROM challans
     WHERE store_id = ? AND status != 'REJECTED'
       AND DATE(created_at) BETWEEN ? AND ?`,
    [storeId, startDate, endDate]
  );

  const [byPaymentMode] = await db.query(
    `SELECT payment_mode, COALESCE(SUM(total_amount), 0) as amount, COUNT(*) as count
     FROM receipts
     WHERE store_id = ? AND receipt_state = 'APPROVED'
       AND DATE(created_at) BETWEEN ? AND ?
     GROUP BY payment_mode`,
    [storeId, startDate, endDate]
  );

  return {
    period: { startDate, endDate },
    receipts: { total: Number(totals.totalReceipts), count: totals.receiptCount },
    challans: { total: Number(challanTotals.totalChallans), count: challanTotals.challanCount },
    net: Number(totals.totalReceipts) - Number(challanTotals.totalChallans),
    byPaymentMode: byPaymentMode.map(r => ({ ...r, amount: Number(r.amount) })),
  };
};

const getCustomerDonationHistory = async (storeId, customerId) => {
  const [[access]] = await db.query(
    'SELECT id FROM customer_store_access WHERE customer_id = ? AND store_id = ?',
    [customerId, storeId]
  );
  if (!access) throw new Error('CUSTOMER_NOT_FOUND');

  const [receipts] = await db.query(
    `SELECT r.id, r.receipt_number, r.total_amount, r.payment_mode,
            r.receipt_state, r.status, r.created_at
     FROM receipts r
     WHERE r.customer_id = ? AND r.store_id = ?
     ORDER BY r.created_at DESC`,
    [customerId, storeId]
  );

  const [[stats]] = await db.query(
    `SELECT COALESCE(SUM(total_amount), 0) as totalDonated, COUNT(*) as receiptCount
     FROM receipts
     WHERE customer_id = ? AND store_id = ? AND receipt_state = 'APPROVED'`,
    [customerId, storeId]
  );

  return { customerId, stats: { totalDonated: Number(stats.totalDonated), receiptCount: stats.receiptCount }, receipts };
};

// Export receipt report as CSV string (used by Tally export)
const exportReceiptsAsCsv = async (storeId, filters) => {
  const rows = await getReceiptReport(storeId, filters);
  const headers = ['Receipt No', 'Customer', 'Mobile', 'Account No', 'Amount', 'Payment Mode', 'State', 'Status', 'Created By', 'Date'];
  const lines = rows.map(r => [
    r.receipt_number, r.customer_name, r.customer_mobile, r.account_number,
    r.total_amount, r.payment_mode, r.receipt_state, r.status, r.created_by_name,
    new Date(r.created_at).toLocaleDateString('en-IN')
  ].join(','));
  return [headers.join(','), ...lines].join('\n');
};

// Export receipt report as a real .xlsx workbook (buffer)
const exportReceiptsAsXlsx = async (storeId, filters) => {
  const rows = await getReceiptReport(storeId, filters);
  const sheetRows = rows.map(r => ({
    'Receipt No': r.receipt_number, 'Customer': r.customer_name, 'Mobile': r.customer_mobile,
    'Account No': r.account_number, 'Amount': Number(r.total_amount), 'Payment Mode': r.payment_mode,
    'State': r.receipt_state, 'Status': r.status, 'Created By': r.created_by_name,
    'Date': new Date(r.created_at).toLocaleDateString('en-IN'),
  }));
  return toXlsxBuffer('Receipts', sheetRows);
};

// Export financial report as a real .xlsx workbook (buffer)
const exportFinancialAsXlsx = async (storeId, filters) => {
  const report = await getFinancialReport(storeId, filters);
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Period', `${report.period.startDate} to ${report.period.endDate}`],
    ['Total Receipts', report.receipts.total],
    ['Receipt Count', report.receipts.count],
    ['Total Challans', report.challans.total],
    ['Challan Count', report.challans.count],
    ['Net', report.net],
    [],
    ['Payment Mode', 'Amount', 'Count'],
    ...report.byPaymentMode.map(r => [r.payment_mode, r.amount, r.count]),
  ]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Financial Summary');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

// Export challans as .xlsx
const exportChallansAsXlsx = async (storeId, filters = {}) => {
  let where = 'ch.store_id = ?';
  const params = [storeId];
  if (filters.startDate) { where += ' AND DATE(ch.created_at) >= ?'; params.push(filters.startDate); }
  if (filters.endDate)   { where += ' AND DATE(ch.created_at) <= ?'; params.push(filters.endDate); }
  const [rows] = await db.query(
    `SELECT ch.challan_number, s.name as supplier_name, s.mobile as supplier_mobile,
            ch.total_amount, ch.payment_mode, ch.status, u.name as created_by, ch.created_at
     FROM challans ch
     JOIN suppliers s ON s.id = ch.supplier_id
     JOIN users u ON u.id = ch.created_by
     WHERE ${where} ORDER BY ch.created_at DESC`, params
  );
  const sheetRows = rows.map(r => ({
    'Challan No': r.challan_number, 'Supplier': r.supplier_name, 'Mobile': r.supplier_mobile,
    'Amount': Number(r.total_amount), 'Payment Mode': r.payment_mode, 'Status': r.status,
    'Created By': r.created_by, 'Date': new Date(r.created_at).toLocaleDateString('en-IN'),
  }));
  return toXlsxBuffer('Challans', sheetRows);
};

// Export customers as .xlsx
const exportCustomersAsXlsx = async (storeId) => {
  const [rows] = await db.query(
    `SELECT c.name, c.mobile, csa.account_number, csa.is_primary_store,
            COUNT(r.id) as total_receipts, COALESCE(SUM(r.total_amount),0) as total_donated
     FROM customers c
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = ?
     LEFT JOIN receipts r ON r.customer_id = c.id AND r.store_id = ? AND r.receipt_state = 'APPROVED'
     GROUP BY c.id ORDER BY c.name`, [storeId, storeId]
  );
  const sheetRows = rows.map(r => ({
    'Name': r.name, 'Mobile': r.mobile, 'Account No': r.account_number,
    'Total Receipts': r.total_receipts, 'Total Donated': Number(r.total_donated),
  }));
  return toXlsxBuffer('Customers', sheetRows);
};

// Export suppliers as .xlsx
const exportSuppliersAsXlsx = async (storeId) => {
  const [rows] = await db.query(
    `SELECT s.name, s.mobile, s.email, s.address,
            COUNT(ch.id) as total_challans, COALESCE(SUM(ch.total_amount),0) as total_paid
     FROM suppliers s
     LEFT JOIN challans ch ON ch.supplier_id = s.id AND ch.store_id = ?
     WHERE s.store_id = ?
     GROUP BY s.id ORDER BY s.name`, [storeId, storeId]
  );
  const sheetRows = rows.map(r => ({
    'Name': r.name, 'Mobile': r.mobile, 'Email': r.email || '', 'Address': r.address || '',
    'Total Challans': r.total_challans, 'Total Paid': Number(r.total_paid),
  }));
  return toXlsxBuffer('Suppliers', sheetRows);
};

// Export transactions as .xlsx
const exportTransactionsAsXlsx = async (storeId, filters = {}) => {
  let where = 't.store_id = ?';
  const params = [storeId];
  if (filters.startDate) { where += ' AND DATE(t.created_at) >= ?'; params.push(filters.startDate); }
  if (filters.endDate)   { where += ' AND DATE(t.created_at) <= ?'; params.push(filters.endDate); }
  const [rows] = await db.query(
    `SELECT t.id, t.type, t.amount, t.payment_mode, t.status,
            CASE WHEN t.type='RECEIPT' THEN c.name ELSE s.name END as party_name,
            t.created_at
     FROM transactions t
     LEFT JOIN receipts r ON r.id = t.reference_id AND t.type = 'RECEIPT'
     LEFT JOIN customers c ON c.id = r.customer_id
     LEFT JOIN challans ch ON ch.id = t.reference_id AND t.type = 'CHALLAN'
     LEFT JOIN suppliers s ON s.id = ch.supplier_id
     WHERE ${where} ORDER BY t.created_at DESC`, params
  );
  const sheetRows = rows.map(r => ({
    'ID': r.id, 'Type': r.type, 'Party': r.party_name || '', 'Amount': Number(r.amount),
    'Payment Mode': r.payment_mode || '', 'Status': r.status,
    'Date': new Date(r.created_at).toLocaleDateString('en-IN'),
  }));
  return toXlsxBuffer('Transactions', sheetRows);
};

module.exports = {
  getReceiptReport, getFinancialReport, getCustomerDonationHistory,
  exportReceiptsAsCsv,
  exportReceiptsAsXlsx, exportFinancialAsXlsx, exportChallansAsXlsx,
  exportCustomersAsXlsx, exportSuppliersAsXlsx, exportTransactionsAsXlsx,
};
