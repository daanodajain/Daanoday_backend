const svc = require('../services/roleService');
const { success, error } = require('../utils/response');

const getAll = async (req, res) => {
  try { success(res, await svc.getAllRoles(req.storeId)); }
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

module.exports = { getAll, getPermissions, getRolePermissions, assignPermissions };
