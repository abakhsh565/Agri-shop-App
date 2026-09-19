-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0120: converge branch ownership for rows written before 0118
-- ═══════════════════════════════════════════════════════════════════════════════
-- Ensures no operational record is left without branch ownership, including
-- rows created by trusted server-side callers between 0118 and 0119 (when the
-- trigger stamped branches only for members). Deterministic: the tenant's
-- default branch owns unattributed historical rows.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  t text;
  v_default uuid;
BEGIN
  SELECT b.id INTO v_default
    FROM branches b
   WHERE b.is_active
   ORDER BY b.is_default DESC, b.created_at ASC
   LIMIT 1;

  IF v_default IS NULL THEN
    RAISE NOTICE 'no branch available — skipping branch backfill';
    RETURN;
  END IF;

  FOREACH t IN ARRAY ARRAY['sales','purchases','returns','inventory_movements',
                           'customer_payments','supplier_payments','stock_adjustments']
  LOOP
    EXECUTE format('UPDATE public.%I SET branch_id = $1 WHERE branch_id IS NULL', t)
      USING v_default;
  END LOOP;
END $$;
