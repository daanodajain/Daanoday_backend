const svc = require('../services/storeSettingsService');
const { success, error } = require('../utils/response');

const get = async (req, res) => {
  try { success(res, await svc.getByStore(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const update = async (req, res) => {
  try { success(res, await svc.update(req.storeId, req.body, req.user.id)); }
  catch (e) { error(res, e.message); }
};

module.exports = { get, update };
