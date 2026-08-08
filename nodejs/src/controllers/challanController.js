const svc = require('../services/challanService');
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

const getByDateRange = async (req, res) => {
  try { success(res, await svc.getByDateRange(req.storeId, req.query.startDate, req.query.endDate)); }
  catch (e) { error(res, e.message); }
};

const reject = async (req, res) => {
  try { success(res, await svc.rejectChallan(req.params.id, req.storeId, req.user.id, req.body.note)); }
  catch (e) { error(res, e.message); }
};

const notAllowed = (req, res) =>
  res.status(405).json({ status: 'ERROR', DDMS_error_code: 'USE_CHANGE_REQUEST_ENDPOINT' });

module.exports = { getAll, getById, create, getByDateRange, reject, notAllowed };
