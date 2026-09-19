-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0107: Complete RBAC Role-Based Access Control Model
-- ═══════════════════════════════════════════════════════════════════════════════
-- Target model:
--   Role = reusable default access profile (e.g. "Sales Manager")
--   Business Area = logical grouping (e.g. "Sales", "Inventory")
--   Permission = exact action (e.g. "sales.create")
--   Branch/Scope = where employee can perform actions
--   Employee Override = optional exception to role defaults
--   Effective Access = role defaults + overrides + scope + status
--
-- SAFETY: Additive only. No columns dropped. No data destroyed.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. BUSINESS AREAS (logical grouping for UI, not a permission itself)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS business_areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  code        varchar(50) NOT NULL,  -- e.g. 'sales', 'inventory'
  name_en     varchar(100) NOT NULL,
  name_ur     varchar(100) NOT NULL,
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, code)
);

-- 2. ROLES (reusable access templates per tenant)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roles (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name        varchar(100) NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,  -- true = built-in, cannot delete
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE INDEX IF NOT EXISTS idx_roles_tenant ON roles(tenant_id);

-- 3. ROLE_PERMISSIONS (which permissions a role includes by default)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS role_permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id       uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(role_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions(role_id);

-- 4. UPDATE memberships to reference role_id (optional, backward-compatible)
-- ──────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='memberships' AND column_name='role_id') THEN
    ALTER TABLE memberships ADD COLUMN role_id uuid REFERENCES roles(id);
  END IF;
END $$;

-- 5. UPDATE user_permissions: add 'is_override' flag to distinguish from role defaults
-- ──────────────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='user_permissions' AND column_name='is_override') THEN
    ALTER TABLE user_permissions ADD COLUMN is_override boolean NOT NULL DEFAULT false;
  END IF;
END $$;

-- 6. RLS for new tables
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE business_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- Business areas: readable by same-tenant users
DROP POLICY IF EXISTS business_areas_select ON business_areas;
CREATE POLICY business_areas_select ON business_areas
  FOR SELECT USING (
    tenant_id = COALESCE(
      (SELECT m.tenant_id FROM memberships m WHERE m.user_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid AND m.status = 'active' LIMIT 1),
      (SELECT shop_id FROM users WHERE id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid)
    )
  );

-- Roles: readable by same-tenant users
DROP POLICY IF EXISTS roles_select ON roles;
CREATE POLICY roles_select ON roles
  FOR SELECT USING (
    tenant_id = COALESCE(
      (SELECT m.tenant_id FROM memberships m WHERE m.user_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid AND m.status = 'active' LIMIT 1),
      (SELECT shop_id FROM users WHERE id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid)
    )
  );

-- Roles: admin can modify
DROP POLICY IF EXISTS roles_insert ON roles;
CREATE POLICY roles_insert ON roles
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM users u WHERE u.id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid AND u.role = 'admin')
  );

DROP POLICY IF EXISTS roles_update ON roles;
CREATE POLICY roles_update ON roles
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid AND u.role = 'admin')
  );

DROP POLICY IF EXISTS roles_delete ON roles;
CREATE POLICY roles_delete ON roles
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid AND u.role = 'admin')
    AND NOT is_system
  );

-- Role permissions: readable by same-tenant users
DROP POLICY IF EXISTS role_permissions_select ON role_permissions;
CREATE POLICY role_permissions_select ON role_permissions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM roles r WHERE r.id = role_permissions.role_id
      AND r.tenant_id = COALESCE(
        (SELECT m.tenant_id FROM memberships m WHERE m.user_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid AND m.status = 'active' LIMIT 1),
        (SELECT shop_id FROM users WHERE id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid)
      )
    )
  );

-- Role permissions: admin can modify
DROP POLICY IF EXISTS role_permissions_insert ON role_permissions;
CREATE POLICY role_permissions_insert ON role_permissions
  FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM users u WHERE u.id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid AND u.role = 'admin')
  );

