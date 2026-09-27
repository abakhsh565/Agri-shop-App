-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0150: creating a second shop, and switching the active one
-- ═══════════════════════════════════════════════════════════════════════════════
-- FINDING (audit + live schema):
--   There was no way for an existing account to gain a second shop. The only path that
--   created a shop was approve_shop_request (registration by someone with no account), and
--   inside it:
--
--       INSERT INTO users (…, phone, …) VALUES (…, req_record.phone, …)
--
--   `users.phone` carries a UNIQUE constraint (users_phone_key), so for a phone that already
--   had a user — i.e. exactly the owner who wants another shop — the approval raised
--   23505 duplicate key and the operator saw a raw database error. The path was dead. It also
--   created the shop with no membership of its own, relying on the whole thing being one
--   ownership transfer rather than a second shop.
--
-- WHAT THIS MIGRATION ADDS
--   create_shop_internal(shop, owner?)   one transaction: shop row, its default branch, its
--                                        four system role templates, and the owner's
--                                        membership. Internal — no grants.
--   create_shop_for_me(name)             the account path. Owner/admin of a shop they are
--                                        working in creates another one and lands in it.
--   set_active_shop(shop_id)             the only way to change which shop is active.
--                                        Refuses any shop the caller is not an active member
--                                        of — the check is a membership lookup, not a
--                                        parameter the client can influence.
--   get_my_shops()                       the caller's own shops (id, name, role, status, which
--                                        one is active). What a switcher screen needs; it
--                                        returns nothing that RLS would not already allow.
--   approve_shop_request                 repaired: an existing account is ATTACHED to the new
--                                        shop (shop + owner membership) instead of being
--                                        duplicated; a new phone still gets its shop and its
--                                        owner row, which the ensure_user_membership trigger
--                                        (0113) turns into a membership.
--
--                                        It also stamped `approved_at`, a column this table has
--                                        never had (it has reviewed_by / reviewed_at), so every
--                                        approval raised `column "approved_at" does not exist`
--                                        after provisioning the shop — the approval button could
--                                        not succeed, for any request, not just a second shop.
--                                        Recorded with the same columns the reject path uses.
--
-- NOTHING IS MOVED: a new shop is new rows only. Existing shops, memberships, users.shop_id
-- and every business row keep their associations; approving a request for an account that
-- already trades leaves that account's active shop untouched.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Provisioning a shop ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_shop_internal(p_name text, p_owner_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shop uuid;
  v_template uuid;
  v_role record;
  v_new_role uuid;
BEGIN
  INSERT INTO shops (id, name, owner_id)
  VALUES (gen_random_uuid(), p_name, p_owner_id)
  RETURNING id INTO v_shop;

  -- Branch first: the branch-stamping trigger (0119) resolves a new record's branch through
  -- default_branch_id(tenant), and a shop with no branch would stamp NULL.
  INSERT INTO branches (tenant_id, name, is_default, is_active)
  VALUES (v_shop, p_name || ' - Main', true, true);

  -- The four system role templates this app defines, taken from the shop that already carries
  -- them (oldest first, so the set is deterministic). Only role metadata and permission codes
  -- are copied — never an employee, a membership or a business row.
  SELECT r.tenant_id INTO v_template
    FROM roles r
   WHERE r.is_system
   GROUP BY r.tenant_id
   ORDER BY min(r.created_at) ASC
   LIMIT 1;

  IF v_template IS NOT NULL THEN
    FOR v_role IN
      SELECT * FROM roles r WHERE r.tenant_id = v_template AND r.is_system ORDER BY r.name
    LOOP
      INSERT INTO roles (tenant_id, name, description, is_system)
      VALUES (v_shop, v_role.name, v_role.description, true)
      RETURNING id INTO v_new_role;

      INSERT INTO role_permissions (role_id, permission_id)
      SELECT v_new_role, rp.permission_id FROM role_permissions rp WHERE rp.role_id = v_role.id;
    END LOOP;
  END IF;

  -- p_owner_id is NULL only for the registration path, where the users row (and therefore the
  -- membership, via the 0113 trigger) is created immediately afterwards.
  IF p_owner_id IS NOT NULL THEN
    INSERT INTO memberships (user_id, tenant_id, role, status)
    VALUES (p_owner_id, v_shop, 'owner', 'active')
    ON CONFLICT (user_id, tenant_id)
    DO UPDATE SET role = 'owner', status = 'active', updated_at = now();
  END IF;

  RETURN v_shop;
END;
$$;
REVOKE ALL ON FUNCTION public.create_shop_internal(text, uuid) FROM PUBLIC, anon, authenticated;

