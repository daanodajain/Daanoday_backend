const svc = require('../services/changeRequestService');
const { success, error } = require('../utils/response');

const create = async (req, res) => {
  try {
    const result = await svc.createChangeRequest({
      storeId: req.storeId,
      entityType: req.body.entityType,
      entityId: req.body.entityId,
      action: req.body.action,
      requestedBy: req.user.id,
      newData: req.body.newData || null,
      reason: req.body.reason,
    });
    success(res, result, 201);
  } catch (e) { error(res, e.message); }
};

const getAll = async (req, res) => {
  try { success(res, await svc.getAll(req.storeId, req.query.status || null)); }
  catch (e) { error(res, e.message); }
};

const getOne = async (req, res) => {
  try { success(res, await svc.getById(req.params.id)); }
  catch (e) { error(res, e.message, 404); }
};

const approve = async (req, res) => {
  try { success(res, await svc.approveChangeRequest(req.params.id, req.user.id, req.body.reviewNote)); }
  catch (e) { error(res, e.message); }
};

const reject = async (req, res) => {
  try { success(res, await svc.rejectChangeRequest(req.params.id, req.user.id, req.body.reviewNote)); }
  catch (e) { error(res, e.message); }
};

module.exports = { create, getAll, getOne, approve, reject };
