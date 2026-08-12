-- Partial payment support.
-- Run this AFTER 002 and 003.
--
-- HOW TO RUN (production):
--   1. Backup first: mysqldump -u <user> -p <db_name> > backup_before_004.sql
--   2. Apply:         mysql -u <user> -p <db_name> < 004_partial_payment.sql

-- 1. receipts: track how much has actually been paid so far, and allow a
--    PARTIAL status between UNPAID and PAID.
ALTER TABLE receipts
  ADD COLUMN paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total_amount,
  MODIFY COLUMN status ENUM('UNPAID','PARTIAL','PAID') DEFAULT 'UNPAID';

-- Backfill: any receipt already marked PAID has paid_amount = total_amount.
UPDATE receipts SET paid_amount = total_amount WHERE status = 'PAID';

-- 2. receipt_particulars: track paid amount per line item (particular-level
--    partial tracking, e.g. Daan partially paid, Prasad fully paid).
ALTER TABLE receipt_particulars
  ADD COLUMN paid_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER amount;

-- Backfill: for receipts already fully PAID, mark every particular as fully paid.
UPDATE receipt_particulars rp
JOIN receipts r ON r.id = rp.receipt_id
SET rp.paid_amount = rp.amount
WHERE r.status = 'PAID';
