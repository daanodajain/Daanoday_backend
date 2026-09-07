-- rejectChallan() sets `status = 'REJECTED'`, but challans.status was
-- ENUM('UNPAID','PAID','CANCELLED') — no 'REJECTED' value — so rejecting a
-- challan throws a SQL error and rolls back (strict mode) or silently
-- corrupts the value (non-strict mode). This was fixed on the wrong table
-- in a previous pass (notifications.type got 'REJECTED' added instead).
--
-- Also: challanService.js reads/writes `challan_state` on every challan
-- action (approve/reject/markPaid), but this column was only ever added to
-- database.sql directly — no migration shipped it for databases that were
-- already running, so every challan API call fails with
-- "Unknown column 'challan_state'" until this runs.
--
-- Fresh installs get both from database.sql already; run this on any
-- existing database:
--   mysqldump -u <user> -p <db_name> > backup_before_007.sql
--   mysql -u <user> -p <db_name> < 007_challan_status_rejected.sql

ALTER TABLE challans
  ADD COLUMN IF NOT EXISTS challan_state ENUM('PENDING_APPROVAL','APPROVED','REJECTED','CANCELLED') DEFAULT 'APPROVED' AFTER payment_mode;

ALTER TABLE challans
  MODIFY COLUMN status ENUM('UNPAID','PAID','CANCELLED','REJECTED') DEFAULT 'UNPAID';
