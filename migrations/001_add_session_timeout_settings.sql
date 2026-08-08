-- Migration: Add store-configurable session timeout & inactivity lock settings
-- Safe/additive: only adds nullable columns, no data loss, no existing column changes.
-- No default duration is set on purpose — store admin must explicitly configure both
-- values from Settings; until configured, auto-logout/lock stay OFF for that store.
--
-- HOW TO RUN (production):
--   1. Take a full DB backup first:
--        mysqldump -u <user> -p <database_name> > backup_before_001.sql
--   2. Apply this migration:
--        mysql -u <user> -p <database_name> < 001_add_session_timeout_settings.sql
--   3. Verify columns exist:
--        DESCRIBE store_settings;

-- Requires MySQL 8.0.29+ for "ADD COLUMN IF NOT EXISTS". If your server is older,
-- drop the "IF NOT EXISTS" and run once (it will error harmlessly if re-run).
ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS session_timeout_minutes INT NULL,
  ADD COLUMN IF NOT EXISTS inactivity_lock_minutes INT NULL;
