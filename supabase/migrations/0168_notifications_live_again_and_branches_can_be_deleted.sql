-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0168: notifications speak again, and a branch can be deleted
-- ═══════════════════════════════════════════════════════════════════════════════
-- FINDING 1 (measured on the live database, not read from a file)
--
--   `notifications` on the live database is an OLDER SHAPE than the one this app
--   writes to. It has:
--
--       id, kind, title, message, entity_type, entity_id, is_read, shop_id, created_at
--
--   Every writer in the app — `src/lib/notifications.ts` (`createNotification`),
--   `InventoryAdjustPage`, the offline queue, and the database's own
--   `void_sale_v1` — inserts:
--
--       (kind, title, body, entity_id, actor_id, actor_name)
--
--   Four of those columns do not exist, so EVERY insert answers 400 and the row
--   is never written: not on a sale, not on a payment, not on a low-stock cross,
--   not on a stock adjustment, and not on a void (which fails whole, because the
--   insert is inside void_sale_v1's transaction). The reader
--   (`src/stores/notificationStore.ts`) then asks for `read`, which also does not
--   exist, and filters on `actor_id`, which is undefined — which is why an
--   employee's bell showed nothing even when rows did exist.
--
--   So "notifications stopped working" is not a regression in the rules. The
--   rules were never reachable: the table they write to lost the columns they
--   write, and nobody noticed because a failed notification is swallowed as
--   best-effort.
--
--   This migration gives the table the columns the app actually uses, backfills
--   them from the legacy names so no existing row is lost, and keeps the two
--   spellings in step with a trigger — a legacy writer through `message` /
--   `is_read` cannot silently produce an unreadable row again.
--
-- FINDING 2 (measured): `notifications_select` / `_insert` / `_update` are all
--   `USING (true)` / `WITH CHECK (true)`. With one tenant that was harmless;
--   with several branches it is a cross-branch leak — every account can read
--   every branch's events, and can insert a row claiming any branch. The policy
--   is now the membership: a row is visible exactly to the accounts that are
--   active members of the shop that owns it. An owner is a member of all their
--   branches, so the owner still sees every branch (which is what the
--   Notifications screen now groups), and an employee sees only their own shop.
--
-- FINDING 3: there was no way to delete a branch. `purge_shop_data` existed for
--   `delete_my_account`, and it is incomplete for a standalone branch delete:
--
--     • `users.shop_id` is NO ACTION, so an employee homed in the branch blocks
--       the shops row from being deleted at all;
--     • `barcode_registry`, `barcode_history`, `reminder_configs`,
--       `reminder_logs` and `reminder_occurrences` carry a `shop_id` with NO
--       foreign key to `shops`, so `purge_shop_data` never reached them — a
--       deleted branch would leave orphan rows behind;
--     • `sales.employee_id`, `voids.voided_by` and
--       `cash_reconciliations.reconciled_by` are NOT NULL, so an employee with
--       history outside the branch cannot simply be deleted.
--
--   This migration adds `purge_branch_data` (the complete erase), `delete_branch`
--   (the authorized, whole-branch erase that re-homes or revokes the people who
--   worked there), `rename_branch` and `get_my_branches` (what the Branches
--   screen reads).
--
-- NOTHING IS MOVED between branches. A delete erases rows whose `shop_id` is the
--   deleted branch and nothing else; the main branch and every other branch keep
--   every row they had.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The columns the app already writes ──────────────────────────────────────
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS body       text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS actor_id   uuid;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS actor_name text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS read       boolean NOT NULL DEFAULT false;
-- The legacy half, added only where it is genuinely missing.
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS message     text;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS is_read     boolean NOT NULL DEFAULT false;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS entity_type varchar;

-- Backfill: the legacy spelling is the older truth, so it wins where the newer
-- column is empty. Nothing is dropped, and no row is lost.
UPDATE public.notifications
   SET body   = COALESCE(body, message),
       message = COALESCE(message, body),
       read   = COALESCE(read, is_read, false),
       is_read = COALESCE(is_read, read, false)
 WHERE body IS DISTINCT FROM message OR read IS DISTINCT FROM is_read;

-- A notification belongs to the shop that owns it, so a branch delete can never
-- be blocked by one, and no row can outlive its branch.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_shop_id_fkey;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_shop_id_fkey
  FOREIGN KEY (shop_id) REFERENCES public.shops(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_notifications_shop_created
  ON public.notifications (shop_id, created_at DESC);

-- ── 2. One shape, whichever spelling a writer uses ────────────────────────────
-- A trigger rather than a convention, because the writers are not all in one
-- place: a legacy `message`/`is_read` insert and a current
-- `body`/`read` insert must produce the same readable row. It also stamps the
-- two facts the writer must not be trusted to state: which shop owns the row,
-- and who caused it.
CREATE OR REPLACE FUNCTION public.notifications_stamp()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.shop_id IS NULL THEN
    NEW.shop_id := public.current_shop_id();
  END IF;

  IF NEW.actor_id IS NULL THEN
    NEW.actor_id := public.app_current_user_id();
  END IF;
  IF NEW.actor_name IS NULL AND NEW.actor_id IS NOT NULL THEN
    SELECT u.name INTO NEW.actor_name FROM users u WHERE u.id = NEW.actor_id;
  END IF;

  -- Either spelling fills the other, in both directions.
  IF NEW.body IS NULL THEN NEW.body := NEW.message; END IF;
  IF NEW.message IS NULL THEN NEW.message := NEW.body; END IF;
  IF NEW.entity_type IS NULL THEN NEW.entity_type := NEW.kind; END IF;

  IF TG_OP = 'INSERT' THEN
    -- `read` is the app's column and carries the default; `is_read` follows it.
    NEW.is_read := COALESCE(NEW.read, NEW.is_read, false);
  ELSE
    -- On an update, whichever one the writer changed is the answer.
    IF NEW.read IS DISTINCT FROM OLD.read THEN NEW.is_read := NEW.read;
    ELSIF NEW.is_read IS DISTINCT FROM OLD.is_read THEN NEW.read := NEW.is_read;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_stamp ON public.notifications;
CREATE TRIGGER notifications_stamp
  BEFORE INSERT OR UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.notifications_stamp();

-- ── 3. The shops this account is an active member of ──────────────────────────
-- A SECURITY DEFINER helper rather than an inline subquery on `memberships`: the
-- policy then cannot be affected by that table's own policies, and the answer is
-- one definition used by every branch of this policy.
CREATE OR REPLACE FUNCTION public.my_shop_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT COALESCE(array_agg(m.tenant_id), '{}'::uuid[])
    FROM memberships m
   WHERE m.user_id = public.app_current_user_id()
     AND m.status = 'active';
$$;
GRANT EXECUTE ON FUNCTION public.my_shop_ids() TO authenticated;

-- ── 4. The membership IS the read scope ───────────────────────────────────────
DROP POLICY IF EXISTS notifications_select ON public.notifications;
DROP POLICY IF EXISTS notifications_read   ON public.notifications;
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
DROP POLICY IF EXISTS notifications_update ON public.notifications;
DROP POLICY IF EXISTS notifications_delete ON public.notifications;

-- An owner is an active member of every branch they own, so this policy gives the
-- owner all branches and an employee only their own shop. Nothing is widened for
-- writing: a row can only ever be created for a shop the writer belongs to.
CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (shop_id = ANY (public.my_shop_ids()));

CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (shop_id = ANY (public.my_shop_ids()));

CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (shop_id = ANY (public.my_shop_ids()))
  WITH CHECK (shop_id = ANY (public.my_shop_ids()));

-- ── 5. Every branch this account can manage, and what is in it ─────────────────
-- One read for the whole Branches screen: which branch is the main one, which is
-- active, and the counts the delete step has to be able to state out loud. It
-- returns only the caller's own memberships.
CREATE OR REPLACE FUNCTION public.get_my_branches()
RETURNS TABLE (
  shop_id           uuid,
  name              text,
  membership_role   membership_role,
  membership_status membership_status,
  is_current        boolean,
  is_main           boolean,
  created_at        timestamptz,
  employee_count    int,
  product_count     int,
  customer_count    int,
  sales_count       int,
  sales_total       numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH me AS (
    SELECT (SELECT u.shop_id FROM users u WHERE u.id = app_current_user_id()) AS home
  )
  SELECT m.tenant_id,
         s.name::text,
         m.role,
         m.status,
         (m.tenant_id = public.current_shop_id()),
         (m.tenant_id = (SELECT home FROM me)),
         s.created_at,
         (SELECT count(*) FROM memberships  x WHERE x.tenant_id = m.tenant_id AND x.status = 'active')::int,
         (SELECT count(*) FROM products     p WHERE p.shop_id   = m.tenant_id)::int,
         (SELECT count(*) FROM customers    c WHERE c.shop_id   = m.tenant_id)::int,
         (SELECT count(*) FROM sales        v WHERE v.shop_id   = m.tenant_id)::int,
         (SELECT COALESCE(sum(v.total_amount), 0) FROM sales v WHERE v.shop_id = m.tenant_id)
    FROM memberships m
    JOIN shops s ON s.id = m.tenant_id
   WHERE m.user_id = app_current_user_id()
   -- The branch this account registered with reads first; the rest follow in the
   -- order they were created, so the list does not reshuffle between reads.
   ORDER BY (m.tenant_id = (SELECT home FROM me)) DESC, s.created_at ASC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_my_branches() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_branches() TO authenticated;

COMMENT ON FUNCTION public.get_my_branches() IS
  'Every branch (shop) the caller is a member of, the main one first, with the counts the Branches screen states before a delete. The caller''s own memberships only.';

-- ── 6. Renaming a branch ──────────────────────────────────────────────────────
-- The name lives on `shops.name`; the branch row the app creates alongside it is
-- kept in step, because `create_shop_internal` names it `<shop> - Main` and a
-- rename that left that behind would leave two different names for one branch.
CREATE OR REPLACE FUNCTION public.rename_branch(p_shop_id uuid, p_name text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor uuid := public.app_current_user_id();
  v_role  membership_role;
  v_clean text := trim(COALESCE(p_name, ''));
  v_old   text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;
  IF v_clean = '' THEN RAISE EXCEPTION 'VALIDATION: a branch name is required'; END IF;
  IF length(v_clean) > 120 THEN
    RAISE EXCEPTION 'VALIDATION: branch names are limited to 120 characters';
  END IF;

  -- Authority is stated twice on purpose, and both statements are needed. The first is the
  -- app-wide "is this an owner or an admin" gate every business write carries; the second
  -- is the one that actually decides, because it names THIS branch. A gate that only asked
  -- "are you an owner somewhere" would let an owner of one branch rename another's.
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or an admin can manage a branch';
  END IF;

  SELECT m.role INTO v_role
    FROM memberships m
   WHERE m.user_id = v_actor AND m.tenant_id = p_shop_id AND m.status = 'active';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: not an active member of this branch';
  END IF;
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or admin can rename a branch';
  END IF;

  SELECT s.name INTO v_old FROM shops s WHERE s.id = p_shop_id;
  IF v_old IS NULL THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;

  UPDATE shops SET name = v_clean WHERE id = p_shop_id;
  UPDATE branches b
     SET name = v_clean || ' - ' || CASE WHEN b.is_default THEN 'Main' ELSE 'Branch' END
   WHERE b.tenant_id = p_shop_id AND b.is_default;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'branch_renamed', 'shop', p_shop_id,
          jsonb_build_object('from', v_old, 'to', v_clean));

  RETURN jsonb_build_object('success', true, 'shop_id', p_shop_id, 'name', v_clean, 'previous_name', v_old);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.rename_branch(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rename_branch(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.rename_branch(uuid, text) IS
  'Renames one branch. Requires an active owner/admin membership in that branch; refuses an empty or over-long name.';

-- ── 7. The complete erase of one branch ───────────────────────────────────────
-- `purge_shop_data` (0147) covers the tables it was written for. It does not
-- reach the shop-scoped tables that carry no foreign key to `shops` — those rows
-- would survive as orphans of a branch that no longer exists, which is the exact
-- failure this step is meant to avoid. This runs first, then delegates.
CREATE OR REPLACE FUNCTION public.purge_branch_data(p_shop_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Shop-scoped, no FK to shops: nothing else was ever going to remove these.
  DELETE FROM barcode_history       WHERE shop_id = p_shop_id;
  DELETE FROM barcode_registry      WHERE shop_id = p_shop_id;
  DELETE FROM reminder_logs         WHERE shop_id = p_shop_id;
  DELETE FROM reminder_occurrences  WHERE shop_id = p_shop_id;
  DELETE FROM reminder_configs      WHERE shop_id = p_shop_id;

  -- The shop's own records, in the order 0147 already proved.
  PERFORM public.purge_shop_data(p_shop_id);
END;
$$;
REVOKE ALL ON FUNCTION public.purge_branch_data(uuid) FROM PUBLIC, anon, authenticated;

-- ── 8. Deleting a branch ──────────────────────────────────────────────────────
-- The whole operation is one transaction: either the branch and everything it
-- owned are gone and its people are resolved, or nothing changed at all.
CREATE OR REPLACE FUNCTION public.delete_branch(
  p_shop_id  uuid,
  p_reason   text DEFAULT NULL,
  p_feedback text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_actor       uuid := public.app_current_user_id();
  v_role        membership_role;
  v_name        text;
  v_home        uuid;
  v_fallback    uuid;
  v_staff       uuid[];
  v_gone        uuid[];
  /** The logins that keep working, in another branch. */
  v_keep_ids    uuid[];
  v_kept        int := 0;
  v_removed     int := 0;
  v_counts      jsonb;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  -- Authority is stated twice on purpose, and both statements are needed. The first is the
  -- app-wide "is this an owner or an admin" gate every business write carries; the second
  -- is the one that actually decides, because it names THIS branch. A gate that only asked
  -- "are you an owner somewhere" would let an owner of one branch delete another's.
  IF NOT public.app_is_admin() THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or an admin can manage a branch';
  END IF;

  SELECT m.role INTO v_role
    FROM memberships m
   WHERE m.user_id = v_actor AND m.tenant_id = p_shop_id AND m.status = 'active';
  IF v_role IS NULL THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: not an active member of this branch';
  END IF;
  IF v_role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED: only an owner or admin can delete a branch';
  END IF;

  SELECT s.name INTO v_name FROM shops s WHERE s.id = p_shop_id;
  IF v_name IS NULL THEN RAISE EXCEPTION 'BRANCH_NOT_FOUND'; END IF;

  -- The branch this account registered with is the main one. It is renamed, never
  -- deleted: there would be nowhere left for the account to live.
  SELECT u.shop_id INTO v_home FROM users u WHERE u.id = v_actor;
  IF v_home IS NOT NULL AND v_home = p_shop_id THEN
    RAISE EXCEPTION 'MAIN_BRANCH: the main branch cannot be deleted';
  END IF;

  -- Where this account lands afterwards: the main branch, else the oldest branch
  -- they still belong to.
  SELECT m.tenant_id INTO v_fallback
    FROM memberships m
    JOIN shops s ON s.id = m.tenant_id
   WHERE m.user_id = v_actor
     AND m.status = 'active'
     AND m.tenant_id <> p_shop_id
   ORDER BY (m.tenant_id = COALESCE(v_home, p_shop_id)) DESC, s.created_at ASC
   LIMIT 1;

  IF v_fallback IS NULL THEN
    RAISE EXCEPTION 'LAST_BRANCH: this is the only branch on this account';
  END IF;

  -- What the caller was told, counted inside the same transaction that removes it.
  -- `employees` is everyone EXCEPT the caller: the person confirming the delete is
  -- not one of the people who "lose access", and counting them would overstate it.
  SELECT jsonb_build_object(
           'employees', (SELECT count(*) FROM memberships x
                          WHERE x.tenant_id = p_shop_id AND x.status = 'active' AND x.user_id <> v_actor),
           'products',  (SELECT count(*) FROM products  p WHERE p.shop_id = p_shop_id),
           'customers', (SELECT count(*) FROM customers c WHERE c.shop_id = p_shop_id),
           'sales',     (SELECT count(*) FROM sales     v WHERE v.shop_id = p_shop_id),
           'sales_total',(SELECT COALESCE(sum(v.total_amount), 0) FROM sales v WHERE v.shop_id = p_shop_id)
         ) INTO v_counts;

  -- ── The people who worked in this branch ────────────────────────────────────
  SELECT array_agg(u.id) INTO v_staff
    FROM users u
   WHERE u.shop_id = p_shop_id
     AND u.id <> v_actor;

  IF v_staff IS NOT NULL THEN
    -- Who still has another branch to go to. They keep their login and their
    -- history, and only this branch's membership (which cascades with the shop)
    -- goes away.
    SELECT array_agg(u.id) INTO v_keep_ids
      FROM users u
     WHERE u.id = ANY (v_staff)
       AND EXISTS (
         SELECT 1 FROM memberships m
          WHERE m.user_id = u.id
            AND m.status = 'active'
            AND m.tenant_id <> p_shop_id
       );

    UPDATE users u
       SET shop_id = (
             SELECT m.tenant_id FROM memberships m
              WHERE m.user_id = u.id AND m.status = 'active' AND m.tenant_id <> p_shop_id
              ORDER BY (m.tenant_id = COALESCE(v_home, p_shop_id)) DESC
              LIMIT 1
           )
     WHERE u.id = ANY (v_keep_ids);

    -- Everyone else belongs to this branch alone. Their branch's records are about
    -- to be erased, so the login is removed with it.
    --
    -- The exception is a login that still carries records in ANOTHER branch
    -- (`sales.employee_id`, `voids.voided_by` and
    -- `cash_reconciliations.reconciled_by` are NOT NULL, so those rows cannot be
    -- detached): the profile row must stay for that history to remain valid. It is
    -- deactivated and left without a membership, so it grants no access to
    -- anything, and the credential is deleted so it cannot be signed into.
    SELECT array_agg(u.id) INTO v_gone
      FROM users u
     WHERE u.id = ANY (v_staff)
       AND u.id <> ALL (COALESCE(v_keep_ids, '{}'::uuid[]))
       AND NOT EXISTS (SELECT 1 FROM sales s WHERE s.employee_id = u.id AND s.shop_id <> p_shop_id)
       AND NOT EXISTS (SELECT 1 FROM voids v WHERE v.voided_by = u.id)
       AND NOT EXISTS (SELECT 1 FROM cash_reconciliations r WHERE r.reconciled_by = u.id);

    IF v_gone IS NOT NULL THEN
      UPDATE returns                    SET processed_by  = NULL WHERE processed_by  = ANY (v_gone);
      UPDATE inventory_movements        SET created_by    = NULL WHERE created_by    = ANY (v_gone);
      -- `customers.created_by` is varchar, not uuid (measured): compared as text, or
      -- this statement is a type error and takes the whole delete with it.
      UPDATE customers                  SET created_by    = NULL
                                         WHERE created_by IN (SELECT x::text FROM unnest (v_gone) x);
      UPDATE daily_cash_reconciliations SET reconciled_by = NULL WHERE reconciled_by = ANY (v_gone);
      UPDATE user_permissions           SET granted_by    = NULL WHERE granted_by    = ANY (v_gone);
      DELETE FROM activity_log     WHERE user_id = ANY (v_gone);
      DELETE FROM audit_events     WHERE user_id = ANY (v_gone);
      DELETE FROM user_permissions WHERE user_id = ANY (v_gone);
      DELETE FROM users      WHERE id = ANY (v_gone);
      DELETE FROM auth.users WHERE id = ANY (v_gone);
    END IF;

    -- Logins kept for their history but with no branch left: no membership (this
    -- branch's cascades away), not active, no credential. Nothing they can sign
    -- into, and nothing of another branch's history broken.
    UPDATE users u
       SET is_active = false,
           shop_id   = v_fallback
     WHERE u.id = ANY (v_staff)
       AND u.id <> ALL (COALESCE(v_keep_ids, '{}'::uuid[]))
       AND u.id <> ALL (COALESCE(v_gone, '{}'::uuid[]));

    DELETE FROM auth.users a
     WHERE a.id IN (
       SELECT u.id FROM users u
        WHERE u.id = ANY (v_staff)
          AND u.id <> ALL (COALESCE(v_keep_ids, '{}'::uuid[]))
          AND u.id <> ALL (COALESCE(v_gone, '{}'::uuid[]))
     );

    -- What the caller is told afterwards: how many people kept working, and how
    -- many logins were resolved with the branch. Counted from the ids, not from a
    -- query after the deletes — the deleted rows are already gone by now.
    v_kept    := COALESCE(cardinality(v_keep_ids), 0);
    v_removed := COALESCE(cardinality(v_staff), 0) - v_kept;
  END IF;

  -- ── The branch itself ───────────────────────────────────────────────────────
  -- This account stops working in a branch that is about to disappear, stated
  -- here so no client can hold a pointer at it.
  INSERT INTO user_active_shops (user_id, shop_id, updated_at)
  VALUES (v_actor, v_fallback, now())
  ON CONFLICT (user_id) DO UPDATE SET shop_id = EXCLUDED.shop_id, updated_at = now();

  PERFORM public.purge_branch_data(p_shop_id);

  -- Written after the erase, and against the fallback branch, because the audit
  -- row must outlive the branch it describes.
  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'branch_deleted', 'shop', p_shop_id,
          jsonb_build_object(
            'name', v_name,
            'reason', NULLIF(trim(COALESCE(p_reason, '')), ''),
            'feedback', NULLIF(trim(COALESCE(p_feedback, '')), ''),
            'erased', v_counts,
            'employees_kept', COALESCE(v_kept, 0),
            'employees_removed', COALESCE(v_removed, 0),
            'fallback_shop_id', v_fallback
          ));

  RETURN jsonb_build_object(
    'success', true,
    'shop_id', p_shop_id,
    'name', v_name,
    'erased', v_counts,
    'employees_kept', COALESCE(v_kept, 0),
    'employees_removed', COALESCE(v_removed, 0),
    'fallback_shop_id', v_fallback,
    'active_shop_id', v_fallback
  );
END;
$$;
REVOKE EXECUTE ON FUNCTION public.delete_branch(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_branch(uuid, text, text) TO authenticated;

COMMENT ON FUNCTION public.delete_branch(uuid, text, text) IS
  'Erases one branch completely — its records, its settings, its roles and its people''s access to it — inside one transaction. Refuses the main branch and the caller''s only branch. Employees who also belong to another branch keep their login; the rest lose theirs.';

-- PostgREST caches the schema and the function signatures. Without this the new
-- RPCs answer 404 from the client until the cache happens to expire.
NOTIFY pgrst, 'reload schema';
