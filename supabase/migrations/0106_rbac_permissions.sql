-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0106: RBAC Permissions Foundation
-- ═══════════════════════════════════════════════════════════════════════════════
-- Adds granular permission system on top of the existing membership/role model.
--
-- Permission hierarchy:
--   owner  → ALL permissions (implicit, no user_permissions rows needed)
--   admin  → subset assigned via user_permissions (or ALL if no rows = admin defaults)
--   employee → subset assigned via user_permissions (or NONE if no rows)
--
-- Design: additive-only. No columns dropped. No data destroyed.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. PERMISSIONS TABLE
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS permissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        varchar(100) NOT NULL UNIQUE,  -- e.g. 'customers.view', 'sales.create'
  module      varchar(50) NOT NULL,          -- e.g. 'customers', 'sales', 'inventory'
  action      varchar(50) NOT NULL,          -- e.g. 'view', 'create', 'edit', 'delete'
  label_en    varchar(200) NOT NULL,         -- human-readable English label
  label_ur    varchar(200) NOT NULL,         -- human-readable Urdu label
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_permissions_module ON permissions(module);

-- 2. USER_PERMISSIONS JUNCTION TABLE
-- ──────────────────────────────────────────────────────────────────────────────
-- Only used for admin/employee roles. Owners have ALL permissions implicitly.

CREATE TABLE IF NOT EXISTS user_permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  granted_by    uuid REFERENCES users(id),
  granted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, permission_id)
);

CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);

-- 3. SEED PERMISSIONS (real existing application actions)
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO permissions (code, module, action, label_en, label_ur) VALUES
  -- Customers
  ('customers.view',    'customers',  'view',    'View Customers',          'صارفین دیکھیں'),
  ('customers.create',  'customers',  'create',  'Create Customers',        'صارفین بنائیں'),
  ('customers.edit',    'customers',  'edit',    'Edit Customers',          'صارفین میں ترمیم کریں'),
  ('customers.delete',  'customers',  'delete',  'Delete/Archive Customers', 'صارفین حذف کریں'),
  ('customers.payments','customers',  'payments','Record Customer Payments', 'صارفین کی ادائیگیاں درج کریں'),
  -- Products
  ('products.view',     'products',   'view',    'View Products',           'مصنوعات دیکھیں'),
  ('products.create',   'products',   'create',  'Create Products',         'مصنوعات بنائیں'),
  ('products.edit',     'products',   'edit',    'Edit Products',           'مصنوعات میں ترمیم کریں'),
  ('products.delete',   'products',   'delete',  'Delete Products',         'مصنوعات حذف کریں'),
  -- Sales
  ('sales.view',        'sales',      'view',    'View Sales',              'فروخت دیکھیں'),
  ('sales.create',      'sales',      'create',  'Create Sales',            'فروخت بنائیں'),
  ('sales.void',        'sales',      'void',    'Void Sales',              'فروخت منسوخ کریں'),
  -- Returns
  ('returns.view',      'returns',    'view',    'View Returns',            'واپسیاں دیکھیں'),
  ('returns.create',    'returns',    'create',  'Process Returns',         'واپسیاں کریں'),
  -- Purchases
  ('purchases.view',    'purchases',  'view',    'View Purchases',          'خریداری دیکھیں'),
  ('purchases.create',  'purchases',  'create',  'Create Purchases',        'خریداری بنائیں'),
  -- Payments (supplier)
  ('payments.view',     'payments',   'view',    'View Payments',           'ادائیگیاں دیکھیں'),
  ('payments.supplier', 'payments',   'supplier','Record Supplier Payments', 'سپلائر ادائیگیاں درج کریں'),
  -- Inventory
  ('inventory.view',    'inventory',  'view',    'View Inventory',          'انوینٹری دیکھیں'),
  ('inventory.adjust',  'inventory',  'adjust',  'Adjust Stock',            'اسٹاک ایڈجسٹ کریں'),
  -- Companies/Suppliers
  ('companies.view',    'companies',  'view',    'View Suppliers',          'سپلائرز دیکھیں'),
  ('companies.create',  'companies',  'create',  'Create Suppliers',        'سپلائرز بنائیں'),
  ('companies.edit',    'companies',  'edit',    'Edit Suppliers',          'سپلائرز میں ترمیم کریں'),
  -- Reports
  ('reports.view',      'reports',    'view',    'View Reports',            'رپورٹس دیکھیں'),
  -- Employees
  ('employees.view',    'employees',  'view',    'View Employees',          'عملہ دیکھیں'),
  ('employees.manage',  'employees',  'manage',  'Manage Employees',        'عملہ میں ترمیم کریں'),
  -- Settings
  ('settings.view',     'settings',   'view',    'View Settings',           'ترتیبات دیکھیں'),
  ('settings.edit',     'settings',   'edit',    'Edit Settings',           'ترتیبات میں ترمیم کریں'),
  -- Activity / Notifications
  ('activity.view',     'activity',   'view',    'View Activity Log',       'سرگرمی لاگ دیکھیں'),
  ('notifications.view','notifications','view',  'View Notifications',      'اطلاعات دیکھیں'),
  -- Action Center
  ('alerts.view',       'alerts',     'view',    'View Action Center',      'ایکشن سینٹر دیکھیں'),
  ('alerts.manage',     'alerts',     'manage',  'Manage Alerts',           'الرٹس میں ترمیم کریں')
