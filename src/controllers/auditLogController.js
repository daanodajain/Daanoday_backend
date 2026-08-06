const svc = require('../services/auditLogService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { success(res, await svc.getAll(req.storeId, req.query.limit ? Number(req.query.limit) : 100)); }
  catch (e) { error(res, e.message); }
};

module.exports = { getAll };
