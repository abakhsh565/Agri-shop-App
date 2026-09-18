-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0096: Enhance lookup_user_by_phone with membership context
-- ═══════════════════════════════════════════════════════════════════════════════
-- SAFETY: Additive only. Returns additional fields. No existing behavior changed.
--
-- ROOT CAUSE: lookup_user_by_phone did not return shop_id or membership info.
-- The frontend had no way to resolve tenant context during login, causing
-- every RPC that needed shop_id to fail silently.
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION lookup_user_by_phone(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  v_user jsonb;
  v_membership jsonb;
BEGIN
  -- Step 1: Look up user profile (same as before, but with shop_id + photo_url)
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

  -- Step 2: Look up active membership (resolves tenant context)
  SELECT jsonb_build_object(
    'tenant_id', m.tenant_id,
    'membership_id', m.id,
    'membership_role', m.role,
    'membership_status', m.status,
    'branch_scope', m.branch_scope
  ) INTO v_membership
  FROM memberships m
  WHERE m.user_id = (v_user->>'id')::uuid
    AND m.status = 'active'
  ORDER BY m.created_at ASC
  LIMIT 1;

  -- Step 3: Merge membership into user object
  IF v_membership IS NOT NULL THEN
    v_user := v_user || v_membership;
  END IF;

  RETURN v_user;
END;
$$;

-- No changes to GRANTs needed — already granted to anon + authenticated
