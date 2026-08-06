const svc = require('../services/storeService');
const { success, error } = require('../utils/response');

const getOne = async (req, res) => {
  try { success(res, await svc.getStoreById(req.storeId)); }
  catch (e) { error(res, e.message, 404); }
};

const update = async (req, res) => {
  try { success(res, await svc.updateStore(req.storeId, req.body)); }
  catch (e) { error(res, e.message); }
};

module.exports = { getOne, update };
