const storeSvc = require('../services/storeService');
const svc = require('../services/superAdminService');
const { success, error } = require('../utils/response');

const getAllStores = async (req, res) => {
  try { success(res, await svc.getAllStoresWithSubscription()); }
  catch (e) { error(res, e.message); }
};

const createStoreWithAdmin = async (req, res) => {
  try { success(res, await storeSvc.createStoreWithAdmin(req.body), 201); }
  catch (e) { error(res, e.message); }
};

const deleteStore = async (req, res) => {
  try { await storeSvc.deleteStore(req.params.id); success(res, null); }
  catch (e) { error(res, e.message); }
};

const getSystemSettings = async (req, res) => {
  try { success(res, await svc.getAllSystemSettings()); }
  catch (e) { error(res, e.message); }
};

const upsertSystemSetting = async (req, res) => {
  try {
    await svc.upsertSystemSetting(req.body.key, req.body.value, req.body.category || 'GENERAL', req.user.id);
    success(res, { message: 'Setting updated' });
  } catch (e) { error(res, e.message); }
};

const getAllSubscriptions = async (req, res) => {
  try { success(res, await svc.getAllSubscriptions()); }
  catch (e) { error(res, e.message); }
};

const upsertSubscription = async (req, res) => {
  try { success(res, await svc.upsertSubscription(req.params.storeId, req.body, req.user.id)); }
  catch (e) { error(res, e.message); }
};

const extendSubscription = async (req, res) => {
  try { success(res, await svc.extendSubscription(req.params.storeId, req.body.months || 1, req.user.id)); }
  catch (e) { error(res, e.message); }
};

const suspendSubscription = async (req, res) => {
  try { success(res, await svc.suspendSubscription(req.params.storeId, req.body.reason, req.user.id)); }
  catch (e) { error(res, e.message); }
};

module.exports = {
  getAllStores, createStoreWithAdmin, deleteStore,
  getSystemSettings, upsertSystemSetting,
  getAllSubscriptions, upsertSubscription, extendSubscription, suspendSubscription,
};
