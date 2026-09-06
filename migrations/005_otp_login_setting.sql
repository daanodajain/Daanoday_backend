-- Migration 005: Global OTP Login setting (replaces CUSTOMER_OTP_LOGIN_ENABLED)
-- Applies to ALL users (staff, store admin, customer) on first login
-- Default: false (direct password set, no OTP)

-- Remove old customer-specific key if it exists
DELETE FROM system_settings WHERE setting_key = 'CUSTOMER_OTP_LOGIN_ENABLED';

-- Insert/update global OTP setting
INSERT INTO system_settings (setting_key, setting_value, category, description)
VALUES (
  'OTP_LOGIN_ENABLED',
  'false',
  'SECURITY',
  'When ON: all users must verify OTP on first login before setting password. When OFF: directly set password without OTP.'
)
ON DUPLICATE KEY UPDATE
  setting_value = VALUES(setting_value),
  category = VALUES(category),
  description = VALUES(description);
