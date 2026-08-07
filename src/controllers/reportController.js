const svc = require('../services/reportService');
const { success, error } = require('../utils/response');

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
    const csv = await svc.exportReceiptsAsCsv(req.storeId, req.query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="receipts.csv"');
    res.send(csv);
  } catch (e) { error(res, e.message); }
};

const exportFinancialExcel = async (req, res) => {
  try {
    const csv = await svc.exportFinancialAsCsv(req.storeId, req.query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="financial-report.csv"');
    res.send(csv);
  } catch (e) { error(res, e.message); }
};

// Tally export — same as CSV for now; Tally-specific format can be implemented later
const exportReceiptsTally = async (req, res) => {
  try {
    const csv = await svc.exportReceiptsAsCsv(req.storeId, req.query);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="receipts-tally.csv"');
    res.send(csv);
  } catch (e) { error(res, e.message); }
};

// Import — placeholder; actual file parsing requires multer setup
const importData = async (req, res) => {
  try {
    success(res, { message: `Import for type '${req.params.type}' received. Processing not yet implemented.` });
  } catch (e) { error(res, e.message); }
};

module.exports = { getReceipts, getFinancial, getCustomerHistory, exportReceiptsExcel, exportFinancialExcel, exportReceiptsTally, importData };