-- ── 2. Creating another shop for an account that already has one ──────────────
CREATE OR REPLACE FUNCTION public.create_shop_for_me(p_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_clean text := trim(COALESCE(p_name, ''));
  v_shop uuid;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_clean = '' THEN RAISE EXCEPTION 'VALIDATION: a shop name is required'; END IF;
  IF length(v_clean) > 120 THEN RAISE EXCEPTION 'VALIDATION: shop name is too long'; END IF;

  -- An owner or admin of the shop they are working in — the same authority the rest of the
  -- owner-side app already requires. Employees do not get to provision businesses.
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: creating a shop requires an owner or admin of an existing shop';
  END IF;

  v_shop := public.create_shop_internal(v_clean, v_actor);

  -- The shop just created is the one the caller is now working in. Stated here rather than
  -- left to the client, so a client that ignores the response still agrees with the database.
  INSERT INTO user_active_shops (user_id, shop_id, updated_at)
  VALUES (v_actor, v_shop, now())
  ON CONFLICT (user_id) DO UPDATE SET shop_id = EXCLUDED.shop_id, updated_at = now();

  RETURN jsonb_build_object(
    'success', true,
    'shop_id', v_shop,
    'shop_name', v_clean,
    'active_shop_id', v_shop,
    'membership_role', 'owner'
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_shop_for_me(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shop_for_me(text) TO authenticated;

COMMENT ON FUNCTION public.create_shop_for_me(text) IS
  'Creates an additional shop for the calling account (shop + branch + role templates + owner membership) and makes it the active shop. Owner/admin only.';

-- ── 3. Switching the active shop ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_active_shop(p_shop_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := app_current_user_id();
  v_role membership_role;
  v_membership uuid;
  v_name text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF p_shop_id IS NULL THEN RAISE EXCEPTION 'VALIDATION: a shop id is required'; END IF;

  -- The membership is the permission. Nothing about the caller's current context can widen it.
  SELECT m.role, m.id INTO v_role, v_membership
  FROM memberships m
  WHERE m.user_id = v_actor
    AND m.tenant_id = p_shop_id
    AND m.status = 'active';

  IF v_membership IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: not an active member of shop %', p_shop_id;
  END IF;

  INSERT INTO user_active_shops (user_id, shop_id, updated_at)
  VALUES (v_actor, p_shop_id, now())
  ON CONFLICT (user_id) DO UPDATE SET shop_id = EXCLUDED.shop_id, updated_at = now();

  SELECT s.name INTO v_name FROM shops s WHERE s.id = p_shop_id;

  RETURN jsonb_build_object(
    'success', true,
    'active_shop_id', p_shop_id,
    'shop_name', v_name,
    'membership_role', v_role,
    'membership_id', v_membership
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_active_shop(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_active_shop(uuid) TO authenticated;

COMMENT ON FUNCTION public.set_active_shop(uuid) IS
  'Switches the shop the caller is working in. Rejects any shop the caller has no active membership in; every tenant read and write follows it.';

-- ── 4. The caller's own shops (what a switcher needs) ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_shops()
RETURNS TABLE (
  shop_id uuid,
  name text,
  membership_role membership_role,
  membership_status membership_status,
  is_current boolean
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT m.tenant_id,
         s.name::text,
         m.role,
         m.status,
         (m.tenant_id = public.current_shop_id())
    FROM memberships m
    JOIN shops s ON s.id = m.tenant_id
   WHERE m.user_id = app_current_user_id()
   ORDER BY (m.tenant_id = public.current_shop_id()) DESC, s.name ASC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_shops() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_shops() TO authenticated;

COMMENT ON FUNCTION public.get_my_shops() IS
  'Every shop the caller is a member of, with the role held in each and which one is active. The caller''s own memberships only.';

-- ── 5. Approving a shop registration without duplicating the account ──────────
CREATE OR REPLACE FUNCTION public.approve_shop_request(request_id uuid, admin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid := app_current_user_id();
  req_record RECORD;
  v_shop uuid;
  v_user_id uuid;
  v_existing uuid;
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

  -- A phone that already answers for an account is ATTACHED to the new shop. The old path
  -- inserted a second `users` row for the same phone and died on users_phone_key, so the
  -- owner who wanted another shop was the one person who could never get one.
  SELECT u.id INTO v_existing
    FROM users u
   WHERE public.canonical_phone(u.phone) = public.canonical_phone(req_record.phone)
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    v_shop := public.create_shop_internal(req_record.shop_name, v_existing);
    v_user_id := v_existing;

    UPDATE shop_requests SET status = 'approved', reviewed_at = now(), reviewed_by = COALESCE(v_actor, admin_id) WHERE id = request_id;

    RETURN jsonb_build_object(
      'success', true,
      'shop_id', v_shop,
      'user_id', v_user_id,
      'attached_existing_account', true
    );
  END IF;

  -- A new phone: the shop first, then the account whose home shop it is. The 0113 trigger
  -- creates the owner membership from the users row.
  v_shop := public.create_shop_internal(req_record.shop_name, NULL);

  v_user_id := gen_random_uuid();
  INSERT INTO users (
    id, name, phone, role, is_original_owner, is_active,
    employee_number, shop_id, created_by
  ) VALUES (
    v_user_id, req_record.owner_name, req_record.phone, 'admin', true, true,
    'EMP-001', v_shop, COALESCE(v_actor, admin_id)
  );
  UPDATE shops SET owner_id = v_user_id WHERE id = v_shop;

  UPDATE shop_requests SET status = 'approved', reviewed_at = now(), reviewed_by = COALESCE(v_actor, admin_id) WHERE id = request_id;

  RETURN jsonb_build_object(
    'success', true,
    'shop_id', v_shop,
    'user_id', v_user_id
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_shop_request(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_shop_request(uuid, uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.approve_shop_request(uuid, uuid) IS
  'Platform approval of a shop registration. Creates the shop (branch, role templates, owner membership) and attaches it to the existing account for that phone, or creates the account when the phone is new.';