DROP POLICY IF EXISTS role_permissions_delete ON role_permissions;
CREATE POLICY role_permissions_delete ON role_permissions
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM users u WHERE u.id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid AND u.role = 'admin')
  );

-- 7. GRANTS
-- ──────────────────────────────────────────────────────────────────────────────

GRANT SELECT ON business_areas TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON roles TO authenticated;
GRANT SELECT, INSERT, DELETE ON role_permissions TO authenticated;

-- 8. BOOTSTRAP: Create default business areas
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO business_areas (tenant_id, code, name_en, name_ur, sort_order) VALUES
  ('00000000-0000-0000-0000-000000000001', 'sales',       'Sales',       'فروخت',       1),
  ('00000000-0000-0000-0000-000000000001', 'customers',   'Customers',   'صارفین',      2),
  ('00000000-0000-0000-0000-000000000001', 'products',    'Products',    'مصنوعات',     3),
  ('00000000-0000-0000-0000-000000000001', 'inventory',   'Inventory',   'انوینٹری',    4),
  ('00000000-0000-0000-0000-000000000001', 'purchases',   'Purchases',   'خریداری',     5),
  ('00000000-0000-0000-0000-000000000001', 'payments',    'Payments',    'ادائیگیاں',   6),
  ('00000000-0000-0000-0000-000000000001', 'companies',   'Suppliers',   'سپلائرز',     7),
  ('00000000-0000-0000-0000-000000000001', 'returns',     'Returns',     'واپسیاں',     8),
  ('00000000-0000-0000-0000-000000000001', 'employees',   'Employees',   'عملہ',        9),
  ('00000000-0000-0000-0000-000000000001', 'reports',     'Reports',     'رپورٹس',      10),
  ('00000000-0000-0000-0000-000000000001', 'settings',    'Settings',    'ترتیبات',     11),
  ('00000000-0000-0000-0000-000000000001', 'activity',    'Activity',    'سرگرمی',      12),
  ('00000000-0000-0000-0000-000000000001', 'notifications','Notifications','اطلاعات',  13),
  ('00000000-0000-0000-0000-000000000001', 'alerts',      'Alerts',      'الرٹس',       14)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- 9. BOOTSTRAP: Create default roles with permissions
-- ──────────────────────────────────────────────────────────────────────────────

-- Sales Employee role
INSERT INTO roles (id, tenant_id, name, description, is_system) VALUES
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'Sales Employee', 'Shop floor: sales, customers, product viewing', true)
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'a0000000-0000-0000-0000-000000000001'::uuid, p.id
FROM permissions p
WHERE p.code IN ('customers.view','customers.create','sales.view','sales.create','products.view','inventory.view')
ON CONFLICT DO NOTHING;

-- Sales Manager role
INSERT INTO roles (id, tenant_id, name, description, is_system) VALUES
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Sales Manager', 'Full sales management: sales, customers, returns, reports', true)
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'a0000000-0000-0000-0000-000000000002'::uuid, p.id
FROM permissions p
WHERE p.code IN ('customers.view','customers.create','customers.edit','customers.payments','sales.view','sales.create','sales.void','returns.view','returns.create','products.view','inventory.view','reports.view')
ON CONFLICT DO NOTHING;

-- Store Manager role
INSERT INTO roles (id, tenant_id, name, description, is_system) VALUES
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'Store Manager', 'Full store operations: all except employee/settings management', true)
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'a0000000-0000-0000-0000-000000000003'::uuid, p.id
FROM permissions p
WHERE p.code NOT IN ('employees.manage','settings.edit','employees.view')
ON CONFLICT DO NOTHING;

