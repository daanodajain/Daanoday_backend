-- Fix: roles.name was ENUM('SUPER_ADMIN','STORE_ADMIN','SUB_ADMIN','RECEIPT_MANAGER','CASHIER'),
-- which silently truncates any custom role name to '' on non-strict MySQL (Hostinger default).
-- This backfills any already-blanked rows, then widens the column to VARCHAR.

-- 1. Backfill rows that already got silently blanked (best-effort — cannot recover the
--    original intended name, so mark them so store admins can rename via UI).
UPDATE roles SET name = CONCAT('UNNAMED_ROLE_', id) WHERE name = '' OR name IS NULL;

-- 2. Widen the column so any custom role name can be stored.
ALTER TABLE roles MODIFY COLUMN name VARCHAR(50) NOT NULL;

-- 3. (Recommended) Force strict SQL mode at the connection level too, so this class of
--    bug (silent truncation) can never happen again even if some other ENUM/size mismatch
--    slips through in future. Add this in src/config/db.js pool options instead of here:
--    sql_mode: 'STRICT_TRANS_TABLES'  -- via connection init or SET SESSION on each connection
