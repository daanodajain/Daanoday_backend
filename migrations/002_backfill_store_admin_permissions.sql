-- CRITICAL migration — this is very likely the root cause of most of the
-- reported bugs: supplier create failing, reports not loading, notifications
-- not working, audit log not working, change-request approve/reject failing.
--
-- WHY: an earlier fix (commit 3464513) added many new permissions
-- (create/update/delete/approve/change_request actions) to the seed data,
-- but that seed only runs on a FRESH install. Any store created BEFORE that
-- fix has a STORE_ADMIN role whose role_permissions were never backfilled —
-- so on live, those admins are silently missing permissions like
-- suppliers:create, reports:read, notifications:read, audit_logs:read,
-- change_requests:approve, etc., even though the permission now exists in
-- the catalog. Every protected route just returns 403/empty for them.
--
-- WHAT THIS DOES (safe, additive, idempotent — can be re-run safely):
--   1. Ensures the full permissions catalog exists (INSERT IGNORE — skips
--      any permission that already exists, adds only what's missing).
--   2. For every EXISTING store-scoped STORE_ADMIN role, grants any
--      permission it doesn't already have, EXCEPT stores/subscriptions/
--      system_settings (matching the same rule used when creating a new
--      store admin in storeService.js).
--   3. Does NOT touch SUPER_ADMIN or any other custom/sub-admin roles —
--      only the STORE_ADMIN role per store, since that's the role that
--      silently lost these permissions.
--
-- HOW TO RUN (production):
--   1. Backup first:  mysqldump -u <user> -p <database_name> > backup_before_002.sql
--   2. Apply:          mysql -u <user> -p <database_name> < 002_backfill_store_admin_permissions.sql
--   3. Spot-check one store admin's permission count before/after:
--        SELECT r.id, r.store_id, COUNT(*) FROM roles r
--        JOIN role_permissions rp ON rp.role_id = r.id
--        WHERE r.name = 'STORE_ADMIN' GROUP BY r.id;

-- 1. Ensure full permissions catalog (safe no-op for ones that already exist)
INSERT IGNORE INTO permissions (resource, action) VALUES
('users','read'),('users','create'),('users','update'),('users','delete'),('users','manage'),
('roles','read'),('roles','manage'),
('customers','read'),('customers','create'),('customers','update'),('customers','delete'),('customers','manage'),
('suppliers','read'),('suppliers','create'),('suppliers','update'),('suppliers','delete'),('suppliers','manage'),
('particulars','read'),('particulars','create'),('particulars','update'),('particulars','delete'),('particulars','manage'),
('receipts','read'),('receipts','create'),('receipts','approve'),('receipts','change_request'),
('challans','read'),('challans','create'),('challans','approve'),
('change_requests','read'),('change_requests','approve'),
('transactions','read'),
('reports','read'),('reports','export'),('reports','import'),
('dashboard','read'),
('store_settings','manage'),
('audit_logs','read'),
('news_events','read'),('news_events','manage'),
('notifications','read');

-- 2. Backfill: grant every existing store-scoped STORE_ADMIN role any
--    permission (outside the reserved resources) it doesn't already have.
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p
  ON p.resource NOT IN ('stores', 'subscriptions', 'system_settings')
WHERE r.name = 'STORE_ADMIN'
  AND r.store_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );
