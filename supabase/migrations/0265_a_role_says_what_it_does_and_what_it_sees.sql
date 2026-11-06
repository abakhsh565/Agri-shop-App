-- ═══════════════════════════════════════════════════════════════════════════════
-- 0265 — A role says what it DOES and what it SEES
--
-- THE HOLE. A role today is a name and a bag of permission codes. Two things the
-- owner needs do not exist anywhere in the schema:
--
--   1. A DEPARTMENT. The owner's mental model is "the sales people", "the finance
--      people", "the inventory people". The app had to guess it from the name
--      (`roleIcon()` in the roles screen lowercases the name and looks for "sale"),
--      so a role called "Cashier" and a role called "Salesman" could not be said to
--      belong to the same team, and nothing could group or default them.
--
--   2. A DASHBOARD VISIBILITY, separate from the permission to ACT. This is the
--      owner's actual complaint: a Sales Manager who may `sales.view` still sees
--      nothing, because the admin shell is entered by membership role, not by
--      grant, and Home draws whatever it likes once inside. Permission is not
--      visibility — reading a sales chart must be grantable without also handing
--      over `sales.void`.
--
-- WHAT THIS MIGRATION ADDS
--
--   departments            one row per (business, department). Sales, Finance,
--                          Inventory, Operations and Management exist in every
--                          business; the owner may add more.
--   roles.department_id    which department a role belongs to. NULL is allowed for
--                          a tenant that has not been given departments yet.
--   dashboard_widgets      the catalogue of dashboard blocks the app can draw, with
--                          the permission that shows one BY DEFAULT and its label in
--                          both languages. A catalogue table, like `permissions`, so
--                          the client never invents a key.
--   role_dashboards        (role, widget) — presence means visible. Absence is a
--                          decision, not missing data.
--
--   get_my_dashboards()    the widgets the CALLER may see, resolved through the
--                          role of the branch they are working in — the same rule
--                          0233 gave permissions. Owner sees every widget.
--   get_role_access()      one read for the role editor: permissions, department
--                          and dashboards together, so it cannot open on a
--                          half-loaded picture.
--   create_department()    owner-added departments.
--   create_role/update_role now accept `departmentId` and `dashboards`. Bodies are
--                          0208's, extended — every guard they accumulated is kept.
--
-- BACKFILL. Existing roles are placed in a department by name, and given the
-- widgets their permissions already imply, so no role goes blank on the day this
-- lands. Only rows that do not exist are written; nothing is dropped.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Departments ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  code        text NOT NULL,
  name_en     text NOT NULL,
  name_ur     text NOT NULL,
  sort_order  int  NOT NULL DEFAULT 100,
  is_system   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_departments_tenant ON public.departments(tenant_id);

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

-- The owner's own business only. Writes go through create_department(), which is
-- SECURITY DEFINER and re-checks the tenant, so no client needs a write policy.
DROP POLICY IF EXISTS departments_select ON public.departments;
CREATE POLICY departments_select ON public.departments
  FOR SELECT USING (tenant_id = public.current_shop_id());

GRANT SELECT ON public.departments TO authenticated;

-- ── 2. The five departments every business starts with ─────────────────────────
INSERT INTO public.departments (tenant_id, code, name_en, name_ur, sort_order)
SELECT s.id, d.code, d.name_en, d.name_ur, d.sort_order
  FROM public.shops s
 CROSS JOIN (VALUES
   ('sales',      'Sales',      'فروخت',     1),
   ('finance',    'Finance',    'مالیات',    2),
   ('inventory',  'Inventory',  'انوینٹری',  3),
   ('operations', 'Operations', 'کاروبار',   4),
   ('management', 'Management', 'انتظامیہ',  5)
 ) AS d(code, name_en, name_ur, sort_order)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- A business created after this migration gets the same five. A trigger rather than
