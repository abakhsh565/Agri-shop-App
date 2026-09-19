-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0113: User → Membership invariant
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHY: authorization now resolves through the membership (User → Membership →
-- Tenant → Branch → Role → Permission). A `users` row without a membership has
-- no tenant context and therefore no access at all — which silently broke any
-- user created outside create_employee/approve_shop_request (legacy rows,
-- fixtures, manual inserts).
--
-- This makes the invariant structural instead of a convention: every user that
-- belongs to a shop gets an active membership, and the two RPCs that also create
-- memberships are made conflict-safe (UNIQUE(user_id, tenant_id) already exists).
--
-- Additive only. No existing membership, role, or business row is modified.
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. Ensure every user has a membership for their shop
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.ensure_user_membership()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_role membership_role;
  v_role_id uuid;
BEGIN
  IF NEW.shop_id IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    SELECT 1 FROM memberships WHERE user_id = NEW.id AND tenant_id = NEW.shop_id
  ) THEN
    RETURN NEW;
  END IF;

  v_role := CASE
    WHEN NEW.is_original_owner THEN 'owner'::membership_role
    WHEN NEW.role = 'admin' THEN 'admin'::membership_role
    ELSE 'employee'::membership_role
  END;

  -- Owners are resolved implicitly and never use an employee role template.
  IF v_role <> 'owner' THEN
    SELECT r.id INTO v_role_id
    FROM roles r
    WHERE r.tenant_id = NEW.shop_id
      AND r.is_system = true
      AND r.name = CASE WHEN v_role = 'admin' THEN 'Store Manager' ELSE 'Sales Employee' END
    LIMIT 1;
  END IF;

  INSERT INTO memberships (user_id, tenant_id, role, status, branch_scope, role_id)
  VALUES (
    NEW.id, NEW.shop_id, v_role,
    CASE WHEN NEW.is_active THEN 'active'::membership_status ELSE 'suspended'::membership_status END,
    NULL, v_role_id
  )
  ON CONFLICT (user_id, tenant_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_user_membership_trg ON users;
CREATE TRIGGER ensure_user_membership_trg
  AFTER INSERT ON users
  FOR EACH ROW EXECUTE FUNCTION public.ensure_user_membership();

-- 2. Backfill: close the invariant for rows that predate the trigger
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO memberships (user_id, tenant_id, role, status, branch_scope, role_id)
SELECT
  u.id, u.shop_id,
  CASE WHEN u.is_original_owner THEN 'owner'::membership_role
       WHEN u.role = 'admin' THEN 'admin'::membership_role
       ELSE 'employee'::membership_role END,
  CASE WHEN u.is_active THEN 'active'::membership_status ELSE 'suspended'::membership_status END,
  NULL,
  CASE WHEN u.is_original_owner THEN NULL
       WHEN u.role = 'admin' THEN (SELECT r.id FROM roles r WHERE r.tenant_id = u.shop_id AND r.is_system AND r.name = 'Store Manager' LIMIT 1)
       ELSE (SELECT r.id FROM roles r WHERE r.tenant_id = u.shop_id AND r.is_system AND r.name = 'Sales Employee' LIMIT 1) END
FROM users u
WHERE u.shop_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id AND m.tenant_id = u.shop_id)
ON CONFLICT (user_id, tenant_id) DO NOTHING;

-- Keep membership status in sync when a user is activated/deactivated outside
-- the employee RPCs (the RPCs already do this explicitly).
CREATE OR REPLACE FUNCTION public.sync_membership_status()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.is_active IS DISTINCT FROM OLD.is_active AND NEW.shop_id IS NOT NULL THEN
    UPDATE memberships
    SET status = CASE WHEN NEW.is_active THEN 'active'::membership_status ELSE 'suspended'::membership_status END,
        updated_at = now()
    WHERE user_id = NEW.id AND tenant_id = NEW.shop_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_membership_status_trg ON users;
CREATE TRIGGER sync_membership_status_trg
  AFTER UPDATE OF is_active ON users
  FOR EACH ROW EXECUTE FUNCTION public.sync_membership_status();

