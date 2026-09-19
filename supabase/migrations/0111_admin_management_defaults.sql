-- 0111: built-in admin management defaults
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id
FROM roles r CROSS JOIN permissions p
WHERE r.name='Store Manager'
  AND p.code IN ('employees.view','employees.manage','settings.view','settings.edit')
ON CONFLICT DO NOTHING;
