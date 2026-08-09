const svc = require('../services/dashboardService');
const { success, error } = require('../utils/response');

const getStats = async (req, res) => {
  try { success(res, await svc.getStats(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getRevenue = async (req, res) => {
  try { 
    // req.query.days ko Number mein convert kiya
    const days = Number(req.query.days) || 30;
    success(res, await svc.getRevenueData(req.storeId, days)); 
  }
  catch (e) { error(res, e.message); }
};

const getPaymentModes = async (req, res) => {
  try { success(res, await svc.getPaymentModeDistribution(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getMonthly = async (req, res) => {
  try { success(res, await svc.getMonthlyComparison(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getRecent = async (req, res) => {
  try { 
    // req.query.limit ko Number mein convert kiya
    const limit = Number(req.query.limit) || 10;
    success(res, await svc.getRecentReceipts(req.storeId, limit)); 
  }
  catch (e) { error(res, e.message); }
};


const getPendingApprovals = async (req, res) => {
  try { success(res, await svc.getPendingApprovals(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getReceiptTypeDistribution = async (req, res) => {
  try { success(res, await svc.getReceiptTypeDistribution(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getCustomerGrowth = async (req, res) => {
  try { success(res, await svc.getCustomerGrowth(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getDailyTrend = async (req, res) => {
  try { success(res, await svc.getDailyTrend(req.storeId)); }
  catch (e) { error(res, e.message); }
};

const getYearlyComparison = async (req, res) => {
  try { success(res, await svc.getYearlyComparison(req.storeId)); }
  catch (e) { error(res, e.message); }
};

module.exports = { getStats, getRevenue, getPaymentModes, getMonthly, getRecent, getPendingApprovals, getReceiptTypeDistribution, getCustomerGrowth, getDailyTrend, getYearlyComparison };
