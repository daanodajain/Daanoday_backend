const svc = require('../services/userService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { success(res, await svc.getAllUsers(req.storeId, req.user.id)); }
  catch (e) { error(res, e.message); }
};

const getOne = async (req, res) => {
  try { success(res, await svc.getUserById(req.params.id)); }
  catch (e) { error(res, e.message, 404); }
};

const create = async (req, res) => {
  try { success(res, await svc.createUser(req.body, req.storeId, req.user.id), 201); }
  catch (e) { error(res, e.message); }
};

const update = async (req, res) => {
  try { success(res, await svc.updateUser(req.params.id, req.body, req.user.id, req.storeId)); }
  catch (e) { error(res, e.message); }
};

const remove = async (req, res) => {
  try { await svc.deleteUser(req.params.id, req.user.id, req.storeId); success(res, null); }
  catch (e) { error(res, e.message); }
};

const toggleStatus = async (req, res) => {
  try { success(res, await svc.toggleUserStatus(req.params.id, req.user.id)); }
  catch (e) { error(res, e.message); }
};

const assignRole = async (req, res) => {
  try {
    await svc.assignRoleInStore(req.params.id, req.storeId, req.body.roleId, req.user.id);
    success(res, { message: 'Role assigned' });
  } catch (e) { error(res, e.message); }
};

module.exports = { getAll, getOne, create, update, remove, toggleStatus, assignRole };