-- a line in the signup RPC: signup is not the only way a shop is created (the
-- marketplace, seeds and tests all insert one), and a missing department would make
-- the roles screen silently wrong for exactly those shops.
CREATE OR REPLACE FUNCTION public.seed_departments_for_shop()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.departments (tenant_id, code, name_en, name_ur, sort_order)
  VALUES
    (NEW.id, 'sales',      'Sales',      'فروخت',     1),
    (NEW.id, 'finance',    'Finance',    'مالیات',    2),
    (NEW.id, 'inventory',  'Inventory',  'انوینٹری',  3),
    (NEW.id, 'operations', 'Operations', 'کاروبار',   4),
    (NEW.id, 'management', 'Management', 'انتظامیہ',  5)
  ON CONFLICT (tenant_id, code) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS shops_seed_departments_trg ON public.shops;
CREATE TRIGGER shops_seed_departments_trg
  AFTER INSERT ON public.shops
  FOR EACH ROW EXECUTE FUNCTION public.seed_departments_for_shop();

-- ── 3. A role belongs to a department ──────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'roles' AND column_name = 'department_id'
  ) THEN
    ALTER TABLE public.roles
      ADD COLUMN department_id uuid REFERENCES public.departments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_roles_department ON public.roles(department_id);

-- Where the role applies BY DEFAULT — the wireframe's "Data visibility" step. This is a
-- template choice, not the enforcement: what a person may actually open is
-- memberships.branch_scope plus membership_branch_roles, which is decided per assignment.
-- The invite screen pre-selects from this; RLS still decides.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'roles' AND column_name = 'data_scope'
  ) THEN
    ALTER TABLE public.roles
      ADD COLUMN data_scope text NOT NULL DEFAULT 'business'
      CHECK (data_scope IN ('business','branches','department','records'));
  END IF;
END $$;

-- A role's department must belong to the role's own business. Checked here so no
-- writer (RPC, repair script, future importer) can cross the boundary.
CREATE OR REPLACE FUNCTION public.role_department_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tenant uuid;
BEGIN
  IF NEW.department_id IS NULL THEN RETURN NEW; END IF;
  SELECT tenant_id INTO v_tenant FROM public.departments WHERE id = NEW.department_id;
  IF v_tenant IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'DEPARTMENT_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS role_department_guard_trg ON public.roles;
CREATE TRIGGER role_department_guard_trg
  BEFORE INSERT OR UPDATE OF department_id ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.role_department_guard();

-- Existing roles are filed by the WORK they name, not by the word "manager": a
-- Sales Manager belongs to Sales, and only a manager with no trade in the name
-- (Store Manager, Branch Manager, Owner, Admin) falls into Management. Everything
-- unrecognised lands in Operations rather than in no department at all — the owner
-- can move it in one tap.
UPDATE public.roles r
   SET department_id = d.id
  FROM public.departments d
 WHERE d.tenant_id = r.tenant_id
   AND r.department_id IS NULL
   AND d.code = CASE
     WHEN r.name ILIKE '%sale%' OR r.name ILIKE '%cashier%'      THEN 'sales'
     WHEN r.name ILIKE '%financ%' OR r.name ILIKE '%account%'
       OR r.name ILIKE '%cash%'                                   THEN 'finance'
     WHEN r.name ILIKE '%inventor%' OR r.name ILIKE '%stock%'     THEN 'inventory'
     WHEN r.name ILIKE '%manager%' OR r.name ILIKE '%admin%'
       OR r.name ILIKE '%owner%' OR r.name ILIKE '%supervisor%'  THEN 'management'
     WHEN r.name ILIKE '%store%'                                  THEN 'inventory'
     ELSE 'operations'
   END;

-- ── 4. The dashboard catalogue ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dashboard_widgets (
  key                text PRIMARY KEY,
  module             text NOT NULL,
  label_en           text NOT NULL,
  label_ur           text NOT NULL,
  sort_order         int  NOT NULL DEFAULT 100,
  default_permission text REFERENCES public.permissions(code) ON DELETE SET NULL
);

ALTER TABLE public.dashboard_widgets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dashboard_widgets_select ON public.dashboard_widgets;
CREATE POLICY dashboard_widgets_select ON public.dashboard_widgets
  FOR SELECT USING (true);

GRANT SELECT ON public.dashboard_widgets TO authenticated;