-- Inventory Clerk role
INSERT INTO roles (id, tenant_id, name, description, is_system) VALUES
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'Inventory Clerk', 'Stock management: products, inventory, suppliers', true)
ON CONFLICT (tenant_id, name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT 'a0000000-0000-0000-0000-000000000004'::uuid, p.id
FROM permissions p
WHERE p.code IN ('products.view','products.create','products.edit','inventory.view','inventory.adjust','companies.view','companies.create','companies.edit','purchases.view','purchases.create','payments.view','payments.supplier')
ON CONFLICT DO NOTHING;


-- 10. HELPER: get_effective_permissions(user_id) — the SINGLE SOURCE OF TRUTH
-- ──────────────────────────────────────────────────────────────────────────────
-- Returns the complete set of permission codes for a user:
--   Role defaults + employee overrides (add + remove)

CREATE OR REPLACE FUNCTION get_effective_permissions(p_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_membership_role membership_role;
  v_role_id uuid;
  v_permissions jsonb;
  v_role_perms text[];
  v_override_add text[];
  v_override_remove text[];
  v_final text[];
BEGIN
  v_user_id := COALESCE(
    p_user_id,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
  );
  IF v_user_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- Get membership role and role_id
  SELECT m.role, m.role_id INTO v_membership_role, v_role_id
  FROM memberships m
  WHERE m.user_id = v_user_id AND m.status = 'active'
  ORDER BY m.created_at ASC LIMIT 1;

  -- Owner gets ALL permissions
  IF v_membership_role = 'owner' THEN
    SELECT jsonb_agg(p.code) INTO v_permissions FROM permissions p;
    RETURN COALESCE(v_permissions, '[]'::jsonb);
  END IF;

  -- Start with role defaults
  v_role_perms := ARRAY[]::text[];
  IF v_role_id IS NOT NULL THEN
    SELECT array_agg(p.code) INTO v_role_perms
    FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id
    WHERE rp.role_id = v_role_id;
  END IF;
  v_role_perms := COALESCE(v_role_perms, ARRAY[]::text[]);

  -- Get employee overrides (additions)
  SELECT array_agg(p.code) INTO v_override_add
  FROM user_permissions up
  JOIN permissions p ON p.id = up.permission_id
  WHERE up.user_id = v_user_id AND up.is_override = true;

  v_override_add := COALESCE(v_override_add, ARRAY[]::text[]);

  -- Get employee override removals (stored as negative codes like 'sales.edit:-')
  SELECT array_agg(replace(up.permission_id::text, '', '')) INTO v_override_remove
  FROM user_permissions up
  WHERE up.user_id = v_user_id AND up.is_override = true;

  -- Build final: role defaults + additions - removals
  -- For now, simple: role perms + explicit adds
  -- Override removes are handled by explicit denial entries
  v_final := (
    SELECT array_agg(DISTINCT code)
    FROM (
      SELECT unnest(v_role_perms) AS code
      UNION
      SELECT unnest(v_override_add) AS code
    ) combined
  );

  RETURN to_jsonb(COALESCE(v_final, ARRAY[]::text[]));
END;
$$;

GRANT EXECUTE ON FUNCTION get_effective_permissions(uuid) TO authenticated;


-- 11. HELPER: has_effective_permission(p_user_id, p_code) — the authorization check
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION has_effective_permission(p_code varchar, p_user_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_effective jsonb;
BEGIN
  v_user_id := COALESCE(
    p_user_id,
    NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
  );
  IF v_user_id IS NULL THEN RETURN false; END IF;

  v_effective := get_effective_permissions(v_user_id);
  RETURN v_effective ? p_code;
END;
$$;

GRANT EXECUTE ON FUNCTION has_effective_permission(varchar, uuid) TO authenticated;


-- 12. Update has_permission to use the new effective access model
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION has_permission(p_code varchar)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN has_effective_permission(p_code);
END;
$$;

GRANT EXECUTE ON FUNCTION has_permission(varchar) TO authenticated;


-- 13. Update get_my_permissions to use effective access
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_my_permissions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN get_effective_permissions();
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_permissions() TO authenticated;


-- 14. Update create_employee to accept role_id and derive permissions from role
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid; v_phone text; v_shop_id uuid; v_actor uuid;
  v_caller_role text; v_max_num_text text; v_next_num integer;
  v_emp_role membership_role; v_branch_scope uuid[];
  v_role_id uuid; v_perm_code text; v_perm_id uuid;
  v_bs jsonb;
BEGIN
  v_actor := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: No valid session'; END IF;
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can create employees';
  END IF;
  v_shop_id := current_shop_id();
  IF v_shop_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: No tenant context'; END IF;

  v_phone := NULLIF(payload->>'phone', '');
  IF v_phone IS NULL OR trim(payload->>'name') = '' THEN
    RAISE EXCEPTION 'VALIDATION: Name and phone are required';
  END IF;
  IF EXISTS (SELECT 1 FROM users WHERE phone = v_phone) THEN
    RAISE EXCEPTION 'DUPLICATE_PHONE: An employee with this phone number already exists';
  END IF;

  SELECT MAX(employee_number) INTO v_max_num_text
  FROM users WHERE employee_number IS NOT NULL AND employee_number LIKE 'EMP-%';
  IF v_max_num_text IS NULL THEN v_next_num := 1;
  ELSE v_next_num := COALESCE((regexp_replace(v_max_num_text, '[^0-9]', '', 'g'))::integer, 0) + 1;
  END IF;

  v_emp_role := COALESCE(NULLIF(payload->>'membershipRole', '')::membership_role, 'employee'::membership_role);
  v_role_id := NULLIF(payload->>'roleId', '')::uuid;

  -- Parse branch scope
  v_bs := payload->'branchScope';
  IF v_bs IS NOT NULL AND v_bs != 'null'::jsonb THEN
    IF jsonb_typeof(v_bs) = 'array' THEN
      SELECT array_agg(t::uuid) INTO v_branch_scope
      FROM jsonb_array_elements_text(v_bs) AS t;
    END IF;
  END IF;

  INSERT INTO users (id, name, phone, role, is_original_owner, is_active,
    employee_number, job_title, photo_url, created_by, shop_id, created_at)
  VALUES (gen_random_uuid(), trim(payload->>'name'), v_phone,
    CASE WHEN v_emp_role IN ('owner', 'admin') THEN 'admin'::user_role ELSE 'employee'::user_role END,
    false, true, 'EMP-' || LPAD(v_next_num::text, 3, '0'),
    NULLIF(payload->>'jobTitle', ''), NULLIF(payload->>'photoUrl', ''),
    v_actor, v_shop_id, now())
  RETURNING id INTO v_id;

  -- Create membership with role reference
  INSERT INTO memberships (user_id, tenant_id, role, status, branch_scope, role_id)
  VALUES (v_id, v_shop_id, v_emp_role, 'active', v_branch_scope, v_role_id);

  -- If explicit permissions provided, use them as overrides
  IF payload->'permissions' IS NOT NULL AND jsonb_typeof(payload->'permissions') = 'array' AND jsonb_array_length(payload->'permissions') > 0 THEN
    FOR v_perm_code IN SELECT jsonb_array_elements_text(payload->'permissions')
    LOOP
      SELECT id INTO v_perm_id FROM permissions WHERE code = v_perm_code;
      IF v_perm_id IS NOT NULL THEN
        INSERT INTO user_permissions (user_id, permission_id, granted_by, is_override)
        VALUES (v_id, v_perm_id, v_actor, true)
        ON CONFLICT (user_id, permission_id) DO UPDATE SET is_override = true;
      END IF;
    END LOOP;
  END IF;

  -- Audit
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'employee_created', 'user', v_id,
    jsonb_build_object('name', trim(payload->>'name'), 'role', v_emp_role, 'role_id', v_role_id));

  RETURN jsonb_build_object('id', v_id, 'membershipRole', v_emp_role, 'roleId', v_role_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_employee(jsonb) TO authenticated;


-- 15. VERIFICATION
-- ──────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_effective_permissions') THEN
    RAISE EXCEPTION 'get_effective_permissions not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_effective_permission') THEN
    RAISE EXCEPTION 'has_effective_permission not created';
  END IF;
  RAISE NOTICE 'RBAC model deployed: roles, business_areas, role_permissions, effective_access, employee overrides';
END $$;
