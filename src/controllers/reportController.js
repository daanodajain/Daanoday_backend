const svc = require('../services/reportService');
const { success, error } = require('../utils/response');

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const getReceipts = async (req, res) => {
  try { success(res, await svc.getReceiptReport(req.storeId, req.query)); }
  catch (e) { error(res, e.message); }
};

const getFinancial = async (req, res) => {
  try { success(res, await svc.getFinancialReport(req.storeId, req.query)); }
  catch (e) { error(res, e.message); }
};

const getCustomerHistory = async (req, res) => {
  try { success(res, await svc.getCustomerDonationHistory(req.storeId, req.params.customerId)); }
  catch (e) { error(res, e.message, 404); }
};

const exportReceiptsExcel = async (req, res) => {
  try {
    const buffer = await svc.exportReceiptsAsXlsx(req.storeId, req.query);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="receipts.xlsx"');
    res.send(buffer);
  } catch (e) { error(res, e.message); }
};

const exportFinancialExcel = async (req, res) => {
  try {
    const buffer = await svc.exportFinancialAsXlsx(req.storeId, req.query);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="financial-report.xlsx"');
    res.send(buffer);
  } catch (e) { error(res, e.message); }
};

// Tally export — CSV (Tally can import CSV via its own import tool). A native Tally
// XML voucher format is a separate, more involved task — not implemented here.
const exportReceiptsTally = async (req, res) => {
  try {
    const csv = await svc.exportReceiptsAsCsv(req.storeId, req.query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="receipts-tally.csv"');
    res.send(csv);
  } catch (e) { error(res, e.message); }
};

// Import — parse uploaded xlsx/csv and bulk insert
const importData = async (req, res) => {
  try {
    const result = await svc.importData(req.params.type, req.file, req.storeId, req.user.id);
    success(res, result);
  } catch (e) { error(res, e.message); }
};

// Download import template for a given type
const downloadTemplate = async (req, res) => {
  try {
    const { buffer, filename } = svc.getImportTemplate(req.params.type);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (e) { error(res, e.message); }
};

const exportChallans = async (req, res) => {
  try {
    const buffer = await svc.exportChallansAsXlsx(req.storeId, req.query);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="challans.xlsx"');
    res.send(buffer);
  } catch (e) { error(res, e.message); }
};

const exportCustomers = async (req, res) => {
  try {
    const buffer = await svc.exportCustomersAsXlsx(req.storeId);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="customers.xlsx"');
    res.send(buffer);
  } catch (e) { error(res, e.message); }
};

const exportSuppliers = async (req, res) => {
  try {
    const buffer = await svc.exportSuppliersAsXlsx(req.storeId);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="suppliers.xlsx"');
    res.send(buffer);
  } catch (e) { error(res, e.message); }
};

const exportTransactions = async (req, res) => {
  try {
    const buffer = await svc.exportTransactionsAsXlsx(req.storeId, req.query);
    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader('Content-Disposition', 'attachment; filename="transactions.xlsx"');
    res.send(buffer);
  } catch (e) { error(res, e.message); }
};

module.exports = { getReceipts, getFinancial, getCustomerHistory, exportReceiptsExcel, exportFinancialExcel, exportReceiptsTally, exportChallans, exportCustomers, exportSuppliers, exportTransactions, importData, downloadTemplate };
