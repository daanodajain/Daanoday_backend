require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-store-id'],
}));
app.use(express.json());

// Auth (public)
app.use('/api/auth',          require('./routes/authRoutes'));
app.use('/api/customer-auth', require('./routes/customerAuthRoutes'));

// Super Admin (no store context needed)
app.use('/api/super-admin',   require('./routes/superAdminRoutes'));

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
app.use('/api/audit-logs',     require('./routes/auditLogRoutes'));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'UP' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ status: 'ERROR', DDMS_error_code: 'INTERNAL_SERVER_ERROR' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`DaanoDay backend running on port ${PORT}`));
