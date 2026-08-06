const { sendOtp, login, refreshToken } = require('../services/authService');
const { success, error } = require('../utils/response');

const sendOtpHandler = async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return error(res, 'Mobile is required');
    const result = await sendOtp(mobile);
    success(res, result);
  } catch (e) {
    error(res, e.message);
  }
};

const loginHandler = async (req, res) => {
  try {
    const data = await login(req.body);
    success(res, data);
  } catch (e) {
    error(res, e.message, 401);
  }
};

const refreshHandler = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;
    if (!token) return error(res, 'Refresh token required');
    const data = await refreshToken(token);
    success(res, data);
  } catch (e) {
    error(res, 'INVALID_REFRESH_TOKEN', 401);
  }
};

const logoutHandler = async (req, res) => {
  // Stateless JWT - client deletes token. Optionally implement blacklist here.
  success(res, { message: 'Logged out successfully' });
};

module.exports = { sendOtpHandler, loginHandler, refreshHandler, logoutHandler };
