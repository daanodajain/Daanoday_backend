const svc = require('../services/receiptService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { success(res, await svc.getAll(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getById = async (req, res) => {
  try { success(res, await svc.getById(req.params.id, req.storeId)); }
  catch (e) { error(res, e.message, 404); }
};

const create = async (req, res) => {
  try { success(res, await svc.create(req.body, req.storeId, req.user.id), 201); }
  catch (e) { error(res, e.message); }
};

const approve = async (req, res) => {
  try { success(res, await svc.approveReceipt(req.params.id, req.storeId, req.user.id, req.body.note)); }
  catch (e) { error(res, e.message); }
};

const reject = async (req, res) => {
  try { success(res, await svc.rejectReceipt(req.params.id, req.storeId, req.user.id, req.body.note)); }
  catch (e) { error(res, e.message); }
};

const getPending = async (req, res) => {
  try { success(res, await svc.getPendingApprovals(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getByDateRange = async (req, res) => {
  try { success(res, await svc.getByDateRange(req.storeId, req.query.startDate, req.query.endDate)); }
  catch (e) { error(res, e.message); }
};

const stateChange = async (req, res) => {
  try { success(res, await svc.changeState(req.params.id, req.storeId, req.user.id, req.body.state, req.body.note)); }
  catch (e) { error(res, e.message); }
};

const pay = async (req, res) => {
  try { success(res, await svc.markPaid(req.params.id, req.storeId, req.user.id, req.body?.paymentMode)); }
  catch (e) { error(res, e.message); }
};

const collectRemaining = async (req, res) => {
  try { success(res, await svc.collectRemaining(req.params.id, req.storeId, req.user.id, req.body?.paymentMode, req.body?.paymentDate)); }
  catch (e) { error(res, e.message); }
};

const getApprovals = async (req, res) => {
  try { success(res, await svc.getApprovals(req.params.id, req.storeId)); }
  catch (e) { error(res, e.message); }
};

// PDF — generate simple HTML-based PDF receipt
const getPdf = async (req, res) => {
  try {
    const receipt = await svc.getById(req.params.id, req.storeId);
    const html = `
<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Receipt ${receipt.receipt_number}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 600px; margin: 40px auto; padding: 20px; }
  h1 { text-align: center; font-size: 18px; }
  .meta { display: flex; justify-content: space-between; margin: 16px 0; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; }
  th, td { border: 1px solid #ddd; padding: 8px; text-align: left; font-size: 13px; }
  th { background: #f5f5f5; }
  .total { text-align: right; font-weight: bold; margin-top: 12px; font-size: 14px; }
  .footer { margin-top: 40px; text-align: center; font-size: 11px; color: #999; }
</style></head><body>
<h1>RECEIPT</h1>
<div class="meta">
  <div><strong>Receipt No:</strong> ${receipt.receipt_number}</div>
  <div><strong>Date:</strong> ${new Date(receipt.created_at).toLocaleDateString('en-IN')}</div>
</div>
<div class="meta">
  <div><strong>Customer:</strong> ${receipt.customer_name}</div>
  <div><strong>Mobile:</strong> ${receipt.customer_mobile}</div>
</div>
<div class="meta">
  <div><strong>Account No:</strong> ${receipt.account_number}</div>
  <div><strong>Payment Mode:</strong> ${receipt.payment_mode}</div>
</div>
<table>
  <tr><th>Particular</th><th>Amount (₹)</th></tr>
  ${(receipt.particulars || []).map(p => `<tr><td>${p.particular_name}</td><td>${Number(p.amount).toLocaleString('en-IN')}</td></tr>`).join('')}
</table>
<div class="total">Total: ₹${Number(receipt.total_amount).toLocaleString('en-IN')}</div>
<div class="footer">Status: ${receipt.receipt_state} | Generated on ${new Date().toLocaleString('en-IN')}</div>
</body></html>`;

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `inline; filename="receipt-${receipt.receipt_number}.html"`);
    res.send(html);
  } catch (e) { error(res, e.message); }
};

// Direct PUT/DELETE not allowed — must use change_requests
const notAllowed = (req, res) =>
  res.status(405).json({ status: 'ERROR', DDMS_error_code: 'USE_CHANGE_REQUEST_ENDPOINT' });

module.exports = { getAll, getById, create, approve, reject, getPending, getByDateRange, stateChange, pay, collectRemaining, getApprovals, getPdf, notAllowed };
