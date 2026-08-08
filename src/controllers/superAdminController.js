const storeSvc = require('../services/storeService');
const svc = require('../services/superAdminService');
const { success, error } = require('../utils/response');

// GET /super-admin/stores — returns { stores: [...] }
const getAllStores = async (req, res) => {
  try {
    const stores = await svc.getAllStoresWithSubscription();
    success(res, { stores });
  } catch (e) { error(res, e.message); }
};

// POST /super-admin/stores — all 13 fields
const createStoreWithAdmin = async (req, res) => {
  try {
    // Support both flat payload and nested { store: {...}, adminName, ... }
    const data = req.body.store
      ? { ...req.body.store, adminName: req.body.adminName, adminMobile: req.body.adminMobile, adminEmail: req.body.adminEmail, adminPassword: req.body.adminPassword }
      : req.body;
    success(res, await storeSvc.createStoreWithAdmin(data), 201);
  } catch (e) { error(res, e.message); }
};

// PUT /super-admin/stores/:id — update store + admin
const updateStoreWithAdmin = async (req, res) => {
  try {
    const data = req.body.store
      ? { ...req.body.store, adminName: req.body.adminName, adminMobile: req.body.adminMobile, adminEmail: req.body.adminEmail, adminPassword: req.body.adminPassword }
      : req.body;
    success(res, await storeSvc.updateStore(req.params.id, data));
  } catch (e) { error(res, e.message); }
};

// DELETE /super-admin/stores/:id
const deleteStore = async (req, res) => {
  try { await storeSvc.deleteStore(req.params.id); success(res, null); }
  catch (e) { error(res, e.message); }
};

// GET /super-admin/stores/:id
const getStore = async (req, res) => {
  try { success(res, await storeSvc.getStoreById(req.params.id)); }
  catch (e) { error(res, e.message, 404); }
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
  getAllStores, createStoreWithAdmin, updateStoreWithAdmin, deleteStore, getStore,
  getSystemSettings, upsertSystemSetting,
  getAllSubscriptions, upsertSubscription, extendSubscription, suspendSubscription,
};
