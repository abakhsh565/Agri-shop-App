-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0125: Capture the acting user on writes that never recorded one
-- ═══════════════════════════════════════════════════════════════════════════════
-- DEFECT (found while repairing 0124's display columns):
--   Three write paths resolve the authenticated actor and then never persist it,
--   so the audit trail loses who performed the action:
--     create_purchase()          -> INSERT INTO purchases (...) omits recorded_by
--     record_customer_payment()  -> INSERT INTO customer_payments (...) omits recorded_by
--     record_supplier_payment()  -> INSERT INTO supplier_payments (...) omits recorded_by
--   Confirmed: `recorded_by_name` is stamped by NO function in the database, and
--   both existing purchases have recorded_by = null.
--
-- WHY A TRIGGER AND NOT AN EDIT TO THE THREE RPCs:
--   The actor is already resolved by all three (app_current_user_id() /
--   resolve_shop_and_actor), but relying on each path to remember to persist it
--   is exactly the fragility that produced this defect. Capturing it once, at
--   the table, means no current or future write path — RPC, import, integration
--   or test — can silently drop attribution. It also avoids transcribing three
--   financial RPC bodies, which would risk changing business logic.
--
-- SEMANTICS:
--   app_current_user_id() reads ONLY the authenticated JWT `sub`. In direct SQL
--   or a system/cron context it returns NULL, and the column is left NULL.
--   So this captures a real user action and never invents an actor.
--   Existing NULL actor values are NOT guessed: we cannot know who did it, and
--   inventing an attribution would corrupt the audit trail.
--
-- SCOPE: attribution/display integrity only. NOT an authorization mechanism.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Teach stamp_display_names() to first capture a missing actor
--    TG_ARGV[0] = display spec:  target_col:fk_col:source_table:source_name_col
--    TG_ARGV[1] = actor spec:    actor_fk_col:actor_name_col
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_display_names()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  spec       text := COALESCE(TG_ARGV[0], '');
  actor_spec text := COALESCE(TG_ARGV[1], '');
  part text;
  bits text[];
  a    text[];
  j    jsonb;
  val  text;
  v_actor uuid;
BEGIN
  j := to_jsonb(NEW);

  -- ── Step 1: capture the acting user when the write path did not ──
  IF actor_spec <> '' THEN
    a := string_to_array(btrim(actor_spec), ':');
    IF array_length(a, 1) = 2 AND (j ->> a[1]) IS NULL THEN
      v_actor := app_current_user_id();
      IF v_actor IS NOT NULL THEN
        j := jsonb_set(j, ARRAY[a[1]], to_jsonb(v_actor::text));
      END IF;
    END IF;
  END IF;

  -- ── Step 2: fill missing display names from their foreign key ──
  IF spec <> '' THEN
    FOREACH part IN ARRAY string_to_array(spec, ',') LOOP
      bits := string_to_array(btrim(part), ':');
      CONTINUE WHEN array_length(bits, 1) IS DISTINCT FROM 4;
      CONTINUE WHEN (j ->> bits[1]) IS NOT NULL;  -- already stamped: preserve history
      CONTINUE WHEN (j ->> bits[2]) IS NULL;      -- no FK: nothing authoritative to copy

      -- Compare as text: some FK columns are uuid, others (recorded_by) are
      -- varchar, while the referenced id is always uuid.
      EXECUTE format('SELECT %I FROM public.%I WHERE id::text = $1', bits[4], bits[3])
        INTO val USING j ->> bits[2];

      IF val IS NOT NULL THEN
        j := jsonb_set(j, ARRAY[bits[1]], to_jsonb(val));
      END IF;
    END LOOP;
  END IF;

  NEW := jsonb_populate_record(NEW, j);
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.stamp_display_names() IS
  'Attribution integrity: captures the JWT-authenticated actor when a write omits it, then fills NULL denormalized party names from their FK. Not an authorization mechanism.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Re-attach with the actor spec on the paths that never recorded one
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_stamp_display_names ON purchases;
CREATE TRIGGER trg_stamp_display_names
  BEFORE INSERT OR UPDATE ON purchases
  FOR EACH ROW EXECUTE FUNCTION public.stamp_display_names(
    'company_name:company_id:companies:name,recorded_by_name:recorded_by:users:name',
    'recorded_by:recorded_by_name'
  );

DROP TRIGGER IF EXISTS trg_stamp_display_names ON customer_payments;
CREATE TRIGGER trg_stamp_display_names
  BEFORE INSERT OR UPDATE ON customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_display_names(
    'recorded_by_name:recorded_by:users:name',
    'recorded_by:recorded_by_name'
  );

DROP TRIGGER IF EXISTS trg_stamp_display_names ON supplier_payments;
CREATE TRIGGER trg_stamp_display_names
  BEFORE INSERT OR UPDATE ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_display_names(
    'recorded_by_name:recorded_by:users:name',
    'recorded_by:recorded_by_name'
  );

DROP TRIGGER IF EXISTS trg_stamp_display_names ON payments;
CREATE TRIGGER trg_stamp_display_names
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_display_names(
    'recorded_by_name:recorded_by:users:name',
    'recorded_by:recorded_by_name'
  );
