const svc = require('../services/notificationService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { success(res, await svc.getAll(req.user.id, req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getUnreadCount = async (req, res) => {
  try { success(res, await svc.getUnreadCount(req.user.id, req.storeId)); }
  catch (e) { error(res, e.message); }
};

const create = async (req, res) => {
  try { success(res, await svc.create(req.body.userId || req.user.id, req.storeId, req.body), 201); }
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

module.exports = { getAll, getUnreadCount, create, markRead, markAllRead, remove };
