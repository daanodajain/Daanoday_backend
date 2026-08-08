const svc = require('../services/customerAuthService');
const { success, error } = require('../utils/response');

const sendOtp = async (req, res) => {
  try { success(res, await svc.sendOtp(req.body.mobile)); }
  catch (e) { error(res, e.message, 400); }
};

const login = async (req, res) => {
  try { success(res, await svc.login(req.body)); }
  catch (e) { error(res, e.message, 401); }
};

const getMyReceipts = async (req, res) => {
  try { success(res, await svc.getMyReceipts(req.user.userId)); }
  catch (e) { error(res, e.message, 400); }
};

module.exports = { sendOtp, login, getMyReceipts };
