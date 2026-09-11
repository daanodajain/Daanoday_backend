const svc = require('../services/reportService');
const { success, error } = require('../utils/response');

// Export customers
const exportCustomers = async (req, res) => {
  try {
    const buffer = await svc.exportCustomersToExcel(req.storeId);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="customers_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (e) {
    error(res, e.message);
  }
};

// Import customers
const importCustomers = async (req, res) => {
  try {
    if (!req.file) return error(res, 'FILE_REQUIRED');
    
    const result = await svc.importCustomersFromExcel(req.storeId, req.file.buffer, req.user.id);
    success(res, result, 201);
  } catch (e) {
    error(res, e.message);
  }
};

// Export receipts to Excel
const exportReceiptsExcel = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return error(res, 'START_DATE_AND_END_DATE_REQUIRED');
    
    const buffer = await svc.exportReceiptsToExcel(req.storeId, startDate, endDate);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="receipts_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (e) {
    error(res, e.message);
  }
};

// Export receipts to Tally CSV
const exportReceiptsTally = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return error(res, 'START_DATE_AND_END_DATE_REQUIRED');
    
    const buffer = await svc.exportReceiptsToTally(req.storeId, startDate, endDate);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="receipts_tally_${Date.now()}.csv"`);
    res.send(buffer);
  } catch (e) {
    error(res, e.message);
  }
};

// Export financial report
const exportFinancial = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    if (!startDate || !endDate) return error(res, 'START_DATE_AND_END_DATE_REQUIRED');
    
    const buffer = await svc.exportFinancialReport(req.storeId, startDate, endDate);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="financial_report_${Date.now()}.xlsx"`);
    res.send(buffer);
  } catch (e) {
    error(res, e.message);
  }
};

// GET /reports/import/template/:type  — downloads a blank XLSX template for the given import type
const downloadImportTemplate = async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const type = req.params.type;

    const templates = {
      customers: [['name', 'mobile', 'email', 'address']],
      receipts:  [['customer_mobile', 'amount', 'payment_mode', 'particular', 'remarks']],
    };

    const headers = templates[type];
    if (!headers) return error(res, 'UNKNOWN_TEMPLATE_TYPE', 400);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(headers);
    XLSX.utils.book_append_sheet(wb, ws, 'Template');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${type}-import-template.xlsx"`);
    res.send(buffer);
  } catch (e) { error(res, e.message); }
};

module.exports = {
  exportCustomers,
  importCustomers,
  exportReceiptsExcel,
  exportReceiptsTally,
  exportFinancial,
  downloadImportTemplate,
};
