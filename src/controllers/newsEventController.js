const svc = require('../services/newsEventService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { res.json(success(await svc.getAll(req.storeId))); }
  catch (e) { error(res, e.message, 400); }
};

const getById = async (req, res) => {
  try { res.json(success(await svc.getById(req.params.id, req.storeId))); }
  catch (e) { error(res, e.message, 404); }
};

const create = async (req, res) => {
  try { res.status(201).json(success(await svc.create(req.body, req.storeId, req.user.id))); }
  catch (e) { error(res, e.message, 400); }
};

const update = async (req, res) => {
  try { res.json(success(await svc.update(req.params.id, req.storeId, req.body))); }
  catch (e) { error(res, e.message, 400); }
};

const remove = async (req, res) => {
  try { await svc.remove(req.params.id, req.storeId); res.json(success(null)); }
  catch (e) { error(res, e.message, 400); }
};

module.exports = { getAll, getById, create, update, remove };
