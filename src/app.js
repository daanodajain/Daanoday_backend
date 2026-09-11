require('dotenv').config();
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();

// Rate limiters (C1 FIX)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many login attempts, please try again later'
});
const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many OTP requests, please try again later'
});

// Middleware
app.use(express.json());
app.use(cors({
  origin: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : ['https://daanoday.com', 'https://www.daanoday.com', 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Store-ID'],
}));

// NOTE on CSRF: this API is entirely stateless Bearer-JWT (Authorization
// header), never cookie/session based — nothing here relies on the browser
// automatically attaching credentials, which is the exact ambient-authority
// problem CSRF tokens defend against. A previous version applied
// `csurf({ cookie: true })` globally to every route (including
// /api/auth/login) and then had a no-op "skip for /api/" middleware placed
// *after* it — both branches of that middleware called next() regardless,
// so it never skipped anything, and csurf had already rejected the request
// by then anyway. Since the frontend never fetched or sent a CSRF token,
// EVERY POST/PUT/DELETE — including login itself — failed with
// EBADCSRFTOKEN. Removed rather than "fixed", since it was solving a
// problem this auth model doesn't have.

// Serve uploaded profile avatars (see src/config/avatarUpload.js)
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Never let a CDN/reverse-proxy cache API responses - this is a dynamic
// API, every response must always reflect the current DB state.
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// Auth (public)
app.use('/api/auth',          loginLimiter, require('./routes/authRoutes'));
app.use('/api/customer-auth', otpLimiter, require('./routes/customerAuthRoutes'));

// Super Admin (no store context needed)
app.use('/api/super-admin',   require('./routes/superAdminRoutes'));

// Store context switch (authenticate only, no storeContext — sets context)
app.use('/api/store-context', require('./routes/storeContextRoutes'));

// Customer self-service portal
app.use('/api/customer-profile',  require('./routes/customerProfileRoutes'));
app.use('/api/customer-payments', require('./routes/customerPaymentRoutes'));

// Store-scoped routes (all require x-store-id header)
app.use('/api/stores',         require('./routes/storeRoutes'));
app.use('/api/store-settings', require('./routes/storeSettingsRoutes'));
app.use('/api/users',          require('./routes/userRoutes'));
app.use('/api/roles',          require('./routes/roleRoutes'));
app.use('/api/customers',      require('./routes/customerRoutes'));
app.use('/api/suppliers',      require('./routes/supplierRoutes'));
app.use('/api/particulars',    require('./routes/particularRoutes'));
app.use('/api/receipts',       require('./routes/receiptRoutes'));
app.use('/api/challans',       require('./routes/challanRoutes'));
app.use('/api/change-requests',require('./routes/changeRequestRoutes'));
app.use('/api/transactions',   require('./routes/transactionRoutes'));
app.use('/api/dashboard',      require('./routes/dashboardRoutes'));
app.use('/api/notifications',  require('./routes/notificationRoutes'));
app.use('/api/news-events',    require('./routes/newsEventRoutes'));
app.use('/api/reports',        require('./routes/reportRoutes'));
app.use('/api/payments',       require('./routes/paymentRoutes'));
app.use('/api/user-profile',   require('./routes/userProfileRoutes'));

// Audit logs — register under both /api/audit-logs AND /api/audit (frontend uses /api/audit/entity/...)
const auditRoutes = require('./routes/auditLogRoutes');
app.use('/api/audit-logs', auditRoutes);
app.use('/api/audit',      auditRoutes);

// Health check
app.get('/api/health', (req, res) => {
  const { success } = require('./utils/response');
  success(res, { status: 'UP' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ status: 'ERROR', DDMS_error_code: 'INTERNAL_SERVER_ERROR' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`DaanoDay backend running on port ${PORT}`));
