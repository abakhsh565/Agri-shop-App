-- The pre-login account lookup answers for the number only.
--
-- WHY. `lookup_user_by_phone` is anon-callable by design: `checkPhoneRegistration` asks it BEFORE a
-- code is sent, to decide which door a number belongs at, and 0149 grants `anon` its EXECUTE for
-- that reason. It answered with the whole account — measured on the deployed definition, **21
-- fields**: the identifiers and metadata the signed-in app needs (`tenant_id`, `membership_id`,
-- `membership_role`, `membership_status`, `branch_scope`, `shop_id`), the employment record
-- (`employee_number`, `job_title`, `is_original_owner`, `created_by`, `deactivated_by`), the
-- lifecycle stamps (`first_login_at`, `last_login_at`, `deactivated_at`, `created_at`), the
-- profile photo (`photo_url`), and the identity itself (`id`, `name`, `phone`, `role`, `is_active`).
-- The pre-session caller consumes exactly two of them: `checkPhoneRegistration` reads `is_active`
-- and `role` (`src/lib/auth.ts`), and nothing else on the pre-login path reads this answer at all.
-- So a caller who typed a phone number could read that person's job title, employee number, photo
-- URL, tenant, branch scope and login history before authenticating.
--
-- WHAT THIS CHANGES. The answer is scoped to the identity the caller has PROVED:
--
--   * unauthenticated (or authenticated as somebody else) → `{is_active, role}`, the door answer;
--     `NULL` still means "this number has no account", which is how the client tells the two apart;
--   * authenticated as the account being looked up → the full row, exactly as before. This is the
--     path the sign-in flow reaches after its session exists (`verifyOtp` → the profile read, and
--     `resumeSession`), and it is what the client's `userFromRow` needs to build a working session.
--
-- The branch key is `public.app_current_user_id()` — the JWT subject, which in this schema IS
-- `users.id` (`current_shop_id()` resolves through it). No new endpoint, no new grant, no change to
-- who may call it: the same callers get an answer narrowed to what their own proof covers. The
-- deactivation rule is untouched and still decided from `is_active` alone, before any session is
-- minted, so a closed account is refused exactly as it was.
--
-- WHY THE BODY IS SHAPED LIKE THIS — the 0200 lesson, applied in advance. This function is
-- `CREATE OR REPLACE`d on a lineage that may not have everything this body could name. Measured:
-- the deployed/staging schema has `canonical_phone(text)`, `resolve_active_shop(uuid)` and a
-- `memberships` table; production's has **none of the three**, and carries an older, 14-field body
-- of this same function that compares `u.phone` directly. Naming those objects unguarded would
-- therefore raise at the first call on production (`function public.canonical_phone(text) does not
-- exist`), and a create-time replay cannot see it, because PL/pgSQL resolves references at
-- execution. So every reference that one lineage lacks sits in its own branch behind
-- `to_regprocedure` / `to_regclass`, and the full answer is built from the same `users` columns both
-- lineages have (verified column by column). Unreached PL/pgSQL statements are never compiled, which
-- is what makes the branches safe.
--
-- The pin is kept: 0177 measures that every SECURITY DEFINER function carries `search_path`.

CREATE OR REPLACE FUNCTION public.lookup_user_by_phone(p_phone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_user jsonb;
  v_membership jsonb;
  v_user_id uuid;
BEGIN
  IF to_regprocedure('public.canonical_phone(text)') IS NOT NULL THEN
    -- The newer lineage stores a canonical form and knows how to produce it.
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
    FROM public.users u
    WHERE public.canonical_phone(p_phone) IS NOT NULL
      AND public.canonical_phone(u.phone) = public.canonical_phone(p_phone)
    LIMIT 1;
  ELSE
    -- The older lineage has no canonical form; it matches the number as stored, which is what its
    -- own body did. This branch reproduces that comparison rather than inventing one.
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
    FROM public.users u
    WHERE u.phone = p_phone OR u.phone = '+' || p_phone
    LIMIT 1;
  END IF;

  -- No account for this number. Still NULL, which is the client's "not registered" signal.
  IF v_user IS NULL THEN
    RETURN NULL;
  END IF;

  v_user_id := (v_user->>'id')::uuid;

  -- ── The scope ────────────────────────────────────────────────────────────────────────────────
  -- Everything below this line answers for the signed-in owner of the account. A caller who has
  -- not proved that identity — an anonymous one, or one authenticated as somebody else — leaves
  -- with the door answer: whether the account is open, and the role the sign-in door keys off.
  IF public.app_current_user_id() IS DISTINCT FROM v_user_id THEN
    RETURN jsonb_build_object(
      'is_active', (v_user->>'is_active')::boolean,
      'role', v_user->>'role'
    );
  END IF;

  IF to_regclass('public.memberships') IS NOT NULL
     AND to_regprocedure('public.resolve_active_shop(uuid)') IS NOT NULL THEN
    SELECT jsonb_build_object(
      'tenant_id', m.tenant_id,
      'membership_id', m.id,
      'membership_role', m.role,
      'membership_status', m.status,
      'branch_scope', m.branch_scope
    ) INTO v_membership
    FROM public.memberships m
    WHERE m.user_id = v_user_id
    -- The active shop first, then an active membership, then the oldest row: an invited employee
    -- still sees 'pending' and can activate it (0133).
    ORDER BY (m.tenant_id = public.resolve_active_shop(v_user_id)) DESC,
             (m.status = 'active') DESC,
             m.created_at ASC
    LIMIT 1;

    IF v_membership IS NOT NULL THEN
      v_user := v_user || v_membership;
    END IF;
  END IF;

  RETURN v_user;
END;
$function$;

COMMENT ON FUNCTION public.lookup_user_by_phone(text) IS
  'Account lookup by phone, callable before a session exists (anon). An unauthenticated caller — or one authenticated as somebody else — receives only {is_active, role}, the door answer the sign-in gate needs; the full profile (identity, employment record, identification fields, membership and tenant context) is returned only to a caller authenticated as the account being looked up. NULL means the number has no account.';

-- The ACL 0149 established, re-stated so the ledger owns it: `anon` because the gate asks before a
-- code is sent, `authenticated` because every signed-in read of a profile goes through it. PUBLIC
-- keeps its default EXECUTE (CREATE OR REPLACE preserves it), exactly as the deployed catalogs
-- report. Nothing is widened here, and nothing is revoked.
GRANT EXECUTE ON FUNCTION public.lookup_user_by_phone(text) TO anon;
GRANT EXECUTE ON FUNCTION public.lookup_user_by_phone(text) TO authenticated;