-- 3. Make the membership-writing RPCs conflict-safe
-- ──────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_employee(payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := app_current_user_id(); v_tenant uuid; v_id uuid; v_phone text;
  v_role membership_role := COALESCE(NULLIF(payload->>'membershipRole','')::membership_role,'employee');
  v_role_id uuid := NULLIF(payload->>'roleId','')::uuid; v_scope uuid[]; v_num int;
BEGIN
  v_tenant := authorize_business_action('employees.manage');
  IF trim(COALESCE(payload->>'name',''))='' OR NULLIF(payload->>'phone','') IS NULL THEN RAISE EXCEPTION 'VALIDATION: Name and phone are required'; END IF;
  v_phone := payload->>'phone';
  IF EXISTS(SELECT 1 FROM users WHERE phone=v_phone) THEN RAISE EXCEPTION 'DUPLICATE_PHONE'; END IF;
  IF v_role='owner' THEN RAISE EXCEPTION 'INVALID_EMPLOYEE_ROLE'; END IF;
  IF v_role_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM roles WHERE id=v_role_id AND tenant_id=v_tenant) THEN RAISE EXCEPTION 'ROLE_NOT_FOUND_OR_NOT_AUTHORIZED'; END IF;
  IF payload->'branchScope' IS NOT NULL AND jsonb_typeof(payload->'branchScope')='array' THEN
    SELECT array_agg(x::uuid) INTO v_scope FROM jsonb_array_elements_text(payload->'branchScope') x;
    IF EXISTS(SELECT 1 FROM unnest(v_scope) x WHERE NOT EXISTS(SELECT 1 FROM branches b WHERE b.id=x AND b.tenant_id=v_tenant AND b.is_active)) THEN RAISE EXCEPTION 'INVALID_BRANCH_SCOPE'; END IF;
  END IF;
  SELECT COALESCE(MAX(NULLIF(regexp_replace(employee_number,'[^0-9]','','g'),'')::int),0)+1 INTO v_num FROM users WHERE shop_id=v_tenant;
  INSERT INTO users(id,name,phone,role,is_original_owner,is_active,employee_number,job_title,photo_url,created_by,shop_id,created_at)
  VALUES(gen_random_uuid(),trim(payload->>'name'),v_phone,CASE WHEN v_role='admin' THEN 'admin'::user_role ELSE 'employee'::user_role END,false,true,
    'EMP-'||lpad(v_num::text,3,'0'),NULLIF(payload->>'jobTitle',''),NULLIF(payload->>'photoUrl',''),v_actor,v_tenant,now()) RETURNING id INTO v_id;
  INSERT INTO memberships(user_id,tenant_id,role,status,branch_scope,role_id)
  VALUES(v_id,v_tenant,v_role,'active',v_scope,v_role_id)
  ON CONFLICT (user_id,tenant_id) DO UPDATE
    SET role=EXCLUDED.role, status='active', branch_scope=EXCLUDED.branch_scope,
        role_id=EXCLUDED.role_id, updated_at=now();
  INSERT INTO audit_events(user_id,action,entity_type,entity_id,details) VALUES(v_actor,'employee_created','user',v_id,jsonb_build_object('role_id',v_role_id,'branch_scope',v_scope));
  RETURN jsonb_build_object('id',v_id,'roleId',v_role_id,'membershipRole',v_role);
END; $$;
GRANT EXECUTE ON FUNCTION public.create_employee(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.approve_shop_request(request_id uuid, admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  req_record RECORD;
  new_shop_id uuid;
  new_user_id uuid;
  result jsonb;
BEGIN
  SELECT * INTO req_record FROM shop_requests WHERE id = request_id AND status = 'pending';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found or already processed');
  END IF;
  new_shop_id := gen_random_uuid();
  INSERT INTO shops (id, name) VALUES (new_shop_id, req_record.shop_name);
  new_user_id := gen_random_uuid();
  INSERT INTO users (
    id, name, phone, role, is_original_owner, is_active,
    employee_number, shop_id, created_by
  ) VALUES (
    new_user_id, req_record.owner_name, req_record.owner_phone,
    'admin', true, true, 'EMP-001', new_shop_id, admin_id
  );
  INSERT INTO memberships (user_id, tenant_id, role, status)
  VALUES (new_user_id, new_shop_id, 'owner', 'active')
  ON CONFLICT (user_id, tenant_id) DO UPDATE
    SET role = 'owner', role_id = NULL, status = 'active', updated_at = now();
  INSERT INTO branches (tenant_id, name, is_default)
  VALUES (new_shop_id, req_record.shop_name || ' - Main', true);
  UPDATE shop_requests
  SET status = 'approved', reviewed_by = admin_id, reviewed_at = now(), updated_at = now()
  WHERE id = request_id;
  result := jsonb_build_object(
    'success', true, 'shop_id', new_shop_id, 'user_id', new_user_id,
    'shop_name', req_record.shop_name, 'owner_name', req_record.owner_name
  );
  RETURN result;
END;
$function$;

-- 4. Verification: the invariant must hold for every existing user
DO $$
DECLARE
  v_orphans int;
BEGIN
  SELECT count(*) INTO v_orphans
  FROM users u
  WHERE u.shop_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = u.id);
  IF v_orphans > 0 THEN
    RAISE EXCEPTION 'User→Membership invariant violated for % user(s)', v_orphans;
  END IF;
  RAISE NOTICE '0113: every user with a shop now has a membership';
END $$;
