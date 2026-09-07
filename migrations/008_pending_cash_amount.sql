-- Supports the customer-portal "Pay by Cash" flow: a customer can claim
-- they already paid a staff member in cash (in person), which should NEVER
-- directly mark the receipt paid — only a staff/admin approver confirming
-- they actually received that cash should do that. This column holds the
-- customer's claimed amount while receipt_state = 'PENDING_APPROVAL',
-- until approve-cash-request/reject-cash-request resolves it.
--
--   mysqldump -u <user> -p <db_name> > backup_before_008.sql
--   mysql -u <user> -p <db_name> < 008_pending_cash_amount.sql

ALTER TABLE receipts
  ADD COLUMN IF NOT EXISTS pending_cash_amount DECIMAL(12,2) NULL AFTER status;
