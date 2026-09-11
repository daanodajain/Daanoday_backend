const { verifyToken } = require('../utils/jwt');
const { error } = require('../utils/response');
const db = require('../config/db');

/**
 * customerAuth — authenticates a CUSTOMER JWT (userType === 'CUSTOMER').
 * Sets req.customer = { id, name, mobile, email, password_hash }.
 * Used by customerProfileRoutes and customerPaymentRoutes.
 */
const customerAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return error(res, 'UNAUTHORIZED', 401);
  try {
    const decoded = verifyToken(authHeader.split(' ')[1]);
    if (decoded.userType !== 'CUSTOMER') return error(res, 'FORBIDDEN', 403);
    const [[customer]] = await db.query(
      'SELECT id, name, mobile, email, password_hash FROM customers WHERE id = ?',
      [decoded.userId]
    );
    if (!customer) return error(res, 'CUSTOMER_NOT_FOUND', 401);
    req.customer = customer;
    next();
  } catch { return error(res, 'INVALID_TOKEN', 401); }
};

module.exports = { customerAuth };
