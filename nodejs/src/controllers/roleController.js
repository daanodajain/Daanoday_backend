const svc = require('../services/roleService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { success(res, await svc.getAllRoles(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getOne = async (req, res) => {
  try { success(res, await svc.getRoleById(req.params.id, req.storeId)); }
  catch (e) { error(res, e.message, 404); }
};

const create = async (req, res) => {
  try { success(res, await svc.createRole(req.storeId, req.body, req.user.id), 201); }
  catch (e) { error(res, e.message); }
};

const update = async (req, res) => {
  try { success(res, await svc.updateRole(req.params.id, req.storeId, req.body, req.user.id)); }
  catch (e) { error(res, e.message); }
};

const remove = async (req, res) => {
  try { await svc.deleteRole(req.params.id, req.storeId, req.user.id); success(res, null); }
  catch (e) { error(res, e.message); }
};

const getPermissions = async (req, res) => {
  try { success(res, await svc.getAllPermissions()); }
  catch (e) { error(res, e.message); }
};

const getRolePermissions = async (req, res) => {
  try { success(res, await svc.getRolePermissions(req.params.id)); }
  catch (e) { error(res, e.message); }
};

const assignPermissions = async (req, res) => {
  try {
    await svc.assignPermissions(req.params.id, req.storeId, req.body.permissionIds, req.user.id);
    success(res, { message: 'Permissions updated' });
  } catch (e) { error(res, e.message); }
};

const assignRolesToUser = async (req, res) => {
  try {
    await svc.assignRolesToUser(req.params.userId, req.storeId, req.body.roleIds, req.user.id);
    success(res, { message: 'Roles assigned' });
  } catch (e) { error(res, e.message); }
};

const getUserRoles = async (req, res) => {
  try { success(res, await svc.getUserRoles(req.params.userId, req.storeId)); }
  catch (e) { error(res, e.message); }
};

module.exports = { getAll, getOne, create, update, remove, getPermissions, getRolePermissions, assignPermissions, assignRolesToUser, getUserRoles };
