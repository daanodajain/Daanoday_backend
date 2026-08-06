const svc = require('../services/notificationService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { success(res, await svc.getAll(req.user.id, req.storeId)); }
  catch (e) { error(res, e.message); }
};

const markRead = async (req, res) => {
  try { await svc.markAsRead(req.params.id, req.user.id); success(res, null); }
  catch (e) { error(res, e.message); }
};

const markAllRead = async (req, res) => {
  try { await svc.markAllAsRead(req.user.id, req.storeId); success(res, null); }
  catch (e) { error(res, e.message); }
};

const remove = async (req, res) => {
  try { await svc.remove(req.params.id, req.user.id); success(res, null); }
  catch (e) { error(res, e.message); }
};

module.exports = { getAll, markRead, markAllRead, remove };
