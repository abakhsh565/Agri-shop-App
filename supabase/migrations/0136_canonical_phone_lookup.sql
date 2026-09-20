-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0136: one definition of "the same phone number"
-- ═══════════════════════════════════════════════════════════════════════════════
-- FINDING (QA, reproduced)
--   Sign-in resolves the app profile with a canonical number: src/lib/auth.ts
--   normalizes to e164 (03007799911 → 923007799911) and calls
--   lookup_user_by_phone with THAT. The lookup itself only compared raw strings
--   (u.phone = p_phone OR u.phone = '+' || p_phone), so an employee whose row
--   held a local-format number could never be found — the invitee typed their
--   correct code and was told "this number isn't registered with any shop".
--
--   The app's own invitation flow stores normalizePhone(phone), so today's UI
--   path happens to agree; any row created by an import, a migration, or a
--   direct API caller (create_employee trusts its caller for format) is
--   unreachable. This closes the whole class rather than the one instance.
--
-- WHY A HELPER
--   The same normalization is needed by the lookup and by the login provisioner
--   (0135). Writing the expression twice is how the two drift apart, which is
--   what caused this in the first place. One IMMUTABLE definition, used by both.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.canonical_phone(p_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN regexp_replace(COALESCE(p_phone,''), '\D', '', 'g') = '' THEN NULL
    WHEN regexp_replace(p_phone, '\D', '', 'g') LIKE '0%'
      THEN '92' || substr(regexp_replace(p_phone, '\D', '', 'g'), 2)
    WHEN regexp_replace(p_phone, '\D', '', 'g') LIKE '92%'
      THEN regexp_replace(p_phone, '\D', '', 'g')
    ELSE '92' || regexp_replace(p_phone, '\D', '', 'g')
  END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- The lookup matches on the canonical form, on BOTH sides
-- ─────────────────────────────────────────────────────────────────────────────
-- Semantics otherwise unchanged: same fields returned, still SECURITY DEFINER,
-- still resolves the membership without a status filter so an invited employee
-- can see 'pending' and activate it (0133).
CREATE OR REPLACE FUNCTION public.lookup_user_by_phone(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user jsonb;
  v_membership jsonb;
  v_canonical text := public.canonical_phone(p_phone);
BEGIN
  SELECT jsonb_build_object(
    'id', u.id,
    'name', u.name,
    'phone', u.phone,
    'role', u.role,
    'is_original_owner', u.is_original_owner,
    'is_active', u.is_active,
    'employee_number', u.employee_number,
    'job_title', u.job_title,
    'first_login_at', u.first_login_at,
    'last_login_at', u.last_login_at,
    'deactivated_at', u.deactivated_at,
    'deactivated_by', u.deactivated_by,
    'created_by', u.created_by,
    'created_at', u.created_at,
    'photo_url', u.photo_url,
    'shop_id', u.shop_id
  ) INTO v_user
  FROM users u
  WHERE v_canonical IS NOT NULL
    AND public.canonical_phone(u.phone) = v_canonical
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'tenant_id', m.tenant_id,
    'membership_id', m.id,
    'membership_role', m.role,
    'membership_status', m.status,
    'branch_scope', m.branch_scope
  ) INTO v_membership
  FROM memberships m
  WHERE m.user_id = (v_user->>'id')::uuid
  ORDER BY (m.status = 'active') DESC, m.created_at ASC
  LIMIT 1;

  IF v_membership IS NOT NULL THEN
    v_user := v_user || v_membership;
  END IF;

  RETURN v_user;
END; $function$;

REVOKE EXECUTE ON FUNCTION public.lookup_user_by_phone(text) FROM PUBLIC;
-- Still callable before a session exists: that is the whole point of this
-- function, and 0133 already relies on the anon grant.
GRANT EXECUTE ON FUNCTION public.lookup_user_by_phone(text) TO anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- The provisioner uses the same helper instead of its own copy
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provision_member_login(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant uuid;
  v_phone  text;
  v_e164   text;
  v_email  text;
  v_pass   text;
  v_name   text;
BEGIN
  v_tenant := authorize_business_action('employees.manage');

  SELECT name, phone INTO v_name, v_phone
    FROM users
   WHERE id = p_user_id AND shop_id = v_tenant;

  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'USER_NOT_FOUND_OR_NOT_AUTHORIZED';
  END IF;

  v_e164 := public.canonical_phone(v_phone);
  IF v_e164 IS NULL THEN
    RAISE EXCEPTION 'EMPLOYEE_PHONE_INVALID';
  END IF;
  v_email := 'user-' || v_e164 || '@agrishop.auth.local';
  v_pass  := 'AgriShop-' || v_e164 || '-2026!';

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
    UPDATE auth.users
       SET email               = v_email,
           encrypted_password  = extensions.crypt(v_pass, extensions.gen_salt('bf')),
           email_confirmed_at  = COALESCE(email_confirmed_at, now()),
           updated_at          = now()
     WHERE id = p_user_id;
    RETURN jsonb_build_object('provisioned', false, 'repaired', true, 'userId', p_user_id);
  END IF;

  INSERT INTO auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) VALUES (
    '00000000-0000-0000-0000-000000000000', p_user_id, 'authenticated', 'authenticated',
    v_email, extensions.crypt(v_pass, extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', ''
  );

  INSERT INTO auth.identities (
    id, user_id, provider_id, identity_data, provider,
    last_sign_in_at, created_at, updated_at
  ) VALUES (
    gen_random_uuid(), p_user_id, p_user_id::text,
    jsonb_build_object('sub', p_user_id::text, 'email', v_email),
    'email', now(), now(), now()
  );

  INSERT INTO audit_events (user_id, action, entity_type, entity_id, details)
  VALUES (app_current_user_id(), 'member_login_provisioned', 'user', p_user_id,
          jsonb_build_object('invited', true));

  RETURN jsonb_build_object('provisioned', true, 'userId', p_user_id, 'name', v_name);
END; $$;

GRANT EXECUTE ON FUNCTION public.provision_member_login(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.provision_member_login(uuid) FROM PUBLIC, anon;
