-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0197: a notification says which branch it happened in
-- ═══════════════════════════════════════════════════════════════════════════════
-- WHAT WAS WRONG — two faults wearing one face.
--
-- 1. A row could not name its branch. `notifications` carries `shop_id` (the business) and
--    nothing else, so "Ahmed sold this in Branch B" and "Fatima sold this in Branch A" were
--    the same row to every reader. The Notifications screen already has one tab per branch —
--    and they filter `n.shop_id === branch.id`, comparing a business id with a branch id.
--    Two id spaces never meet, so every branch tab was permanently empty and told the owner
--    the branch was quiet. The screen was not wrong about the rows it had; it could never
--    have had them. Measured on the live database before this migration:
--
--      select column_name from information_schema.columns
--       where table_name = 'notifications'   →  no `branch_id`
--      pg_policies                                          →  `shop_id = ANY (my_shop_ids())`
--
-- 2. Which rows an account may read was therefore decided by business membership alone
--    (0168). Two branches of one business share a `shop_id`, so a member scoped to Branch A
--    could read Branch B's shop-wide facts (a low-stock alert, a stock adjustment), and the
--    owner's "everything" view had no branch to group by.
--
-- THE FIX is the column the model was missing, stamped where the truth already exists, and a
-- read policy that folds the branch scope in the same way every other branch-scoped table in
-- this schema does (`allowed_branch_scope()` — see 0180, 0189): NULL for an owner, meaning
-- every branch; the member's own `branch_scope` for everyone else.
--
-- NOTHING IS RE-ATTRIBUTED. Rows written before this migration keep `branch_id IS NULL`,
-- which is the honest value: the database never asserted a branch for them. NULL rows stay
-- readable to exactly the accounts that could read them before, so no history disappears and
-- no history is invented into a branch it may never have happened in.
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS branch_id uuid;

-- A branch that goes away must not take its business's history with it: the row survives,
-- unattributed, exactly like the rows written before this migration.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_branch_id_fkey;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_branch_id_fkey
  FOREIGN KEY (branch_id) REFERENCES public.branches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_shop_branch_created
  ON public.notifications (shop_id, branch_id, created_at DESC);

-- ── The stamp: which branch, from the best source that can answer ──────────────
-- Not from the caller. A writer is the least reliable witness of where its own row belongs,
-- which is why `shop_id`, `actor_id` and `actor_name` were already stamped here — the branch
-- joins them rather than becoming a new field the client is trusted to set.
CREATE OR REPLACE FUNCTION public.notifications_stamp()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_entity_branch uuid;
  v_kind text := COALESCE(NEW.entity_type, NEW.kind);
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

  -- ── INSERT only, and this is not a detail ──────────────────────────────────
  -- Stamping on UPDATE would be a data-corruption bug with an innocent trigger: marking an
  -- old row read is an UPDATE (`markManyRead`), and a row written before 0197 has no branch,
  -- so "fill it in" would hang the reader's current branch on someone else's history — the
  -- owner's own branch, quietly, on every old row they touched. Attribution is decided once,
  -- when the event is written, and never again.
  IF TG_OP = 'INSERT' THEN
    -- The record's own branch first, the actor's working branch second — the same order of
    -- preference the audit trigger uses (0189), and for the same reason: a consequential
    -- record knows where it happened, while "the branch that was selected when this was
    -- written" is a weaker answer used only when the record cannot say.
    --
    -- Only some kinds can say. A sale and a purchase carry their own `branch_id` in the row
    -- the notification names. A return notification names the SALE it came from (that is what
    -- `notifyReturnProcessed` passes), so it is asked the same question as a sale. Everything
    -- else — a payment against a customer, a low-stock crossing, a stock adjustment — names a
    -- party or a product, not a branch, and is attributed to the branch the actor worked in.
    IF NEW.branch_id IS NULL AND NEW.entity_id IS NOT NULL THEN
      IF v_kind IN ('sale', 'return') THEN
        SELECT s.branch_id INTO v_entity_branch FROM public.sales s
         WHERE s.id = NEW.entity_id AND s.shop_id = NEW.shop_id;
      ELSIF v_kind = 'purchase' THEN
        SELECT p.branch_id INTO v_entity_branch FROM public.purchases p
         WHERE p.id = NEW.entity_id AND p.shop_id = NEW.shop_id;
      END IF;
    END IF;

    IF NEW.branch_id IS NULL THEN
      NEW.branch_id := COALESCE(v_entity_branch, public.current_branch_id());
    END IF;
  END IF;

  -- A branch belonging to another business is not an answer to "where did this happen": the
  -- row would name a branch it does not sit beside. Left unattributed rather than wrong, and
  -- the insert policy below refuses such a row outright for a non-owner.
  IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.branches b
     WHERE b.id = NEW.branch_id AND b.tenant_id = NEW.shop_id
  ) THEN
    NEW.branch_id := NULL;
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

-- ── Who may read which branch's rows ─────────────────────────────────────────
-- The business membership is still the outer bound (0168); the branch scope is now folded
-- into it. `allowed_branch_scope()` answers NULL for an owner — every branch they belong to —
-- and the member's own `branch_scope` for everybody else, so:
--
--   • the owner sees every branch of the business, which is what the Notifications screen's
--     all-branches view and its per-branch tabs both read;
--   • a member scoped to Branch A no longer reads Branch B's rows;
--   • an unattributed row (`branch_id IS NULL`) stays visible to the whole business, because
--     the database cannot say it belongs elsewhere and hiding it would lose a real event.
CREATE OR REPLACE FUNCTION public.notification_branch_visible(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT p_branch_id IS NULL
      OR public.allowed_branch_scope() IS NULL
      OR p_branch_id = ANY (public.allowed_branch_scope());
$$;
GRANT EXECUTE ON FUNCTION public.notification_branch_visible(uuid) TO authenticated;

DROP POLICY IF EXISTS notifications_select ON public.notifications;
DROP POLICY IF EXISTS notifications_insert ON public.notifications;
DROP POLICY IF EXISTS notifications_update ON public.notifications;

CREATE POLICY notifications_select ON public.notifications
  FOR SELECT TO authenticated
  USING (
    shop_id = ANY (public.my_shop_ids())
    AND public.notification_branch_visible(branch_id)
  );

-- The same bound on the way in, so a member scoped to Branch A cannot write a row claiming
-- Branch B even though the stamp would have kept it inside their own business.
CREATE POLICY notifications_insert ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (
    shop_id = ANY (public.my_shop_ids())
    AND public.notification_branch_visible(branch_id)
  );

CREATE POLICY notifications_update ON public.notifications
  FOR UPDATE TO authenticated
  USING (
    shop_id = ANY (public.my_shop_ids())
    AND public.notification_branch_visible(branch_id)
  )
  WITH CHECK (
    shop_id = ANY (public.my_shop_ids())
    AND public.notification_branch_visible(branch_id)
  );

COMMENT ON COLUMN public.notifications.branch_id IS
  'The operating branch this event happened in, stamped from the record itself where it has one. NULL means the database never asserted a branch (every row written before 0197, and any event that names a party rather than a branch); such rows are readable by the whole business.';

-- PostgREST caches the schema and the function signatures. Without this the new column and
-- policy answer as if they did not exist until the cache happens to expire.
NOTIFY pgrst, 'reload schema';
