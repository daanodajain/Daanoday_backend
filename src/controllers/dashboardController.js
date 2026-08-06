const svc = require('../services/dashboardService');
const { success, error } = require('../utils/response');

const getStats = async (req, res) => {
  try { res.json(success(await svc.getStats(req.storeId))); }
  catch (e) { res.status(400).json(error(e.message)); }
};

const getRevenue = async (req, res) => {
  try { res.json(success(await svc.getRevenueData(req.storeId, parseInt(req.query.days) || 30))); }
  catch (e) { res.status(400).json(error(e.message)); }
};

const getPaymentModes = async (req, res) => {
  try { res.json(success(await svc.getPaymentModeDistribution(req.storeId))); }
  catch (e) { res.status(400).json(error(e.message)); }
};

const getMonthly = async (req, res) => {
  try { res.json(success(await svc.getMonthlyComparison(req.storeId))); }
  catch (e) { res.status(400).json(error(e.message)); }
};

const getRecent = async (req, res) => {
  try { res.json(success(await svc.getRecentReceipts(req.storeId, parseInt(req.query.limit) || 10))); }
  catch (e) { res.status(400).json(error(e.message)); }
};

module.exports = { getStats, getRevenue, getPaymentModes, getMonthly, getRecent };
