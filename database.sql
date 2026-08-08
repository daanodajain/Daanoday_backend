-- =====================================================
-- DAANODAY TEMPLE MANAGEMENT SYSTEM
-- Clean Schema — matches architecture spec exactly
-- =====================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- Drop all tables in reverse dependency order
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS change_requests;
DROP TABLE IF EXISTS receipt_approvals;
DROP TABLE IF EXISTS receipt_particulars;
DROP TABLE IF EXISTS challan_particulars;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS receipts;
DROP TABLE IF EXISTS challans;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS news_events;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS user_roles;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS customer_store_access;
DROP TABLE IF EXISTS customers;
DROP TABLE IF EXISTS suppliers;
DROP TABLE IF EXISTS particulars;
DROP TABLE IF EXISTS store_settings;
DROP TABLE IF EXISTS subscriptions;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS stores;

-- =====================================================
-- STORES
-- =====================================================
CREATE TABLE stores (
  id                     BIGINT PRIMARY KEY AUTO_INCREMENT,
  name                   VARCHAR(255) NOT NULL,
  address                VARCHAR(500),
  city                   VARCHAR(100),
  state                  VARCHAR(100),
  contact                VARCHAR(20),
  email                  VARCHAR(255),
  store_admin_id         BIGINT NULL,
  subscription_status    ENUM('ACTIVE','EXPIRED','SUSPENDED') DEFAULT 'ACTIVE',
  online_payment_enabled BOOLEAN DEFAULT FALSE,
  active                 BOOLEAN DEFAULT TRUE,
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- USERS  (staff identity — never merge with customers)
-- =====================================================
CREATE TABLE users (
  id                     BIGINT PRIMARY KEY AUTO_INCREMENT,
  name                   VARCHAR(255) NOT NULL,
  email                  VARCHAR(255) UNIQUE,
  mobile                 VARCHAR(15) UNIQUE,
  password_hash          VARCHAR(255),
  first_login            BOOLEAN DEFAULT TRUE,
  failed_login_attempts  INT DEFAULT 0,
  account_locked_until   TIMESTAMP NULL,
  linked_customer_id     BIGINT NULL,   -- FK added after customers table
  active                 BOOLEAN DEFAULT TRUE,
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_users_mobile (mobile),
  INDEX idx_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- CUSTOMERS  (donor/devotee identity)
-- =====================================================
CREATE TABLE customers (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  name          VARCHAR(255) NOT NULL,
  mobile        VARCHAR(15) NOT NULL,
  password_hash VARCHAR(255),
  first_login   BOOLEAN DEFAULT TRUE,
  otp_code      VARCHAR(6),
  otp_expires_at TIMESTAMP NULL,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_mobile (mobile)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Now add FK from users → customers
ALTER TABLE users
  ADD CONSTRAINT fk_users_linked_customer
  FOREIGN KEY (linked_customer_id) REFERENCES customers(id);

-- =====================================================
-- CUSTOMER STORE ACCESS  (multi-store devotee access)
-- =====================================================
CREATE TABLE customer_store_access (
  id               BIGINT PRIMARY KEY AUTO_INCREMENT,
  customer_id      BIGINT NOT NULL,
  store_id         BIGINT NOT NULL,
  account_number   VARCHAR(20) NOT NULL,
  is_primary_store BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_customer_store (customer_id, store_id),
  UNIQUE KEY uniq_store_account (store_id, account_number),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (store_id)    REFERENCES stores(id),
  INDEX idx_csa_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- STORE SETTINGS
-- =====================================================
CREATE TABLE store_settings (
  id                      BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id                BIGINT NOT NULL UNIQUE,
  receipt_prefix          VARCHAR(10) DEFAULT 'REC',
  challan_prefix          VARCHAR(10) DEFAULT 'CHL',
  auto_approve_cash       BOOLEAN DEFAULT FALSE,
  cash_approval_limit     DECIMAL(12,2) DEFAULT 0,
  razorpay_key_id         VARCHAR(255),
  razorpay_key_secret     VARCHAR(255),
  sms_enabled             BOOLEAN DEFAULT FALSE,
  email_enabled           BOOLEAN DEFAULT FALSE,
  locked_before_date      DATE NULL,
  enable_80g              BOOLEAN DEFAULT FALSE,
  auto_send_receipt_sms   BOOLEAN DEFAULT TRUE,
  auto_send_receipt_email BOOLEAN DEFAULT FALSE,
  FOREIGN KEY (store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- SUBSCRIPTIONS
-- =====================================================
CREATE TABLE subscriptions (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id    BIGINT NOT NULL UNIQUE,
  plan_type   ENUM('FREE','BASIC','STANDARD','PREMIUM','ENTERPRISE') DEFAULT 'FREE',
  status      ENUM('ACTIVE','EXPIRED','SUSPENDED','CANCELLED','TRIAL') DEFAULT 'TRIAL',
  start_date  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_date    TIMESTAMP NOT NULL,
  monthly_fee DECIMAL(10,2) DEFAULT 0.00,
  notes       TEXT,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  INDEX idx_sub_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- SYSTEM SETTINGS  (global, super-admin only)
-- =====================================================
CREATE TABLE system_settings (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  setting_key   VARCHAR(100) NOT NULL UNIQUE,
  setting_value TEXT,
  category      VARCHAR(50) NOT NULL,
  description   TEXT,
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- ROLES & PERMISSIONS  (RBAC, store-scoped)
-- =====================================================
CREATE TABLE roles (
  id       BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id BIGINT NULL,   -- NULL = global (SUPER_ADMIN)
  name     ENUM('SUPER_ADMIN','STORE_ADMIN','SUB_ADMIN','RECEIPT_MANAGER','CASHIER') NOT NULL,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  INDEX idx_roles_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permissions (
  id       BIGINT PRIMARY KEY AUTO_INCREMENT,
  resource VARCHAR(50) NOT NULL,
  action   VARCHAR(50) NOT NULL,
  UNIQUE KEY uniq_resource_action (resource, action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE role_permissions (
  role_id       BIGINT NOT NULL,
  permission_id BIGINT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  FOREIGN KEY (role_id)       REFERENCES roles(id),
  FOREIGN KEY (permission_id) REFERENCES permissions(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A user can hold DIFFERENT roles in DIFFERENT stores
CREATE TABLE user_roles (
  id       BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id  BIGINT NOT NULL,
  role_id  BIGINT NOT NULL,
  store_id BIGINT NOT NULL,
  UNIQUE KEY uniq_user_role_store (user_id, role_id, store_id),
  FOREIGN KEY (user_id)  REFERENCES users(id),
  FOREIGN KEY (role_id)  REFERENCES roles(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  INDEX idx_ur_user_store (user_id, store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- SUPPLIERS
-- =====================================================
CREATE TABLE suppliers (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id   BIGINT NOT NULL,
  name       VARCHAR(255) NOT NULL,
  mobile     VARCHAR(15),
  active     BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  INDEX idx_suppliers_store (store_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- PARTICULARS  (line-item master)
-- =====================================================
CREATE TABLE particulars (
  id         BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id   BIGINT NOT NULL,
  type       ENUM('RECEIPT','CHALLAN') NOT NULL,
  name       VARCHAR(255) NOT NULL,
  active     BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  INDEX idx_particulars_store_type (store_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- RECEIPTS  (income / donations)
-- =====================================================
CREATE TABLE receipts (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id       BIGINT NOT NULL,
  receipt_number VARCHAR(30) NOT NULL,
  customer_id    BIGINT NOT NULL,
  total_amount   DECIMAL(12,2) NOT NULL,
  payment_mode   ENUM('CASH','CHEQUE','ONLINE') NOT NULL,
  receipt_state  ENUM('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED') DEFAULT 'DRAFT',
  status         ENUM('UNPAID','PAID') DEFAULT 'UNPAID',
  cancel_reason  TEXT NULL,
  created_by     BIGINT NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_store_receipt_no (store_id, receipt_number),
  FOREIGN KEY (store_id)   REFERENCES stores(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_receipts_store_state (store_id, receipt_state),
  INDEX idx_receipts_store_created (store_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE receipt_particulars (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  receipt_id      BIGINT NOT NULL,
  particular_id   BIGINT NOT NULL,
  particular_name VARCHAR(255) NOT NULL,
  amount          DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (receipt_id)    REFERENCES receipts(id),
  FOREIGN KEY (particular_id) REFERENCES particulars(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE receipt_approvals (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  receipt_id  BIGINT NOT NULL,
  approved_by BIGINT NOT NULL,
  action      ENUM('APPROVED','REJECTED') NOT NULL,
  note        TEXT NULL,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (receipt_id)  REFERENCES receipts(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  INDEX idx_ra_receipt (receipt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- CHALLANS  (expenses / supplier payments)
-- =====================================================
CREATE TABLE challans (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id       BIGINT NOT NULL,
  challan_number VARCHAR(30) NOT NULL,
  supplier_id    BIGINT NOT NULL,
  total_amount   DECIMAL(12,2) NOT NULL,
  payment_mode   ENUM('CASH','CHEQUE','ONLINE') NOT NULL,
  status         ENUM('UNPAID','PAID','CANCELLED') DEFAULT 'UNPAID',
  cancel_reason  TEXT NULL,
  created_by     BIGINT NOT NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_store_challan_no (store_id, challan_number),
  FOREIGN KEY (store_id)   REFERENCES stores(id),
  FOREIGN KEY (supplier_id) REFERENCES suppliers(id),
  FOREIGN KEY (created_by) REFERENCES users(id),
  INDEX idx_challans_store (store_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE challan_particulars (
  id              BIGINT PRIMARY KEY AUTO_INCREMENT,
  challan_id      BIGINT NOT NULL,
  particular_id   BIGINT NOT NULL,
  particular_name VARCHAR(255) NOT NULL,
  amount          DECIMAL(12,2) NOT NULL,
  FOREIGN KEY (challan_id)    REFERENCES challans(id),
  FOREIGN KEY (particular_id) REFERENCES particulars(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- CHANGE REQUESTS  (core approval engine)
-- No direct UPDATE/DELETE on receipts/challans — ever.
-- =====================================================
CREATE TABLE change_requests (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id     BIGINT NOT NULL,
  entity_type  ENUM('RECEIPT','CHALLAN') NOT NULL,
  entity_id    BIGINT NOT NULL,
  action       ENUM('UPDATE','DELETE') NOT NULL,
  requested_by BIGINT NOT NULL,
  old_data     JSON NOT NULL,
  new_data     JSON NULL,
  reason       TEXT NOT NULL,
  status       ENUM('PENDING','APPROVED','REJECTED') DEFAULT 'PENDING',
  reviewed_by  BIGINT NULL,
  review_note  TEXT NULL,
  reviewed_at  TIMESTAMP NULL,
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id)     REFERENCES stores(id),
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (reviewed_by)  REFERENCES users(id),
  INDEX idx_cr_entity (entity_type, entity_id, status),
  INDEX idx_cr_store_status (store_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- TRANSACTIONS  (payment ledger)
-- =====================================================
CREATE TABLE transactions (
  id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id            BIGINT NOT NULL,
  type                ENUM('RECEIPT','CHALLAN','ONLINE_PAYMENT','REFUND') NOT NULL,
  reference_id        BIGINT,
  amount              DECIMAL(12,2) NOT NULL,
  payment_mode        ENUM('CASH','CHEQUE','ONLINE') NOT NULL,
  status              ENUM('INITIATED','SUCCESS','FAILED') DEFAULT 'INITIATED',
  gateway_order_id    VARCHAR(100) DEFAULT NULL,
  gateway_payment_id  VARCHAR(100) DEFAULT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  INDEX idx_txn_store (store_id, created_at),
  INDEX idx_txn_ref (type, reference_id),
  INDEX idx_txn_gateway (gateway_order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- NOTIFICATIONS
-- =====================================================
CREATE TABLE notifications (
  id             BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id        BIGINT NOT NULL,
  store_id       BIGINT NOT NULL,
  type           ENUM('INFO','SUCCESS','WARNING','RECEIPT_APPROVAL','PAYMENT_RECEIVED','CHANGE_REQUEST') NOT NULL,
  message        TEXT NOT NULL,
  reference_id   BIGINT NULL,
  reference_type VARCHAR(50) NULL,
  read_status    BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)  REFERENCES users(id),
  FOREIGN KEY (store_id) REFERENCES stores(id),
  INDEX idx_notif_user_store (user_id, store_id, read_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- NEWS & EVENTS
-- =====================================================
CREATE TABLE news_events (
  id                  BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id            BIGINT NOT NULL,
  type                ENUM('NEWS','EVENT','ANNOUNCEMENT') NOT NULL,
  title               VARCHAR(255) NOT NULL,
  content             TEXT,
  publish_date        DATE,
  priority            INT DEFAULT 0,
  active              BOOLEAN DEFAULT TRUE,
  created_by_user_id  BIGINT NOT NULL,
  created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id)           REFERENCES stores(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id),
  INDEX idx_ne_store (store_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- AUDIT LOGS
-- =====================================================
CREATE TABLE audit_logs (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id    BIGINT NULL,
  user_id     BIGINT NULL,
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id   BIGINT,
  details     JSON,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (store_id) REFERENCES stores(id),
  FOREIGN KEY (user_id)  REFERENCES users(id),
  INDEX idx_al_store (store_id, created_at),
  INDEX idx_al_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- RECEIPT SEQUENCES  (auto-numbering per store per year)
-- =====================================================
CREATE TABLE receipt_sequences (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id      BIGINT NOT NULL,
  year          INT NOT NULL,
  last_sequence BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_store_year (store_id, year),
  FOREIGN KEY (store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE challan_sequences (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  store_id      BIGINT NOT NULL,
  year          INT NOT NULL,
  last_sequence BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY uniq_store_year (store_id, year),
  FOREIGN KEY (store_id) REFERENCES stores(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================
-- =====================================================
-- FRESH SEED v2 — Super Admin only, permissions fixed
-- =====================================================

-- Super Admin user
INSERT INTO users (name, email, mobile, password_hash, first_login, active) VALUES
('Super Admin', 'daanoday@gmail.com', '8889400010', '$2b$10$aMveXWWhnMDcaTrYj5EFB.0WU.XaJ0QHT0c0KOt5Q34LKwPxEI7OW', FALSE, TRUE);

-- Super Admin role (global - no store)
INSERT INTO roles (id, store_id, name) VALUES (1, NULL, 'SUPER_ADMIN');

-- ALL permissions (matching exact resource:action used in routes)
INSERT INTO permissions (resource, action) VALUES
-- Users
('users','read'),('users','create'),('users','update'),('users','delete'),('users','manage'),
-- Roles
('roles','read'),('roles','manage'),
-- Customers
('customers','read'),('customers','create'),('customers','update'),('customers','delete'),('customers','manage'),
-- Suppliers
('suppliers','read'),('suppliers','create'),('suppliers','update'),('suppliers','delete'),('suppliers','manage'),
-- Particulars
('particulars','read'),('particulars','create'),('particulars','update'),('particulars','delete'),('particulars','manage'),
-- Receipts
('receipts','read'),('receipts','create'),('receipts','approve'),('receipts','change_request'),
-- Challans
('challans','read'),('challans','create'),('challans','approve'),
-- Change Requests
('change_requests','read'),('change_requests','approve'),
-- Transactions
('transactions','read'),
-- Reports
('reports','read'),('reports','export'),('reports','import'),
-- Dashboard
('dashboard','read'),
-- Store Settings
('store_settings','manage'),
-- Audit Logs
('audit_logs','read'),
-- News Events
('news_events','read'),('news_events','manage'),
-- Notifications
('notifications','read');

-- Assign ALL permissions to SUPER_ADMIN role
INSERT INTO role_permissions (role_id, permission_id) SELECT 1, id FROM permissions;

-- Assign SUPER_ADMIN to user id=1 (store_id NULL = global)
INSERT INTO user_roles (user_id, role_id, store_id) VALUES (1, 1, NULL);

-- System settings defaults
INSERT INTO system_settings (key_name, value, category, description) VALUES
('MAX_STORES_PER_PLAN','10','PLAN','Max stores allowed'),
('SUBSCRIPTION_GRACE_DAYS','7','PLAN','Grace period after expiry'),
('PAYMENT_GATEWAY_ENABLED','false','PAYMENT','Global payment gateway toggle'),
('SMS_GATEWAY_URL','','SMS','SMS gateway endpoint'),
('DEFAULT_RECEIPT_PREFIX','RCP','RECEIPT','Default receipt number prefix'),
('DEFAULT_CHALLAN_PREFIX','CHL','CHALLAN','Default challan number prefix');