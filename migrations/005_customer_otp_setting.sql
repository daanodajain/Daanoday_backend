-- Migration 005: Add Customer OTP Login setting
-- Controls whether first-time customers must verify OTP before setting password

INSERT INTO system_settings (setting_key, setting_value, category, description)
VALUES (
  'CUSTOMER_OTP_LOGIN_ENABLED',
  'true',
  'CUSTOMER',
  'When ON: first-login customer must verify OTP before setting password. When OFF: customer directly sets password without OTP.'
)
ON DUPLICATE KEY UPDATE setting_value = setting_value; -- don't overwrite if already set
