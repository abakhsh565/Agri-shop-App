-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0121: authorize platform shop-request approval
-- ═══════════════════════════════════════════════════════════════════════════════
-- EVIDENCE:
--   approve_shop_request(request_id, admin_id) had NO acl at all, i.e. PUBLIC
--   EXECUTE, and trusted the caller-supplied admin_id. It CREATES a new tenant
--   (shops row) and a new owner user, so an anonymous request could provision
--   tenants. It was the only remaining unguarded write outside the Engineering
--   OS internals.
--
-- Onboarding approval is a PLATFORM operation, not a tenant business action, so
-- it is not routed through the tenant guard. It now requires an authenticated
-- founder/admin of an existing shop — the closest existing concept to a platform
-- owner, with no new role invented. Anonymous and non-operator callers are
-- rejected. The application's approval screen (shopRequestsStore) keeps working
-- for that operator.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.approve_shop_request(request_id uuid, admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := app_current_user_id();
  req_record RECORD;
  new_shop_id uuid;
  new_user_id uuid;
  result jsonb;
BEGIN
  -- Platform-level authority: an authenticated founder/admin of an existing
  -- shop. A service-role / direct owner connection is trusted too.
  IF v_actor IS NULL THEN
    IF NOT is_trusted_context() THEN
      RAISE EXCEPTION 'NOT_AUTHENTICATED';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM users u
     WHERE u.id = v_actor
       AND u.is_active
       AND u.role IN ('admin', 'co_admin')
  ) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: shop approval requires the platform owner';
  END IF;

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
    new_user_id, req_record.owner_name, req_record.phone, 'admin', true, true,
    'EMP-001', new_shop_id, COALESCE(v_actor, admin_id)
  );

  UPDATE shop_requests SET status = 'approved', approved_at = now() WHERE id = request_id;

  result := jsonb_build_object(
    'success', true,
    'shop_id', new_shop_id,
    'user_id', new_user_id
  );
  RETURN result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_shop_request(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_shop_request(uuid, uuid) TO authenticated, service_role;
