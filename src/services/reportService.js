const db = require('../config/db');
const XLSX = require('xlsx');
const { findOrCreateCustomerForStore } = require('./customerService');

// Export customers to Excel
const exportCustomersToExcel = async (storeId) => {
  const [customers] = await db.query(
    `SELECT c.id, c.name, c.mobile, c.email, csa.account_number, csa.is_primary_store
     FROM customers c
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = ?
     ORDER BY c.name`,
    [storeId]
  );

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(customers.map(c => ({
    'Customer Name': c.name,
    'Mobile Number': c.mobile,
    'Email': c.email || '',
    'Account Number': c.account_number,
    'Primary Store': c.is_primary_store ? 'Yes' : 'No',
  })));

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Customers');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

// Import customers from Excel
const importCustomersFromExcel = async (storeId, fileBuffer, userId) => {
  const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
  const worksheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(worksheet);

  if (!data || data.length === 0) {
    throw new Error('EMPTY_FILE');
  }

  const conn = await db.getConnection();
  await conn.beginTransaction();

  try {
    const results = {
      imported: 0,
      failed: 0,
      errors: [],
    };

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowNum = i + 2; // Excel row number (1-indexed + header)

      try {
        // Validate required fields
        if (!row['Customer Name'] || !row['Mobile Number']) {
          results.failed++;
          results.errors.push({
            row: rowNum,
            error: 'Customer Name and Mobile Number are required',
          });
          continue;
        }

        const mobile = String(row['Mobile Number']).trim();
        const name = String(row['Customer Name']).trim();
        const email = row['Email'] ? String(row['Email']).trim() : null;

        // Validate mobile format (10 digits for India)
        if (!/^[6-9]\d{9}$/.test(mobile)) {
          results.failed++;
          results.errors.push({
            row: rowNum,
            error: `Invalid mobile number: ${mobile}`,
          });
          continue;
        }

        // Find or create customer
        const { customerId } = await findOrCreateCustomerForStore(
          mobile,
          name,
          storeId,
          userId,
          conn
        );

        // Update email if provided
        if (email) {
          await conn.query(
            'UPDATE customers SET email = ? WHERE id = ? AND email IS NULL',
            [email, customerId]
          );
        }

        results.imported++;
      } catch (e) {
        results.failed++;
        results.errors.push({
          row: rowNum,
          error: e.message,
        });
      }
    }

    await conn.commit();
    return results;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
};

// Export receipts to Excel
const exportReceiptsToExcel = async (storeId, startDate, endDate) => {
  const [receipts] = await db.query(
    `SELECT r.receipt_number, r.receipt_date, c.name as customer_name, c.mobile,
            csa.account_number, r.total_amount, r.paid_amount, r.payment_mode,
            r.receipt_state, r.status
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     JOIN customer_store_access csa ON csa.customer_id = c.id AND csa.store_id = r.store_id
     WHERE r.store_id = ? AND DATE(r.created_at) BETWEEN ? AND ?
     ORDER BY r.created_at DESC`,
    [storeId, startDate, endDate]
  );

  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.json_to_sheet(receipts.map(r => ({
    'Receipt Number': r.receipt_number,
    'Date': new Date(r.receipt_date).toLocaleDateString('en-IN'),
    'Customer Name': r.customer_name,
    'Mobile': r.mobile,
    'Account Number': r.account_number,
    'Total Amount': r.total_amount,
    'Paid Amount': r.paid_amount || 0,
    'Due Amount': Number(r.total_amount) - Number(r.paid_amount || 0),
    'Payment Mode': r.payment_mode || '-',
    'State': r.receipt_state,
    'Status': r.status,
  })));

  XLSX.utils.book_append_sheet(workbook, worksheet, 'Receipts');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

// Export receipts to Tally CSV
const exportReceiptsToTally = async (storeId, startDate, endDate) => {
  const [receipts] = await db.query(
    `SELECT r.receipt_number, r.receipt_date, c.name as customer_name, c.mobile,
            r.total_amount, r.paid_amount, r.payment_mode, r.receipt_state
     FROM receipts r
     JOIN customers c ON c.id = r.customer_id
     WHERE r.store_id = ? AND DATE(r.created_at) BETWEEN ? AND ?
     ORDER BY r.created_at DESC`,
    [storeId, startDate, endDate]
  );

  // Tally CSV format
  let csv = 'Receipt Number,Date,Customer Name,Mobile,Amount,Payment Mode,Status\n';
  
  receipts.forEach(r => {
    csv += `"${r.receipt_number}","${new Date(r.receipt_date).toLocaleDateString('en-IN')}","${r.customer_name}","${r.mobile}",${r.total_amount},"${r.payment_mode || 'CASH'}","${r.receipt_state}"\n`;
  });

  return Buffer.from(csv, 'utf-8');
};

// Export financial report
const exportFinancialReport = async (storeId, startDate, endDate) => {
  const [receipts] = await db.query(
    `SELECT r.payment_mode, r.status, COUNT(*) as count, SUM(r.total_amount) as total_amount,
            SUM(r.paid_amount) as paid_amount
     FROM receipts r
     WHERE r.store_id = ? AND DATE(r.created_at) BETWEEN ? AND ?
     GROUP BY r.payment_mode, r.status`,
    [storeId, startDate, endDate]
  );

  const [challans] = await db.query(
    `SELECT SUM(total_amount) as total_expense FROM challans
     WHERE store_id = ? AND DATE(created_at) BETWEEN ? AND ?`,
    [storeId, startDate, endDate]
  );

  const totalIncome = receipts.reduce((sum, r) => sum + Number(r.total_amount || 0), 0);
  const totalPaid = receipts.reduce((sum, r) => sum + Number(r.paid_amount || 0), 0);
  const totalExpense = challans[0]?.total_expense || 0;
  const netProfit = totalPaid - totalExpense;

  const workbook = XLSX.utils.book_new();
  
  // Summary sheet
  const summaryData = [
    { Metric: 'Total Income', Amount: totalIncome },
    { Metric: 'Total Paid', Amount: totalPaid },
    { Metric: 'Total Due', Amount: totalIncome - totalPaid },
    { Metric: 'Total Expense', Amount: totalExpense },
    { Metric: 'Net Profit', Amount: netProfit },
  ];
  const summarySheet = XLSX.utils.json_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Details sheet
  const detailsData = receipts.map(r => ({
    'Payment Mode': r.payment_mode || 'CASH',
    'Status': r.status,
    'Count': r.count,
    'Total Amount': r.total_amount,
    'Paid Amount': r.paid_amount || 0,
  }));
  const detailsSheet = XLSX.utils.json_to_sheet(detailsData);
  XLSX.utils.book_append_sheet(workbook, detailsSheet, 'Details');

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

module.exports = {
  exportCustomersToExcel,
  importCustomersFromExcel,
  exportReceiptsToExcel,
  exportReceiptsToTally,
  exportFinancialReport,
};
