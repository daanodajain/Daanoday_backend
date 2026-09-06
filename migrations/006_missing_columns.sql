-- Add receipt template and header text columns to store_settings
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS receipt_template VARCHAR(20) DEFAULT 'DEFAULT',
  ADD COLUMN IF NOT EXISTS receipt_header_text VARCHAR(500) DEFAULT NULL;

-- Add otp_code and otp_expires_at to users table (for staff first-login OTP flow)
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS otp_code VARCHAR(6) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP NULL DEFAULT NULL;

-- Add email column to customers table (for email-based login)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email VARCHAR(255) DEFAULT NULL,
  ADD UNIQUE INDEX IF NOT EXISTS uniq_customer_email (email);