INSERT INTO public.dashboard_widgets (key, module, label_en, label_ur, sort_order, default_permission) VALUES
  ('sales_overview',      'sales',     'Sales overview',       'فروخت کا خلاصہ',      1,  'sales.view'),
  ('revenue_analysis',    'sales',     'Revenue analysis',     'آمدنی کا تجزیہ',      2,  'sales.view'),
  ('expense_analysis',    'purchases', 'Expense analysis',     'اخراجات کا تجزیہ',    3,  'purchases.view'),
  ('profit_loss',         'reports',   'Profit and loss',      'نفع و نقصان',         4,  'reports.view'),
  ('customer_outstanding','customers', 'Customer outstanding', 'صارفین کا ادھار',     5,  'customers.view'),
  ('inventory_position',  'inventory', 'Inventory position',   'انوینٹری کی صورتحال', 6,  'inventory.view'),
  ('supplier_payables',   'purchases', 'Supplier payables',    'سپلائر کو دینا',      7,  'purchases.view'),
  ('team_performance',    'employees', 'Team performance',     'عملے کی کارکردگی',    8,  'employees.view'),
  ('money_movements',     'payments',  'Money movements',      'رقم کی آمد و رفت',    9,  'payments.view'),
  ('quick_alerts',        'alerts',    'Action needed',        'ضروری کام',          10,  'alerts.view')
ON CONFLICT (key) DO NOTHING;

-- ── 5. What each role sees ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.role_dashboards (
  role_id    uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  widget_key text NOT NULL REFERENCES public.dashboard_widgets(key) ON DELETE CASCADE,
  PRIMARY KEY (role_id, widget_key)
);

CREATE INDEX IF NOT EXISTS idx_role_dashboards_role ON public.role_dashboards(role_id);

ALTER TABLE public.role_dashboards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS role_dashboards_select ON public.role_dashboards;
CREATE POLICY role_dashboards_select ON public.role_dashboards
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.roles r
       WHERE r.id = role_dashboards.role_id
         AND r.tenant_id = public.current_shop_id()
    )
  );

GRANT SELECT ON public.role_dashboards TO authenticated;

-- Backfill: every role keeps the visibility its permissions already imply.
INSERT INTO public.role_dashboards (role_id, widget_key)
SELECT DISTINCT rp.role_id, w.key
  FROM public.role_permissions rp
  JOIN public.permissions p ON p.id = rp.permission_id
  JOIN public.dashboard_widgets w ON w.default_permission = p.code
ON CONFLICT DO NOTHING;

-- ── 6. The caller's own visibility ─────────────────────────────────────────────
-- Read through the ACTIVE branch's role, exactly as get_effective_permissions()
-- does since 0233. An owner is not on a role and sees every widget.
CREATE OR REPLACE FUNCTION public.get_my_dashboards()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user    uuid := public.app_current_user_id();
  v_member  public.memberships;
  v_role    uuid;
  v_branch  uuid;
  v_keys    text[];
BEGIN
  IF v_user IS NULL THEN RETURN '[]'::jsonb; END IF;
  SELECT * INTO v_member FROM public.membership_in_active_shop(v_user);
  IF v_member.id IS NULL THEN RETURN '[]'::jsonb; END IF;

  IF v_member.role = 'owner' THEN
    SELECT array_agg(key ORDER BY sort_order, key) INTO v_keys FROM public.dashboard_widgets;
    RETURN to_jsonb(COALESCE(v_keys, '{}'::text[]));
  END IF;

  v_role := v_member.role_id;
  v_branch := public.current_branch_id();
  IF v_branch IS NOT NULL THEN
    SELECT COALESCE(mbr.role_id, v_role) INTO v_role
      FROM public.membership_branch_roles mbr
     WHERE mbr.membership_id = v_member.id AND mbr.branch_id = v_branch;
    v_role := COALESCE(v_role, v_member.role_id);
  END IF;

  SELECT array_agg(rd.widget_key ORDER BY w.sort_order, w.key)
    INTO v_keys
    FROM public.role_dashboards rd
    JOIN public.dashboard_widgets w ON w.key = rd.widget_key
   WHERE rd.role_id = v_role;

  RETURN to_jsonb(COALESCE(v_keys, '{}'::text[]));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_dashboards() TO authenticated;
REVOKE ALL ON FUNCTION public.get_my_dashboards() FROM PUBLIC, anon;

