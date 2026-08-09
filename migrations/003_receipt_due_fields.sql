-- Migration: due receipts support (receipt_date, payment_date, is_due, remarks)
-- and make payment_mode nullable for due (unpaid) receipts.
-- Run this manually on the LIVE database (phpMyAdmin / mysql CLI on Hostinger).
--
-- Safe to run even if some columns already exist — comment out any ADD COLUMN
-- line that errors with "Duplicate column name" and re-run the rest.

ALTER TABLE receipts
  MODIFY COLUMN payment_mode ENUM('CASH','CHEQUE','ONLINE') NULL DEFAULT NULL;

ALTER TABLE receipts
  ADD COLUMN receipt_date DATE NOT NULL DEFAULT (CURDATE()) AFTER payment_mode,
  ADD COLUMN payment_date DATE NULL AFTER receipt_date,
  ADD COLUMN is_due BOOLEAN DEFAULT FALSE AFTER payment_date,
  ADD COLUMN remarks TEXT NULL AFTER is_due;

-- Due receipts now insert a transaction row too (payment_mode unknown until paid),
-- so transactions.payment_mode must also allow NULL.
ALTER TABLE transactions
  MODIFY COLUMN payment_mode ENUM('CASH','CHEQUE','ONLINE') NULL DEFAULT NULL;
