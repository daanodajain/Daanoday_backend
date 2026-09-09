-- Migration 009: Profile page support (avatar, OTP-verified contact change)
--
-- Note: `users.otp_code` / `otp_expires_at` and `customers.email` were
-- already added by migration 006 (006_missing_columns.sql). This adds the
-- remaining pieces needed for the profile pages: avatar photos, and a
-- staging area for a mobile/email change that hasn't been OTP-verified yet.
--
-- pending_mobile / pending_email — holding area for a mobile/email change
-- until the OTP sent to the NEW value is verified. The live mobile/email
-- column is only updated after successful verification, so a wrong or
-- unreachable new number/address never locks anyone out.

ALTER TABLE users
  ADD COLUMN avatar_url     VARCHAR(500)  NULL,
  ADD COLUMN pending_mobile VARCHAR(15)   NULL,
  ADD COLUMN pending_email  VARCHAR(255)  NULL;

ALTER TABLE customers
  ADD COLUMN avatar_url     VARCHAR(500)  NULL,
  ADD COLUMN pending_mobile VARCHAR(15)   NULL,
  ADD COLUMN pending_email  VARCHAR(255)  NULL;

