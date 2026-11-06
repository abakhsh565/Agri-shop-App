-- 0275: a role remembers its category and responsibility level
--
-- WHY
--   The Roles & Access flow distinguishes three things that used to collapse into one:
--     * category        — the system classification that orders recommendations;
--     * department      — the business's own org unit (already stored);
--     * responsibility  — an organisational label, never authority.
--
--   Both new fields are metadata. Nothing in this migration grants a permission: the
--   existing role_permissions and RLS paths are untouched.
--
-- ADDITIVE
--   Existing rows are backfilled from their current department and name. A role whose
--   department cannot be mapped becomes 'other'; a name containing Manager/Head/Supervisor
--   gets the matching level, and every other row starts as Individual Contributor.

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS role_category text,
  ADD COLUMN IF NOT EXISTS responsibility_level text;

UPDATE public.roles r
   SET role_category = CASE d.code
     WHEN 'sales' THEN 'sales'
     WHEN 'finance' THEN 'finance'
     WHEN 'inventory' THEN 'inventory'
     WHEN 'operations' THEN 'operations'
     WHEN 'management' THEN 'business_management'
     ELSE 'other'
   END
  FROM public.departments d
 WHERE r.department_id = d.id
   AND r.role_category IS NULL;

UPDATE public.roles
   SET role_category = 'other'
 WHERE role_category IS NULL;

UPDATE public.roles
   SET responsibility_level = CASE
     WHEN name ILIKE '%department head%' OR name ILIKE '%head of%' THEN 'department_head'
     WHEN name ILIKE '%manager%' THEN 'manager'
     WHEN name ILIKE '%supervisor%' THEN 'supervisor'
     ELSE 'individual_contributor'
   END
 WHERE responsibility_level IS NULL;

ALTER TABLE public.roles ALTER COLUMN role_category SET DEFAULT 'other';
ALTER TABLE public.roles ALTER COLUMN responsibility_level SET DEFAULT 'individual_contributor';

DO $constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.roles'::regclass AND conname = 'roles_role_category_check'
  ) THEN
    ALTER TABLE public.roles ADD CONSTRAINT roles_role_category_check
      CHECK (role_category IN (
        'sales','finance','inventory','procurement','people_hr','operations',
        'business_management','other'
      ));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.roles'::regclass AND conname = 'roles_responsibility_level_check'
  ) THEN
    ALTER TABLE public.roles ADD CONSTRAINT roles_responsibility_level_check
      CHECK (responsibility_level IN (
        'individual_contributor','supervisor','manager','department_head'
      ));
  END IF;
END
$constraints$;

-- ── The editor read ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_role_access(p_role_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_dept   uuid;
  v_scope  text;
  v_cat    text;
  v_level  text;
  v_code   text;
  v_perms  jsonb;
  v_dash   jsonb;
BEGIN
  v_tenant := public.authorize_business_action('settings.view');
  SELECT department_id, data_scope, role_category, responsibility_level
    INTO v_dept, v_scope, v_cat, v_level
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
    'dataScope', COALESCE(v_scope, 'branches'),
    'roleCategory', COALESCE(v_cat, 'other'),
    'responsibilityLevel', COALESCE(v_level, 'individual_contributor')
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_role_access(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.get_role_access(uuid) FROM PUBLIC, anon;

-- ── Create ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_role(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor  uuid := public.app_current_user_id();
  v_tenant uuid;
  v_id     uuid;
  v_code   text;
  v_perm   uuid;
  v_dept   uuid := NULLIF(payload->>'departmentId', '')::uuid;
  v_scope  text := COALESCE(NULLIF(payload->>'dataScope', ''), 'branches');
  v_cat    text := COALESCE(NULLIF(payload->>'roleCategory', ''), 'other');
  v_level  text := COALESCE(NULLIF(payload->>'responsibilityLevel', ''), 'individual_contributor');
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
  IF v_cat NOT IN ('sales','finance','inventory','procurement','people_hr','operations','business_management','other') THEN
    RAISE EXCEPTION 'VALIDATION: unknown role category';
  END IF;
  IF v_level NOT IN ('individual_contributor','supervisor','manager','department_head') THEN
    RAISE EXCEPTION 'VALIDATION: unknown responsibility level';
  END IF;

  INSERT INTO public.roles (tenant_id, name, description, department_id, data_scope, role_category, responsibility_level)
  VALUES (v_tenant, trim(payload->>'name'), NULLIF(payload->>'description', ''), v_dept, v_scope, v_cat, v_level)
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

-- ── Update ─────────────────────────────────────────────────────────────────────
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
  v_cat    text := NULLIF(payload->>'roleCategory', '');
  v_level  text := NULLIF(payload->>'responsibilityLevel', '');
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
  IF v_cat IS NOT NULL AND v_cat NOT IN ('sales','finance','inventory','procurement','people_hr','operations','business_management','other') THEN
    RAISE EXCEPTION 'VALIDATION: unknown role category';
  END IF;
  IF v_level IS NOT NULL AND v_level NOT IN ('individual_contributor','supervisor','manager','department_head') THEN
    RAISE EXCEPTION 'VALIDATION: unknown responsibility level';
  END IF;

  UPDATE public.roles
     SET name = COALESCE(NULLIF(payload->>'name', ''), name),
         description = COALESCE(payload->>'description', description),
         department_id = CASE WHEN payload ? 'departmentId' THEN v_dept ELSE department_id END,
         data_scope = CASE WHEN payload ? 'dataScope' THEN COALESCE(v_scope, data_scope) ELSE data_scope END,
         role_category = CASE WHEN payload ? 'roleCategory' THEN COALESCE(v_cat, role_category) ELSE role_category END,
         responsibility_level = CASE WHEN payload ? 'responsibilityLevel' THEN COALESCE(v_level, responsibility_level) ELSE responsibility_level END,
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

DO $verify$
DECLARE v_n int;
BEGIN
  SELECT count(*) INTO v_n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'roles'
     AND column_name IN ('role_category','responsibility_level');
  IF v_n <> 2 THEN RAISE EXCEPTION 'role metadata columns missing'; END IF;
END
$verify$;

NOTIFY pgrst, 'reload schema';