-- ── 7. One read for the role editor ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_role_access(p_role_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_dept   uuid;
  v_scope  text;
  v_code   text;
  v_perms  jsonb;
  v_dash   jsonb;
BEGIN
  v_tenant := public.authorize_business_action('settings.view');
  SELECT department_id, data_scope INTO v_dept, v_scope
    FROM public.roles WHERE id = p_role_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  SELECT code INTO v_code FROM public.departments WHERE id = v_dept;

  SELECT COALESCE(jsonb_agg(p.code ORDER BY p.code), '[]'::jsonb) INTO v_perms
    FROM public.role_permissions rp
    JOIN public.permissions p ON p.id = rp.permission_id
   WHERE rp.role_id = p_role_id;

  SELECT COALESCE(jsonb_agg(rd.widget_key ORDER BY w.sort_order, w.key), '[]'::jsonb) INTO v_dash
    FROM public.role_dashboards rd
    JOIN public.dashboard_widgets w ON w.key = rd.widget_key
   WHERE rd.role_id = p_role_id;

  RETURN jsonb_build_object(
    'permissions', v_perms,
    'dashboards',  v_dash,
    'departmentId', v_dept,
    'departmentCode', v_code,
    'dataScope', COALESCE(v_scope, 'business')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_role_access(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_role_access(uuid) FROM PUBLIC, anon;

-- ── 8. A department the owner adds ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_department(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_name   text := trim(COALESCE(payload->>'nameEn', payload->>'name', ''));
  v_ur     text := NULLIF(trim(COALESCE(payload->>'nameUr', '')), '');
  v_code   text;
  v_id     uuid;
BEGIN
  v_tenant := public.authorize_business_action('settings.edit');
  IF v_name = '' THEN RAISE EXCEPTION 'VALIDATION: department name is required'; END IF;

  v_code := lower(regexp_replace(v_name, '[^a-zA-Z0-9]+', '_', 'g'));
  v_code := trim(both '_' from v_code);
  IF v_code = '' THEN v_code := 'dept_' || substr(md5(random()::text), 1, 6); END IF;

  IF EXISTS (SELECT 1 FROM public.departments WHERE tenant_id = v_tenant AND code = v_code) THEN
    RAISE EXCEPTION 'DEPARTMENT_EXISTS';
  END IF;

  INSERT INTO public.departments (tenant_id, code, name_en, name_ur, sort_order, is_system)
  VALUES (
    v_tenant, v_code, v_name, COALESCE(v_ur, v_name),
    COALESCE((payload->>'sortOrder')::int, 100), false
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'code', v_code);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_department(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.create_department(jsonb) FROM PUBLIC, anon;

-- ── 9. create_role / update_role learn department and dashboards ───────────────
-- 0208's bodies, extended. The authorization, tenant check, audit row and
-- ON CONFLICT behaviour are unchanged. `dashboards` is written only when the caller
-- supplies it; on create it is derived from the chosen permissions instead, so a
-- client that has not been updated yet still produces a role that sees something.
CREATE OR REPLACE FUNCTION public.create_role(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor  uuid := public.app_current_user_id();
  v_tenant uuid;
  v_id     uuid;
  v_code   text;
  v_perm   uuid;
  v_dept   uuid := NULLIF(payload->>'departmentId', '')::uuid;
  v_scope  text := COALESCE(NULLIF(payload->>'dataScope', ''), 'business');
BEGIN
  v_tenant := public.authorize_business_action('settings.edit');
  IF v_dept IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments WHERE id = v_dept AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'DEPARTMENT_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;
  IF v_scope NOT IN ('business','branches','department','records') THEN
    RAISE EXCEPTION 'VALIDATION: unknown data scope';
  END IF;

  INSERT INTO public.roles (tenant_id, name, description, department_id, data_scope)
  VALUES (v_tenant, trim(payload->>'name'), NULLIF(payload->>'description', ''), v_dept, v_scope)
  RETURNING id INTO v_id;

  FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions', '[]'::jsonb)) LOOP
    SELECT id INTO v_perm FROM public.permissions WHERE code = v_code;
    IF v_perm IS NOT NULL THEN
      INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_id, v_perm)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  IF payload ? 'dashboards' THEN
    INSERT INTO public.role_dashboards (role_id, widget_key)
    SELECT v_id, w.key
      FROM jsonb_array_elements_text(COALESCE(payload->'dashboards', '[]'::jsonb)) AS k(key)
      JOIN public.dashboard_widgets w ON w.key = k.key
    ON CONFLICT DO NOTHING;
  ELSE
    INSERT INTO public.role_dashboards (role_id, widget_key)
    SELECT DISTINCT v_id, w.key
      FROM public.role_permissions rp
      JOIN public.permissions p ON p.id = rp.permission_id
      JOIN public.dashboard_widgets w ON w.default_permission = p.code
     WHERE rp.role_id = v_id
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'role_created', 'role', v_id, payload);
  RETURN jsonb_build_object('id', v_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_role(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.create_role(jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.update_role(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor  uuid := public.app_current_user_id();
  v_tenant uuid;
  v_id     uuid := (payload->>'roleId')::uuid;
  v_code   text;
  v_perm   uuid;
  v_dept   uuid := NULLIF(payload->>'departmentId', '')::uuid;
  v_scope  text := NULLIF(payload->>'dataScope', '');
BEGIN
  v_tenant := public.authorize_business_action('settings.edit');
  IF NOT EXISTS (SELECT 1 FROM public.roles WHERE id = v_id AND tenant_id = v_tenant) THEN
    RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;
  IF v_dept IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.departments WHERE id = v_dept AND tenant_id = v_tenant
  ) THEN
    RAISE EXCEPTION 'DEPARTMENT_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;
  IF v_scope IS NOT NULL AND v_scope NOT IN ('business','branches','department','records') THEN
    RAISE EXCEPTION 'VALIDATION: unknown data scope';
  END IF;

  UPDATE public.roles
     SET name = COALESCE(NULLIF(payload->>'name', ''), name),
         description = COALESCE(payload->>'description', description),
         department_id = CASE WHEN payload ? 'departmentId' THEN v_dept ELSE department_id END,
         data_scope = CASE WHEN payload ? 'dataScope' THEN v_scope ELSE data_scope END,
         updated_at = now()
   WHERE id = v_id AND tenant_id = v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;

  IF payload ? 'permissions' THEN
    DELETE FROM public.role_permissions WHERE role_id = v_id;
    FOR v_code IN SELECT jsonb_array_elements_text(COALESCE(payload->'permissions', '[]'::jsonb)) LOOP
      SELECT id INTO v_perm FROM public.permissions WHERE code = v_code;
      IF v_perm IS NOT NULL THEN
        INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_id, v_perm)
        ON CONFLICT DO NOTHING;
      END IF;
    END LOOP;
  END IF;

  IF payload ? 'dashboards' THEN
    DELETE FROM public.role_dashboards WHERE role_id = v_id;
    INSERT INTO public.role_dashboards (role_id, widget_key)
    SELECT v_id, w.key
      FROM jsonb_array_elements_text(COALESCE(payload->'dashboards', '[]'::jsonb)) AS k(key)
      JOIN public.dashboard_widgets w ON w.key = k.key
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.audit_events (user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'role_updated', 'role', v_id, payload);
  RETURN jsonb_build_object('id', v_id, 'updated', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_role(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public.update_role(jsonb) FROM PUBLIC, anon;

-- ── 10. Verify ─────────────────────────────────────────────────────────────────
DO $$
DECLARE v_n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_my_dashboards') THEN
    RAISE EXCEPTION 'get_my_dashboards not created';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_role_access') THEN
    RAISE EXCEPTION 'get_role_access not created';
  END IF;
  SELECT count(*) INTO v_n FROM public.dashboard_widgets;
  IF v_n < 10 THEN RAISE EXCEPTION 'dashboard catalogue incomplete: % rows', v_n; END IF;
  IF EXISTS (
    SELECT 1 FROM public.roles r
     WHERE r.department_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.departments d
                        WHERE d.id = r.department_id AND d.tenant_id = r.tenant_id)
  ) THEN
    RAISE EXCEPTION 'a role points at another business department';
  END IF;
  RAISE NOTICE 'RBAC visibility deployed: departments, dashboard catalogue, role_dashboards, get_my_dashboards';
END $$;

NOTIFY pgrst, 'reload schema';
