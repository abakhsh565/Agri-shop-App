-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0124: Display attribution integrity (denormalized party names)
-- ═══════════════════════════════════════════════════════════════════════════════
-- DEFECT (reproduced in the live browser on /admin/dashboard):
--   Recent Sales rendered a blank customer name and "Sold by:" with nothing
--   after it. Root cause is not the screenshot: `sales.customer_name_snapshot`
--   and `sales.employee_name` are denormalized display columns, the column only
--   arrived in migration 0102, and the client maps them with no fallback:
--     src/stores/salesStore.ts: customerName: r.customer_name_snapshot
--   Anyone whose answer is "the RPC stamps them" is half right — and that is
--   exactly the fragility: three of these columns are stamped by NO code path
--   at all, so the screens that show them are permanently blank.
--
-- EVIDENCE (queried against the QA database):
--   sales.customer_name_snapshot      5/6 null
--   sales.employee_name               5/6 null
--   sales.voided_by_name              3/6 null
--   purchases.recorded_by_name        2/2 null   ← no function writes this
--   customer_payments.recorded_by_name  0/0      ← no function writes this
--   supplier_payments.recorded_by_name  0/0      ← no function writes this
--   payments.recorded_by_name           0/0      ← no function writes this
--   Functions that stamp each column:
--     customer_name_snapshot/employee_name -> create_sale
--     voided_by_name                       -> void_sale
--     company_name                         -> create_purchase
--     processed_by_name, customer_name     -> process_return
--     recorded_by_name                     -> (none)
--
-- FIX (one shared layer, not per-screen):
--   1. Backfill every NULL from the foreign key that already knows the answer.
--   2. Make the invariant structural with a declarative BEFORE trigger so no
--      future write path — RPC, integration, import or test — can silently
--      leave a party name blank. A stamped name is NEVER overwritten, so the
--      historical snapshot semantics ("the name at the time of the sale") are
--      preserved exactly.
--
-- SCOPE NOTE: this is DISPLAY INTEGRITY only. It is not an authorization
-- mechanism and must not be used as one. Tenant/branch authorization stays
-- where it is: authorize_business_action() + RLS + the branch triggers.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Declarative stamping function
--    Spec format, comma-separated entries of:
--      target_column : fk_column : source_table : source_name_column
--    Only fills a NULL target from a known FK. Never overwrites.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.stamp_display_names()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  spec text := COALESCE(TG_ARGV[0], '');
  part text;
  bits text[];
  j    jsonb;
  val  text;
BEGIN
  IF spec = '' THEN
    RETURN NEW;
  END IF;

  j := to_jsonb(NEW);

  FOREACH part IN ARRAY string_to_array(spec, ',') LOOP
    bits := string_to_array(btrim(part), ':');
    CONTINUE WHEN array_length(bits, 1) IS DISTINCT FROM 4;
    CONTINUE WHEN (j ->> bits[1]) IS NOT NULL;  -- already stamped: preserve history
    CONTINUE WHEN (j ->> bits[2]) IS NULL;      -- no FK: nothing authoritative to copy

    -- Compare as text: some FK columns are uuid, others (recorded_by) are
    -- varchar, while the referenced id is always uuid. Text comparison keeps
    -- this lookup correct for both shapes.
    EXECUTE format('SELECT %I FROM public.%I WHERE id::text = $1', bits[4], bits[3])
      INTO val USING j ->> bits[2];

    IF val IS NOT NULL THEN
      j := jsonb_set(j, ARRAY[bits[1]], to_jsonb(val));
    END IF;
  END LOOP;

  NEW := jsonb_populate_record(NEW, j);
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.stamp_display_names() IS
  'Display integrity: fills a NULL denormalized party name from its FK. Not an authorization mechanism.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Backfill existing rows (repairs historical records in place)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE sales s SET customer_name_snapshot = c.name
  FROM customers c
 WHERE s.customer_id = c.id AND s.customer_name_snapshot IS NULL;

UPDATE sales s SET employee_name = u.name
  FROM users u
 WHERE s.employee_id = u.id AND s.employee_name IS NULL;

UPDATE sales s SET voided_by_name = u.name
  FROM users u
 WHERE s.voided_by = u.id AND s.voided_by_name IS NULL;

UPDATE purchases p SET company_name = co.name
  FROM companies co
 WHERE p.company_id = co.id AND p.company_name IS NULL;

UPDATE purchases p SET recorded_by_name = u.name
  FROM users u
 WHERE p.recorded_by = u.id::text AND p.recorded_by_name IS NULL;

UPDATE returns r SET customer_name = c.name
  FROM customers c
 WHERE r.customer_id = c.id AND r.customer_name IS NULL;

UPDATE returns r SET processed_by_name = u.name
  FROM users u
 WHERE r.processed_by = u.id AND r.processed_by_name IS NULL;

UPDATE customer_payments p SET recorded_by_name = u.name
  FROM users u
 WHERE p.recorded_by = u.id::text AND p.recorded_by_name IS NULL;

UPDATE supplier_payments p SET recorded_by_name = u.name
  FROM users u
 WHERE p.recorded_by = u.id::text AND p.recorded_by_name IS NULL;

UPDATE payments p SET recorded_by_name = u.name
  FROM users u
 WHERE p.recorded_by = u.id::text AND p.recorded_by_name IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Structural guard on every table that carries such a column
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_stamp_display_names ON sales;
CREATE TRIGGER trg_stamp_display_names
  BEFORE INSERT OR UPDATE ON sales
  FOR EACH ROW EXECUTE FUNCTION public.stamp_display_names(
    'customer_name_snapshot:customer_id:customers:name,'
    'employee_name:employee_id:users:name,'
    'voided_by_name:voided_by:users:name'
  );

DROP TRIGGER IF EXISTS trg_stamp_display_names ON purchases;
CREATE TRIGGER trg_stamp_display_names
  BEFORE INSERT OR UPDATE ON purchases
  FOR EACH ROW EXECUTE FUNCTION public.stamp_display_names(
    'company_name:company_id:companies:name,'
    'recorded_by_name:recorded_by:users:name'
  );

DROP TRIGGER IF EXISTS trg_stamp_display_names ON returns;
CREATE TRIGGER trg_stamp_display_names
  BEFORE INSERT OR UPDATE ON returns
  FOR EACH ROW EXECUTE FUNCTION public.stamp_display_names(
    'customer_name:customer_id:customers:name,'
    'processed_by_name:processed_by:users:name'
  );

DROP TRIGGER IF EXISTS trg_stamp_display_names ON customer_payments;
CREATE TRIGGER trg_stamp_display_names
  BEFORE INSERT OR UPDATE ON customer_payments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_display_names(
    'recorded_by_name:recorded_by:users:name'
  );

DROP TRIGGER IF EXISTS trg_stamp_display_names ON supplier_payments;
CREATE TRIGGER trg_stamp_display_names
  BEFORE INSERT OR UPDATE ON supplier_payments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_display_names(
    'recorded_by_name:recorded_by:users:name'
  );

DROP TRIGGER IF EXISTS trg_stamp_display_names ON payments;
CREATE TRIGGER trg_stamp_display_names
  BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION public.stamp_display_names(
    'recorded_by_name:recorded_by:users:name'
  );
