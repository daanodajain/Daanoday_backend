const jwt = require('jsonwebtoken');
require('dotenv').config();

// SECURITY (S3): access and refresh tokens previously had the exact same
// shape (same secret, no distinguishing claim) — a leaked *access* token
// could be handed to /api/auth/refresh and the server would mint a brand
// new 7-day refresh token from it, since nothing checked which kind of
// token it actually was. Tagging each token with `type` and requiring
// callers that need a refresh token to use verifyRefreshToken closes that
// off. (Reusing one secret for both is still fine on its own — normal for
// a single-service JWT setup — the missing piece was the type check.)
const generateToken = (payload) =>
  jwt.sign({ ...payload, type: 'access' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '24h' });

const generateRefreshToken = (payload) =>
  jwt.sign({ ...payload, type: 'refresh' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' });

const verifyToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

// Use specifically where a *refresh* token is expected (e.g. /auth/refresh)
// — throws if handed a valid-but-wrong-type token (e.g. an access token).
const verifyRefreshToken = (token) => {
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  if (decoded.type !== 'refresh') throw new Error('NOT_A_REFRESH_TOKEN');
  return decoded;
};

module.exports = { generateToken, generateRefreshToken, verifyToken, verifyRefreshToken };
