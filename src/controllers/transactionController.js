const svc = require('../services/transactionService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { res.json(success(await svc.getAll(req.storeId))); }
  catch (e) { error(res, e.message, 400); }
};

const getById = async (req, res) => {
  try { res.json(success(await svc.getById(req.params.id, req.storeId))); }
  catch (e) { error(res, e.message, 404); }
};

module.exports = { getAll, getById };
