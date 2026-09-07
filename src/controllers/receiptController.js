const svc       = require('../services/receiptService');
const settingsSvc = require('../services/storeSettingsService');
const { success, error } = require('../utils/response');
const { renderReceiptPdf } = require('../utils/receiptPdf');

const getAll        = async (req, res) => { try { success(res, await svc.getAll(req.storeId, req.query)); } catch (e) { error(res, e.message); } };
const getById       = async (req, res) => { try { success(res, await svc.getById(req.params.id, req.storeId)); } catch (e) { error(res, e.message); } };
const create        = async (req, res) => { try { success(res, await svc.create(req.body, req.storeId, req.user.id), 201); } catch (e) { error(res, e.message); } };
const approve       = async (req, res) => { try { success(res, await svc.approveReceipt(req.params.id, req.storeId, req.user.id, req.body?.note)); } catch (e) { error(res, e.message); } };
const reject        = async (req, res) => { try { success(res, await svc.rejectReceipt(req.params.id, req.storeId, req.user.id, req.body?.reason)); } catch (e) { error(res, e.message); } };
const getPending    = async (req, res) => { try { success(res, await svc.getPendingApprovals(req.storeId)); } catch (e) { error(res, e.message); } };
const getByDateRange = async (req, res) => { try { success(res, await svc.getByDateRange(req.storeId, req.query.startDate, req.query.endDate)); } catch (e) { error(res, e.message); } };
const stateChange   = async (req, res) => { try { success(res, await svc.changeState(req.params.id, req.storeId, req.user.id, req.body.state, req.body?.note)); } catch (e) { error(res, e.message); } };
const pay           = async (req, res) => { try { success(res, await svc.markPaid(req.params.id, req.storeId, req.user.id, req.body?.paymentMode)); } catch (e) { error(res, e.message); } };
const collectRemaining = async (req, res) => { try { success(res, await svc.collectRemaining(req.params.id, req.storeId, req.user.id, req.body?.paymentMode, req.body?.paymentDate)); } catch (e) { error(res, e.message); } };
const getApprovals  = async (req, res) => { try { success(res, await svc.getApprovals(req.params.id, req.storeId)); } catch (e) { error(res, e.message); } };
const approveCashRequest = async (req, res) => { try { success(res, await svc.approveCashRequest(req.params.id, req.storeId, req.user.id)); } catch (e) { error(res, e.message); } };
const rejectCashRequest  = async (req, res) => { try { success(res, await svc.rejectCashRequest(req.params.id, req.storeId, req.user.id, req.body?.note)); } catch (e) { error(res, e.message); } };

// ── PDF Generation ──────────────────────────────────────────────────────────
const getPdf = async (req, res) => {
  try {
    const receipt = await svc.getById(req.params.id, req.storeId);
    let settings = {};
    try { settings = await settingsSvc.getByStore(req.storeId); } catch (e) {}
    renderReceiptPdf(receipt, settings, res);
  } catch (e) {
    console.error('PDF error:', e);
    if (res.headersSent) res.end();
    else error(res, e.message);
  }
};

const notAllowed = (req, res) =>
  res.status(405).json({ status: 'ERROR', DDMS_error_code: 'USE_CHANGE_REQUEST_ENDPOINT' });

module.exports = { getAll, getById, create, approve, reject, getPending, getByDateRange, stateChange, pay, collectRemaining, getApprovals, getPdf, notAllowed, approveCashRequest, rejectCashRequest };
