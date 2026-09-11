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

const getFinancialSummary = async (req, res) => {
  const { error: errRes, success: succRes } = require('../utils/response');
  const db = require('../config/db');
  try {
    const { startDate, endDate } = req.query;
    const conditions = ['store_id = ?', "receipt_state = 'APPROVED'"];
    const params = [req.storeId];
    if (startDate) { conditions.push('DATE(created_at) >= ?'); params.push(startDate); }
    if (endDate)   { conditions.push('DATE(created_at) <= ?'); params.push(endDate); }
    const where = conditions.join(' AND ');

    const [[totals]] = await db.query(
      `SELECT COALESCE(SUM(total_amount),0) as totalRevenue,
              COALESCE(SUM(paid_amount),0)  as totalCollected,
              COALESCE(SUM(total_amount - paid_amount),0) as totalDue,
              COUNT(*) as totalReceipts,
              SUM(status='PAID') as paidCount,
              SUM(status='PARTIAL') as partialCount,
              SUM(status='UNPAID') as unpaidCount
       FROM receipts WHERE ${where}`, params
    );
    succRes(res, totals);
  } catch (e) { errRes(res, e.message); }
};

module.exports = { getStats, getFinancialSummary, getRevenue, getPaymentModes, getMonthly, getRecent, getPendingApprovals, getReceiptTypeDistribution, getCustomerGrowth, getDailyTrend, getYearlyComparison };
