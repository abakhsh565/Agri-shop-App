-- 0303 — Production reconciliation: close the two schema divergences that stop
-- batch 1 (0233-0276) from applying to production.
--
-- Divergence 1 — 0115 added `shop_id` to the three reminder tables, but on
-- production only `reminder_configs` carries it. `reminder_occurrences` and
-- `reminder_logs` have no `shop_id` column, so 0242's branch policies (which
-- filter on `shop_id = current_shop_id()`) fail at plan time. Add the column
-- exactly as 0115 defines it, and backfill the same way 0115 does.
--
-- Divergence 2 — `purchases.recorded_by` is `character varying` on production
-- but `uuid` on staging, while `supplier_payments.recorded_by` is `uuid` on
-- both. 0258 copies `p.recorded_by` into `supplier_payments.recorded_by`, and
-- Postgres rejects the varchar-to-uuid assignment at plan time, so 0258 fails
-- even with zero purchase rows. Convert the column to `uuid`, keeping only
-- values that are already valid UUIDs (anything else becomes NULL). The app
-- does not write this column (create_purchase omits it; existing rows are
-- NULL), so the conversion is a no-op on live data.
--
-- Both fixes are idempotent (IF NOT EXISTS / type-checked), so the file is a
-- no-op on staging/QA where the divergences do not exist. Apply this file to
-- production BEFORE batch 1 (0233-0276).

-- ── 1. shop_id on the two reminder tables ──────────────────────────────────
ALTER TABLE public.reminder_occurrences
  ADD COLUMN IF NOT EXISTS shop_id uuid DEFAULT public.current_shop_id();

ALTER TABLE public.reminder_logs
  ADD COLUMN IF NOT EXISTS shop_id uuid DEFAULT public.current_shop_id();

-- Backfill exactly as 0115 does (no-op when the tables are empty).
UPDATE public.reminder_occurrences o
   SET shop_id = (SELECT id FROM public.shops ORDER BY created_at LIMIT 1)
 WHERE shop_id IS NULL;

UPDATE public.reminder_logs l
   SET shop_id = (SELECT id FROM public.shops ORDER BY created_at LIMIT 1)
 WHERE shop_id IS NULL;

-- ── 1b. reminder_logs shape 0040 should have given it ─────────────────────
-- 0040 adds `occurrence_id uuid` to reminder_logs, but production never got
-- it, so 0242's policy (which joins reminder_logs.occurrence_id to
-- reminder_occurrences.id) fails. Add it exactly as 0040 defines it.
ALTER TABLE public.reminder_logs
  ADD COLUMN IF NOT EXISTS occurrence_id uuid REFERENCES public.reminder_occurrences(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reminder_logs_one_per_occurrence
  ON public.reminder_logs (occurrence_id) WHERE occurrence_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reminder_logs_occurrence
  ON public.reminder_logs (occurrence_id) WHERE occurrence_id IS NOT NULL;

-- reminder_logs.config_id is TEXT on production, but 0242 compares it to
-- reminder_configs.id (uuid). 0040's own backfill casts the occurrence side
-- to text (log.config_id = occ.config_id::text), so the stored values are
-- UUID strings held as text. Convert the column to uuid, keeping only values
-- that are already valid UUIDs (anything else becomes NULL). The table is
-- empty on production, so this is a no-op on live data.
DO $$
DECLARE
  v_type text;
BEGIN
  SELECT data_type INTO v_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'reminder_logs'
     AND column_name = 'config_id';

  IF v_type IS NULL THEN
    RAISE NOTICE '0303: reminder_logs.config_id does not exist, nothing to convert';
  ELSIF v_type = 'uuid' THEN
    RAISE NOTICE '0303: reminder_logs.config_id is already uuid, nothing to convert';
  ELSE
    ALTER TABLE public.reminder_logs
      ALTER COLUMN config_id TYPE uuid
      USING (
        CASE
          WHEN config_id IS NULL THEN NULL
          WHEN config_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN config_id::uuid
          ELSE NULL
        END
      );
    RAISE NOTICE '0303: reminder_logs.config_id converted from % to uuid', v_type;
  END IF;
END $$;

-- ── 2. purchases.recorded_by to uuid ───────────────────────────────────────
DO $$
DECLARE
  v_type text;
BEGIN
  SELECT data_type INTO v_type
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'purchases'
     AND column_name = 'recorded_by';

  IF v_type IS NULL THEN
    RAISE NOTICE '0303: purchases.recorded_by does not exist, nothing to convert';
  ELSIF v_type = 'uuid' THEN
    RAISE NOTICE '0303: purchases.recorded_by is already uuid, nothing to convert';
  ELSE
    ALTER TABLE public.purchases
      ALTER COLUMN recorded_by TYPE uuid
      USING (
        CASE
          WHEN recorded_by IS NULL THEN NULL
          WHEN recorded_by ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            THEN recorded_by::uuid
          ELSE NULL
        END
      );
    RAISE NOTICE '0303: purchases.recorded_by converted from % to uuid', v_type;
  END IF;
END $$;

-- ── 3. Self-check: the divergences are closed ─────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'reminder_occurrences'
       AND column_name = 'shop_id'
  ) THEN
    RAISE EXCEPTION '0303: shop_id still missing on reminder_occurrences';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'reminder_logs'
       AND column_name = 'shop_id'
  ) THEN
    RAISE EXCEPTION '0303: shop_id still missing on reminder_logs';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'reminder_logs'
       AND column_name = 'occurrence_id'
  ) THEN
    RAISE EXCEPTION '0303: occurrence_id still missing on reminder_logs';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'reminder_logs'
       AND column_name = 'config_id' AND data_type <> 'uuid'
  ) THEN
    RAISE EXCEPTION '0303: reminder_logs.config_id is still not uuid';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'purchases'
       AND column_name = 'recorded_by' AND data_type <> 'uuid'
  ) THEN
    RAISE EXCEPTION '0303: purchases.recorded_by is still not uuid';
  END IF;

  RAISE NOTICE '0303: production reconciliation complete';
END $$;
