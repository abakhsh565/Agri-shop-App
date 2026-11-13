-- 0301 — New-shop creation survives the customer-defaults trigger.
--
-- WHY THIS EXISTS. 0285 added an AFTER INSERT trigger on roles
-- (grant_customer_defaults_to_role) that pre-grants every new role the
-- customer defaults (customers.create, customers.edit, customers.payments).
-- create_shop_internal (0166) copies the system role templates into a new
-- shop with a plain INSERT INTO role_permissions ... SELECT, no ON CONFLICT
-- clause — so the copy re-inserts a pair the trigger just granted and the
-- whole shop creation rolls back on a unique violation. This is a live
-- product regression, not just a test failure: create_shop_for_me (the
-- registration path) and approve_shop_request (0167) both call this
-- function, so every new-shop creation through the app fails the same way.
-- The accountDeletion suite caught it (approve_shop_request returning the
-- duplicate-key error); 0277's ensure_shop_default_roles already uses
-- ON CONFLICT DO NOTHING on its grant inserts for exactly this reason.
--
-- WHAT THIS DOES. Restates create_shop_internal byte-for-byte from 0166
-- with ONE change on each of its two grant-copy INSERTs: ON CONFLICT DO
-- NOTHING. The result is the union the caller intended (trigger defaults
-- plus template grants), and no pair is ever inserted twice. Nothing else
-- changes: the role selection, the authorization check, the branch, and
-- the owner membership are exactly as 0166 wrote them.
--
-- WHY IT IS SAFE TO APPLY. CREATE OR REPLACE FUNCTION keeps the existing
-- grants (revoked from PUBLIC, anon, authenticated — the function is
-- server-side only). A skipped duplicate is a pair the new role already
-- holds from the trigger, so no permission is lost and none is added.

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
        SELECT v_new_role, rp.permission_id FROM role_permissions rp WHERE rp.role_id = v_role.id
        ON CONFLICT DO NOTHING;
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
      SELECT v_new_role, rp.permission_id FROM role_permissions rp WHERE rp.role_id = v_role.id
      ON CONFLICT DO NOTHING;
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

NOTIFY pgrst, 'reload schema';

-- Assertion: the grant-copy INSERTs are conflict-safe now.
DO $$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_shop_internal';
  IF v_def IS NULL OR v_def NOT LIKE '%ON CONFLICT DO NOTHING%' THEN
    RAISE EXCEPTION '0301: create_shop_internal still copies grants without ON CONFLICT DO NOTHING';
  END IF;
END $$;