ON CONFLICT (code) DO NOTHING;

-- 4. RLS
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_permissions ENABLE ROW LEVEL SECURITY;

-- Permissions are readable by all authenticated users (for UI rendering)
DROP POLICY IF EXISTS permissions_select ON permissions;
CREATE POLICY permissions_select ON permissions
  FOR SELECT USING (true);

-- User permissions: readable by owner/admin of same tenant, or self
DROP POLICY IF EXISTS user_permissions_select ON user_permissions;
CREATE POLICY user_permissions_select ON user_permissions
  FOR SELECT USING (
    user_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
    OR EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
        AND u.role = 'admin'
        AND u.shop_id = (SELECT shop_id FROM users WHERE id = user_permissions.user_id)
    )
  );

-- Only admins can modify user_permissions
DROP POLICY IF EXISTS user_permissions_insert ON user_permissions;
CREATE POLICY user_permissions_insert ON user_permissions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
        AND u.role = 'admin'
    )
  );

DROP POLICY IF EXISTS user_permissions_delete ON user_permissions;
CREATE POLICY user_permissions_delete ON user_permissions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM users u
      WHERE u.id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid
        AND u.role = 'admin'
    )
  );

-- 5. GRANTS
-- ──────────────────────────────────────────────────────────────────────────────

GRANT SELECT ON permissions TO authenticated;
GRANT SELECT, INSERT, DELETE ON user_permissions TO authenticated;

-- 6. HELPER: does the current user have a specific permission?
-- ──────────────────────────────────────────────────────────────────────────────
-- Owner always has all permissions. Admin/employee checked against user_permissions.

CREATE OR REPLACE FUNCTION has_permission(p_code varchar)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_membership_role membership_role;
  v_has_permission boolean;
BEGIN
  v_user_id := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
  IF v_user_id IS NULL THEN RETURN false; END IF;

  -- Get membership role
  SELECT m.role INTO v_membership_role
  FROM memberships m
  WHERE m.user_id = v_user_id AND m.status = 'active'
  ORDER BY m.created_at ASC LIMIT 1;

  -- Owner has ALL permissions implicitly
  IF v_membership_role = 'owner' THEN RETURN true; END IF;

  -- Check explicit permission grant
  SELECT EXISTS (
    SELECT 1 FROM user_permissions up
    JOIN permissions p ON p.id = up.permission_id
    WHERE up.user_id = v_user_id AND p.code = p_code
  ) INTO v_has_permission;

  RETURN v_has_permission;
END;
$$;

GRANT EXECUTE ON FUNCTION has_permission(varchar) TO authenticated;

