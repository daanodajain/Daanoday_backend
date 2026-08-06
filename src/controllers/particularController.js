const svc = require('../services/particularService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { res.json(success(await svc.getAll(req.storeId, req.query.type || null))); }
  catch (e) { res.status(400).json(error(e.message)); }
};

const getById = async (req, res) => {
  try { res.json(success(await svc.getById(req.params.id, req.storeId))); }
  catch (e) { res.status(404).json(error(e.message)); }
};

const create = async (req, res) => {
  try { res.status(201).json(success(await svc.create(req.body, req.storeId))); }
  catch (e) { res.status(400).json(error(e.message)); }
};

const update = async (req, res) => {
  try { res.json(success(await svc.update(req.params.id, req.storeId, req.body))); }
  catch (e) { res.status(400).json(error(e.message)); }
};

const remove = async (req, res) => {
  try { await svc.remove(req.params.id, req.storeId); res.json(success(null)); }
  catch (e) { res.status(400).json(error(e.message)); }
};

module.exports = { getAll, getById, create, update, remove };
