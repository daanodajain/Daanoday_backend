const svc = require('../services/customerService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { success(res, await svc.getAllCustomers(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getById = async (req, res) => {
  try { success(res, await svc.getCustomerById(req.params.id, req.storeId)); }
  catch (e) { error(res, e.message, 404); }
};

const create = async (req, res) => {
  try { success(res, await svc.createCustomer(req.body, req.storeId, req.user.id), 201); }
  catch (e) { error(res, e.message); }
};

const update = async (req, res) => {
  try { success(res, await svc.updateCustomer(req.params.id, req.storeId, req.body)); }
  catch (e) { error(res, e.message); }
};

const remove = async (req, res) => {
  try { await svc.deleteCustomer(req.params.id, req.storeId); success(res, null); }
  catch (e) { error(res, e.message); }
};

const search = async (req, res) => {
  try { success(res, await svc.searchCustomers(req.storeId, req.query.q || '')); }
  catch (e) { error(res, e.message); }
};

module.exports = { getAll, getById, create, update, remove, search };
