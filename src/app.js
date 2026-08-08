require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

// CORS — allow all origins (tighten in production)
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-store-id'],
  credentials: true,
}));

// Handle preflight OPTIONS for all routes
app.options('*', cors());

app.use(express.json());

// Auth (public)
app.use('/api/auth',          require('./routes/authRoutes'));
app.use('/api/customer-auth', require('./routes/customerAuthRoutes'));

// Super Admin (no store context needed)
app.use('/api/super-admin',   require('./routes/superAdminRoutes'));

// Store context switch (authenticate only, no storeContext — sets context)
app.use('/api/store-context', require('./routes/storeContextRoutes'));

// Customer self-service portal
app.use('/api/customer-profile', require('./routes/customerProfileRoutes'));

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
app.get('/api/health', (req, res) => res.json({ status: 'UP' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ status: 'ERROR', DDMS_error_code: 'INTERNAL_SERVER_ERROR' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`DaanoDay backend running on port ${PORT}`));
