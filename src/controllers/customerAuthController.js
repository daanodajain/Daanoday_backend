const svc = require('../services/customerAuthService');
const { success, error } = require('../utils/response');

const sendOtp = async (req, res) => {
  try { res.json(success(await svc.sendOtp(req.body.mobile))); }
  catch (e) { res.status(400).json(error(e.message)); }
};

const login = async (req, res) => {
  try { res.json(success(await svc.login(req.body))); }
  catch (e) { res.status(401).json(error(e.message)); }
};

const getMyReceipts = async (req, res) => {
  try { res.json(success(await svc.getMyReceipts(req.user.userId))); }
  catch (e) { res.status(400).json(error(e.message)); }
};

module.exports = { sendOtp, login, getMyReceipts };
