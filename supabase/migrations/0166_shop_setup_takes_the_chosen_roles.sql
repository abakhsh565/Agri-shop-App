-- ═══════════════════════════════════════════════════════════════════════════════
-- 0166 — a shop is created with THE ROLES THE OWNER CHOSE
--
-- Until now, provisioning a shop always copied every system role template it could find
-- (0164: the shop carrying the most of them). That is right for the two automated callers —
-- a registration and an approved shop request have nobody standing there to choose — but it
-- is wrong for the owner who is *setting up* a shop: the flow asks which roles this shop
-- starts with, and the answer has to mean something.
--
-- So `create_shop_internal` grows a third parameter:
--
--   p_role_ids IS NULL   → unchanged. Every system template, from the shop that still
--                          carries the most of them. This is what approve_shop_request and
--                          the registration path keep getting, and what a client that does
--                          not know about the flow still gets.
--   p_role_ids = '{}'    → a shop with no roles. A deliberate answer, not a mistake: an
--                          owner who unticked everything asked for an empty slate.
--   p_role_ids = '{…}'   → exactly those roles, in that shop's own set, with their
--                          descriptions, their built-in flag and their permission codes.
--
-- SECURITY. `p_role_ids` is caller-supplied ids, which is the shape of bug that turns a
-- parameter into a data leak: without a check, a caller could name any `roles.id` in the
-- database and have it copied into a shop they own — reading another tenant's role names and
-- permissions through a write. So every id must resolve to a role in the shop the caller is
-- WORKING IN (`current_shop_id()`, i.e. `resolve_active_shop`, the same answer the rest of
-- the app scopes by since 0149), and the caller must be an owner/admin of it — the same
-- authority the flow already requires, checked by `app_is_admin()` inside the writer.
--
-- The count is compared on DISTINCT ids on both sides, so a repeated id in the array is
-- deduplicated rather than reported as an unauthorized role.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The writer takes the roles to seed ──────────────────────────────────────
-- Dropped rather than replaced: a second parameter on an existing function is a NEW
-- overload, and `create_shop_internal(name, owner)` would then keep resolving to the old
-- two-argument body — the selection would be silently ignored. Dropping first leaves exactly
-- one function, and the DEFAULT keeps every existing two-argument call working.
DROP FUNCTION IF EXISTS public.create_shop_internal(text, uuid);