-- 7. HELPER: get all permissions for the current user (for frontend)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION get_my_permissions()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_membership_role membership_role;
  v_permissions jsonb;
BEGIN
  v_user_id := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
  IF v_user_id IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- Get membership role
  SELECT m.role INTO v_membership_role
  FROM memberships m
  WHERE m.user_id = v_user_id AND m.status = 'active'
  ORDER BY m.created_at ASC LIMIT 1;

  -- Owner gets all permission codes
  IF v_membership_role = 'owner' THEN
    SELECT jsonb_agg(p.code) INTO v_permissions FROM permissions p;
    RETURN COALESCE(v_permissions, '[]'::jsonb);
  END IF;

  -- Admin/employee: get explicit grants
  SELECT jsonb_agg(p.code) INTO v_permissions
  FROM user_permissions up
  JOIN permissions p ON p.id = up.permission_id
  WHERE up.user_id = v_user_id;

  RETURN COALESCE(v_permissions, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION get_my_permissions() TO authenticated;


-- 8. UPDATE create_employee to accept membership_role parameter
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_phone text;
  v_shop_id uuid;
  v_actor uuid;
  v_caller_role text;
  v_max_num_text text;
  v_next_num integer;
  v_emp_role membership_role;
  v_branch_scope uuid[];
  v_perm_code text;
  v_perm_id uuid;
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

  -- Get next employee number
  SELECT MAX(employee_number) INTO v_max_num_text
  FROM users WHERE employee_number IS NOT NULL AND employee_number LIKE 'EMP-%';
  IF v_max_num_text IS NULL THEN
    v_next_num := 1;
  ELSE
    v_next_num := COALESCE((regexp_replace(v_max_num_text, '[^0-9]', '', 'g'))::integer, 0) + 1;
  END IF;

  -- Determine membership role (default: employee)
  v_emp_role := COALESCE(
    NULLIF(payload->>'membershipRole', '')::membership_role,
    'employee'::membership_role
  );

  -- Parse branch scope
  IF payload->>'branchScope' IS NOT NULL AND payload->>'branchScope' != '' THEN
    SELECT array_agg(t::uuid) INTO v_branch_scope
    FROM jsonb_array_elements_text(payload->'branchScope') AS t;
  END IF;

  INSERT INTO users (
    id, name, phone, role, is_original_owner, is_active,
    employee_number, job_title, photo_url, created_by, shop_id, created_at
  ) VALUES (
    gen_random_uuid(), trim(payload->>'name'), v_phone,
    CASE WHEN v_emp_role IN ('owner', 'admin') THEN 'admin'::user_role ELSE 'employee'::user_role END,
    false, true,
    'EMP-' || LPAD(v_next_num::text, 3, '0'),
    NULLIF(payload->>'jobTitle', ''), NULLIF(payload->>'photoUrl', ''),
    v_actor, v_shop_id, now()
  ) RETURNING id INTO v_id;

  -- Create membership with specified role and branch scope
  INSERT INTO memberships (user_id, tenant_id, role, status, branch_scope)
  VALUES (v_id, v_shop_id, v_emp_role, 'active', v_branch_scope);

  -- Grant permissions if provided
  IF payload->'permissions' IS NOT NULL THEN
    FOR v_perm_code IN SELECT jsonb_array_elements_text(payload->'permissions')
    LOOP
      SELECT id INTO v_perm_id FROM permissions WHERE code = v_perm_code;
      IF v_perm_id IS NOT NULL THEN
        INSERT INTO user_permissions (user_id, permission_id, granted_by)
        VALUES (v_id, v_perm_id, v_actor)
        ON CONFLICT (user_id, permission_id) DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('id', v_id, 'membershipRole', v_emp_role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_employee(jsonb) TO authenticated;


-- 9. HELPER: update employee access (role + permissions + branch)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_employee_access(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
  v_emp_id uuid;
  v_caller_role text;
  v_shop_id uuid;
  v_emp record;
  v_new_role membership_role;
  v_branch_scope uuid[];
  v_perm_code text;
  v_perm_id uuid;
BEGIN
  v_actor := NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED: No valid session'; END IF;
  SELECT role INTO v_caller_role FROM users WHERE id = v_actor;
  IF v_caller_role IS DISTINCT FROM 'admin' THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Only administrators can update employee access';
  END IF;
  v_shop_id := current_shop_id();
  IF v_shop_id IS NULL THEN RAISE EXCEPTION 'NOT_AUTHORIZED: No tenant context'; END IF;

  v_emp_id := COALESCE(
    NULLIF((payload->>'employeeId')::text, '')::uuid,
    NULLIF((payload->>'employee_id')::text, '')::uuid
  );
  IF v_emp_id IS NULL THEN RAISE EXCEPTION 'VALIDATION: Employee ID is required'; END IF;

  SELECT * INTO v_emp FROM users WHERE id = v_emp_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'EMPLOYEE_NOT_FOUND'; END IF;
  IF v_emp.shop_id IS DISTINCT FROM v_shop_id THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: Employee does not belong to your organization';
  END IF;
  IF v_emp.is_original_owner THEN
    RAISE EXCEPTION 'CANNOT_MODIFY_OWNER: Cannot modify the shop owner access';
  END IF;

  -- Update role if provided
  IF payload->>'membershipRole' IS NOT NULL AND payload->>'membershipRole' != '' THEN
    v_new_role := (payload->>'membershipRole')::membership_role;

    UPDATE memberships SET role = v_new_role, updated_at = now()
    WHERE user_id = v_emp_id AND tenant_id = v_shop_id;

    -- Sync users.role for backward compatibility
    UPDATE users SET role = CASE WHEN v_new_role IN ('owner', 'admin') THEN 'admin'::user_role ELSE 'employee'::user_role END
    WHERE id = v_emp_id;
  END IF;

  -- Update branch scope if provided
  IF payload ? 'branchScope' THEN
    IF payload->>'branchScope' IS NULL OR payload->>'branchScope' = '' THEN
      v_branch_scope := NULL;  -- NULL = all branches
    ELSE
      SELECT array_agg(t::uuid) INTO v_branch_scope
      FROM jsonb_array_elements_text(payload->'branchScope') AS t;
    END IF;

    UPDATE memberships SET branch_scope = v_branch_scope, updated_at = now()
    WHERE user_id = v_emp_id AND tenant_id = v_shop_id;
  END IF;

  -- Update permissions if provided (replace all)
  IF payload ? 'permissions' THEN
    -- Remove existing permissions
    DELETE FROM user_permissions WHERE user_id = v_emp_id;

    -- Add new permissions
    IF payload->'permissions' != 'null'::jsonb AND jsonb_array_length(payload->'permissions') > 0 THEN
      FOR v_perm_code IN SELECT jsonb_array_elements_text(payload->'permissions')
      LOOP
        SELECT id INTO v_perm_id FROM permissions WHERE code = v_perm_code;
        IF v_perm_id IS NOT NULL THEN
          INSERT INTO user_permissions (user_id, permission_id, granted_by)
          VALUES (v_emp_id, v_perm_id, v_actor);
        END IF;
      END LOOP;
    END IF;
  END IF;

  -- Audit log
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'employee_access_updated', 'user', v_emp_id,
    jsonb_build_object(
      'role', (payload->>'membershipRole'),
      'permissions_count', jsonb_array_length(COALESCE(payload->'permissions', '[]'::jsonb))
    ));

  RETURN jsonb_build_object('id', v_emp_id, 'updated', true);
END;
$$;

GRANT EXECUTE ON FUNCTION update_employee_access(jsonb) TO authenticated;


-- 10. VERIFY
-- ──────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_permission') THEN
    RAISE EXCEPTION 'has_permission not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_my_permissions') THEN
    RAISE EXCEPTION 'get_my_permissions not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'update_employee_access') THEN
    RAISE EXCEPTION 'update_employee_access not created';
  END IF;
  RAISE NOTICE 'RBAC permissions foundation deployed: permissions table, helpers, create_employee updated, update_employee_access created';
END $$;
