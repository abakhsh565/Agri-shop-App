-- 0110: compatibility backfill for users created before memberships
-- No business rows are changed.

-- Owners do not use an employee role template.
UPDATE memberships
SET role_id = NULL
WHERE role = 'owner';

-- Legacy profiles receive one active membership in their existing shop.
INSERT INTO memberships(user_id, tenant_id, role, status, branch_scope, role_id)
SELECT u.id, u.shop_id,
  CASE WHEN u.is_original_owner THEN 'owner'::membership_role
       WHEN u.role = 'admin' THEN 'admin'::membership_role
       ELSE 'employee'::membership_role END,
  CASE WHEN u.is_active THEN 'active'::membership_status ELSE 'suspended'::membership_status END,
  NULL,
  CASE WHEN u.is_original_owner THEN NULL
       WHEN u.role = 'admin' THEN (SELECT r.id FROM roles r WHERE r.tenant_id=u.shop_id AND r.name='Store Manager' LIMIT 1)
       ELSE (SELECT r.id FROM roles r WHERE r.tenant_id=u.shop_id AND r.name='Sales Employee' LIMIT 1) END
FROM users u
WHERE u.shop_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.tenant_id=u.shop_id);

-- Correct any accidental owner template assignment after the insert.
UPDATE memberships SET role_id=NULL WHERE role='owner';
