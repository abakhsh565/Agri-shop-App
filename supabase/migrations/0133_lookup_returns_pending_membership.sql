-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0133: the sign-in lookup must be able to SEE a pending membership
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROOT CAUSE (found in a real browser walkthrough of an invitation):
--
--   lookup_user_by_phone() only merged membership data when
--   `m.status = 'active'`. For an invited employee — whose membership 0129 sets
--   to 'pending' — the row was therefore missing from the returned object
--   entirely, and the client fell back to its default for a missing status:
--   "active". So complete_member_onboarding() was never called: signing in with
--   an invitation left the membership 'pending' forever, which every
--   authorization path rejects. The employee could authenticate and then do
--   nothing, for no visible reason.
--
-- FIX: return the caller's own membership regardless of status, preferring an
-- active one when a user has several. The sign-in path needs to know that the
-- invite is pending *because that is what activates it*.
--
-- SECURITY: unchanged in kind. The function still returns one row selected by
-- the caller-supplied phone number, and only that same user's membership. It
-- answers "what is my status" — it grants nothing: authorization continues to
-- require status = 'active' (RLS + every business RPC), and
-- complete_member_onboarding() still only moves the CALLER'S OWN membership
-- from 'pending' to 'active' using their JWT.
--
-- Grants are preserved (anon must be able to call this: it runs before a session
-- exists).

CREATE OR REPLACE FUNCTION public.lookup_user_by_phone(p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user jsonb;
  v_membership jsonb;
BEGIN
  -- Step 1: Look up user profile
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
  WHERE u.phone = p_phone OR u.phone = '+' || p_phone
  LIMIT 1;

  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  -- Step 2: Look up the membership (resolves tenant context).
  -- NO status filter: an invited employee must see 'pending' so that their first
  -- verified sign-in can activate it. An active membership still wins when a
  -- user has more than one.
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

  -- Step 3: Merge membership into user object
  IF v_membership IS NOT NULL THEN
    v_user := v_user || v_membership;
  END IF;

  RETURN v_user;
END;
$function$;
