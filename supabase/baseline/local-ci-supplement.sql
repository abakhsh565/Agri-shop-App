-- ═══════════════════════════════════════════════════════════════════════════════
-- LOCAL-CI SUPPLEMENT — the RBAC surface production never received.
--
-- WHY THIS FILE EXISTS
--   The local-CI baseline artifact is built from the production dump at ledger
--   0304 (see scripts/dev/build-local-ci-baseline.mjs). Production's ledger
--   never received migrations 0107/0108, so the dump has no `business_areas`
--   table and none of the three functions below — but the integration suite
--   reads `business_areas` (tests/integration/rbacEnforcement.test.ts) and the
--   RBAC surface is incomplete without them. The forward files (0233-0302)
--   do not recreate them: 0107 as a whole is NOT replayable onto this schema
--   (its role_permissions bootstrap references the a0000000-… role ids, which
--   production replaced with its own ids — the INSERT would fail its foreign
--   key), so only the parts that are safe to carry are reproduced here.
--
-- WHAT IS IN HERE (verbatim excerpts, nothing invented)
--   * `business_areas` table + RLS policy + grant + the 14 seeded areas:
--     supabase/migrations/0107_roles_rbac_model.sql §§1, 6, 7, 8.
--   * `has_permission(varchar)`: 0108_authoritative_access_and_business_areas.sql.
--   * `create_business_area(jsonb)` + `update_business_area(jsonb)`: same file.
--   Every statement is CREATE OR REPLACE / IF NOT EXISTS / ON CONFLICT DO
--   NOTHING, so re-running this file is safe.
--
-- WHAT IS DELIBERATELY NOT IN HERE
--   * The 0107 role bootstrap (a0000000-… ids): production's roles already
--     exist under its own ids and the artifact carries those rows.
--   * `get_effective_permissions` / `has_effective_permission` /
--     `get_my_permissions` / `create_employee`: later migrations redefined
--     them and production already carries those definitions.
--
-- SAFETY
--   * This file is schema + reference rows only. It names no person, no
--     phone number, no password, and no fixture identity from
--     scripts/lib/fixture-identities.mjs. The build script refuses to write
--     an artifact that carries one.
--   * It is applied ONLY as part of the local-CI baseline artifact (appended
--     by the build script). It is never applied to QA or production.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. BUSINESS AREAS (0107 §1) ───────────────────────────────────────────────

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

-- 2. RLS (0107 §6, business_areas only) ─────────────────────────────────────

ALTER TABLE business_areas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_areas_select ON business_areas;
CREATE POLICY business_areas_select ON business_areas
  FOR SELECT USING (
    tenant_id = COALESCE(
      (SELECT m.tenant_id FROM memberships m WHERE m.user_id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid AND m.status = 'active' LIMIT 1),
      (SELECT shop_id FROM users WHERE id = NULLIF(current_setting('request.jwt.claims', true)::json->>'sub', '')::uuid)
    )
  );

-- 3. GRANT (0107 §7, business_areas only) ───────────────────────────────────

GRANT SELECT ON business_areas TO authenticated;

-- 4. BOOTSTRAP: default business areas (0107 §8) ────────────────────────────

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

-- 5. has_permission (0108) ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION has_permission(p_code varchar)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT has_effective_permission(p_code, NULL) $$;
GRANT EXECUTE ON FUNCTION has_permission(varchar) TO authenticated;

-- 6. create_business_area (0108) ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION create_business_area(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid;
BEGIN
  v_tenant := authorize_business_action('settings.edit');
  INSERT INTO business_areas(tenant_id, code, name_en, name_ur, sort_order)
  VALUES(v_tenant, lower(regexp_replace(trim(payload->>'code'), '[^a-z0-9_]+', '_', 'g')),
    trim(payload->>'nameEn'), COALESCE(NULLIF(trim(payload->>'nameUr'), ''), trim(payload->>'nameEn')),
    COALESCE((payload->>'sortOrder')::int, 0)) RETURNING id INTO v_id;
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES(v_actor, 'business_area_created', 'business_area', v_id, payload);
  RETURN jsonb_build_object('id', v_id);
END; $$;
GRANT EXECUTE ON FUNCTION create_business_area(jsonb) TO authenticated;

-- 7. update_business_area (0108) ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_business_area(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid := (payload->>'id')::uuid;
BEGIN
  v_tenant := authorize_business_action('settings.edit');
  UPDATE business_areas SET name_en=COALESCE(NULLIF(payload->>'nameEn',''),name_en),
    name_ur=COALESCE(NULLIF(payload->>'nameUr',''),name_ur),
    sort_order=COALESCE((payload->>'sortOrder')::int,sort_order),
    is_active=COALESCE((payload->>'isActive')::boolean,is_active)
  WHERE id=v_id AND tenant_id=v_tenant;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES(v_actor,'business_area_updated','business_area',v_id,payload);
  RETURN jsonb_build_object('id',v_id,'updated',true);
END; $$;
GRANT EXECUTE ON FUNCTION update_business_area(jsonb) TO authenticated;