CREATE OR REPLACE FUNCTION public.create_shop_internal(
  p_name text,
  p_owner_id uuid DEFAULT NULL,
  p_role_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_shop uuid;
  v_template uuid;
  v_role record;
  v_new_role uuid;
BEGIN
  -- The one lock on this write. The two automated callers (create_shop_for_me,
  -- approve_shop_request) are already guarded, and this function is EXECUTE-revoked from
  -- every client role; this is the guard that keeps the *writing* function safe on its own,
  -- including for any future caller. A trusted context (service role, migration, direct SQL)
  -- is not a person and is allowed.
  IF NOT (is_trusted_context() OR app_is_admin()) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: creating a shop requires an owner or admin of an existing shop';
  END IF;

  INSERT INTO shops (id, name, owner_id)
  VALUES (gen_random_uuid(), p_name, p_owner_id)
  RETURNING id INTO v_shop;

  -- Branch first: the branch-stamping trigger (0119) resolves a new record's branch through
  -- default_branch_id(tenant), and a shop with no branch would stamp NULL.
  INSERT INTO branches (tenant_id, name, is_default, is_active)
  VALUES (v_shop, p_name || ' - Main', true, true);

  IF p_role_ids IS NULL THEN
    -- Nobody chose. The four system role templates this app defines, taken from the shop that
    -- already carries them (oldest first, so the set is deterministic). Preferred source: the
    -- shop that still carries the MOST of them, so deleting a role from the oldest shop does
    -- not quietly shrink what the next shop is created with.
    SELECT r.tenant_id INTO v_template
      FROM roles r
     WHERE r.is_system
     GROUP BY r.tenant_id
     ORDER BY count(*) DESC, min(r.created_at) ASC
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
  ELSIF cardinality(p_role_ids) > 0 THEN
    -- The chosen roles — but only ones that are actually the caller's to copy. This is the
    -- whole of the authorization for the parameter: the ids must all be roles of the shop the
    -- caller is working in, which is the shop `app_is_admin()` just checked them against.
    IF (
      SELECT count(DISTINCT r.id) FROM roles r
       WHERE r.id = ANY(p_role_ids) AND r.tenant_id = public.current_shop_id()
    ) <> (
      SELECT count(DISTINCT x) FROM unnest(p_role_ids) AS x
    ) THEN
      RAISE EXCEPTION 'NOT_AUTHORIZED: every chosen role must belong to the shop you are working in';
    END IF;

    FOR v_role IN
      SELECT * FROM roles r WHERE r.id = ANY(p_role_ids) ORDER BY r.name
    LOOP
      -- `is_system` is copied as it stands: a role this app defines stays a built-in in the new
      -- shop, and a role the owner wrote stays custom there. Marking every copy a template
      -- would put a "Built-in" badge on a Cashier role somebody invented this morning, and the
      -- badge is the screen's way of saying "this came with the app".
      INSERT INTO roles (tenant_id, name, description, is_system)
      VALUES (v_shop, v_role.name, v_role.description, v_role.is_system)
      RETURNING id INTO v_new_role;

      INSERT INTO role_permissions (role_id, permission_id)
      SELECT v_new_role, rp.permission_id FROM role_permissions rp WHERE rp.role_id = v_role.id;
    END LOOP;
  END IF;
  -- p_role_ids = '{}' falls through: a shop with a branch and no roles, which is what was asked
  -- for. It is still a working shop — the owner's membership below is what gives them access,
  -- and a role can be added from Roles & Access at any time.

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
REVOKE ALL ON FUNCTION public.create_shop_internal(text, uuid, uuid[]) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.create_shop_internal(text, uuid, uuid[]) IS
  'Provisions a shop with its default branch, its role templates and (optionally) an owner membership. p_role_ids NULL copies every system template; an empty array copies none; otherwise exactly those roles, each of which must belong to the shop the caller is working in. Internal: owner/admin or trusted context only, and EXECUTE-revoked from every client role.';

-- ── 2. The owner-facing entry point passes the selection through ────────────────
-- Same drop-then-create reason as above: `create_shop_for_me(name)` would otherwise keep
-- resolving to the one-argument body and the selection would never reach the writer.
DROP FUNCTION IF EXISTS public.create_shop_for_me(text);

CREATE OR REPLACE FUNCTION public.create_shop_for_me(
  p_name text,
  p_role_ids uuid[] DEFAULT NULL
)
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
  -- owner-side app already requires. Employees do not get to provision businesses. The roles
  -- being copied are checked against the same shop inside the writer.
  IF NOT app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: creating a shop requires an owner or admin of an existing shop';
  END IF;

  v_shop := public.create_shop_internal(v_clean, v_actor, p_role_ids);

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
    'membership_role', 'owner',
    'role_count', COALESCE(cardinality(p_role_ids), 0)
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.create_shop_for_me(text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_shop_for_me(text, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.create_shop_for_me(text, uuid[]) IS
  'Creates an additional shop for the calling account (shop + branch + the chosen role templates + owner membership) and makes it the active shop. Owner/admin only; the chosen roles must belong to the shop the caller is working in.';

-- ── 3. Tell PostgREST the shapes changed ──────────────────────────────────────
-- Both functions were DROPPED and recreated with a new argument list, and PostgREST answers
-- `/rpc/<name>` from a cached signature. Without this the app's call resolves against the old
-- one and gets a flat 404 — which reads as "this feature does not exist" rather than "the
-- schema cache is stale", and is exactly how a working migration looks broken from the client.
NOTIFY pgrst, 'reload schema';
