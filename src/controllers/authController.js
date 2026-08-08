const { login, changePassword, refreshToken, verifyUnlockPassword } = require('../services/authService');
const { success, error } = require('../utils/response');

const loginHandler = async (req, res) => {
  try {
    const data = await login(req.body);
    success(res, data);
  } catch (e) {
    error(res, e.message, 401);
  }
};

const changePasswordHandler = async (req, res) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword) return error(res, 'NEW_PASSWORD_REQUIRED');
    const data = await changePassword(req.user.id, newPassword);
    success(res, data);
  } catch (e) {
    error(res, e.message);
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
  success(res, { message: 'Logged out successfully' });
};

const unlockHandler = async (req, res) => {
  try {
    const { password } = req.body;
    const data = await verifyUnlockPassword(req.user.id, password);
    success(res, data);
  } catch (e) {
    error(res, e.message, 401);
  }
};

module.exports = { loginHandler, changePasswordHandler, refreshHandler, logoutHandler, unlockHandler };
