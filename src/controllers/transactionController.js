const svc = require('../services/transactionService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { res.json(success(await svc.getAll(req.storeId))); }
  catch (e) { res.status(400).json(error(e.message)); }
};

const getById = async (req, res) => {
  try { res.json(success(await svc.getById(req.params.id, req.storeId))); }
  catch (e) { res.status(404).json(error(e.message)); }
};

module.exports = { getAll, getById };
