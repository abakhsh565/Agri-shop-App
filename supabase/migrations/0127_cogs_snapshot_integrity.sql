-- ═══════════════════════════════════════════════════════════════════════════════
-- MIGRATION 0127: Cost-of-goods snapshot integrity (gross profit correctness)
-- ═══════════════════════════════════════════════════════════════════════════════
-- DEFECT (reproduced on /admin/dashboard, filter = All):
--   The dashboard showed GROSS PROFIT Rs. 12,000. The database says Rs. 6,000.
--   The client builds a cost lookup from the products store:
--       products.forEach(p => p.variants.forEach(v => variantCost.set(v.id, v.costPrice)))
--       (it.unitPrice - (variantCost.get(it.variantId ?? "") ?? 0)) * qty
--   and that store only loads ACTIVE rows:
--       src/stores/productsStore.ts:105  .eq("is_active", true)
--   So for any item whose product is now inactive the lookup misses, the cost
--   silently becomes 0, and gross profit is overstated by that item's whole COGS.
--
-- EVIDENCE:
--   DST-SALE-001 / "Destruct Test Product", qty 2 x 5000, cost_price 3000,
--   products.is_active = false  ->  true GP 4000, computed GP 10000.
--   Active items: 3 x 1200 (cost 800) -> GP 1200 ; 2 x 1800 (cost 1400) -> GP 800.
--   DB GP = 6000.00 ; dashboard = 12000 = 6000 + 3000 x 2 — exactly the missing
--   cost, with no other explanation fitting the delta.
--
--   The authoritative column already existed and was a trap:
--       sale_items.cogs_amount numeric(14,2) NOT NULL DEFAULT 0
--   5 rows, 0 NULLs, SUM 0.00 — every row silently meant "cost is zero", and no
--   function in the database wrote it (create_sale omits it), even though
--   migration 0012 wrote it as v_cost * v_qty and returned 'cogsTotal'.
--
-- SEMANTIC (fixed against 0012, the original intent — this is LINE COGS):
--       cogs_amount = cost_price x qty      (NOT the unit cost)
--
-- FIX — record cost at the time of sale, the only historically truthful value
-- (today's cost_price is not yesterday's cost, so recomputing old profit from a
-- live lookup drifts by design):
--   1. Backfill every row as qty x variant cost.
--   2. Make the column honest: NULL = not recorded, 0 = genuinely free.
--   3. Maintain it structurally on insert, so no future write path can leave it
--      unset — while never overwriting an already-recorded cost, so history stays
--      frozen. This one is a dedicated trigger, not the generic name-stamper,
--      because the value is a quantity calculation rather than a copied column.
--
-- SCOPE: financial display correctness. Not an authorization mechanism.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Backfill / self-correct to line COGS (cost x qty)
--    IS DISTINCT FROM makes this safe to re-run and repairs rows written by an
--    earlier pass of this migration that used the unit cost by mistake.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE sale_items si
   SET cogs_amount = ROUND(v.cost_price * si.qty, 2)
  FROM product_variants v
 WHERE si.variant_id = v.id
   AND v.cost_price IS NOT NULL
   AND si.cogs_amount IS DISTINCT FROM ROUND(v.cost_price * si.qty, 2);

-- 2. Honest nullability: an unrecorded cost must be NULL, never a silent zero
ALTER TABLE sale_items ALTER COLUMN cogs_amount DROP DEFAULT;
ALTER TABLE sale_items ALTER COLUMN cogs_amount DROP NOT NULL;

COMMENT ON COLUMN sale_items.cogs_amount IS
  'Line cost of goods recorded at the time of sale (cost_price x qty). NULL = not recorded; 0 = genuinely free. Never recompute from the current variant cost.';

-- 3. Structural stamp on insert (line COGS from the variant priced at sale time)
CREATE OR REPLACE FUNCTION public.stamp_line_cogs()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
BEGIN
  -- Only when nothing was recorded, and only when the line has a variant to
  -- price it from. An already-recorded cost is never overwritten.
  IF NEW.cogs_amount IS NULL AND NEW.variant_id IS NOT NULL AND NEW.qty IS NOT NULL THEN
    SELECT v.cost_price * NEW.qty
      INTO NEW.cogs_amount
      FROM product_variants v
     WHERE v.id = NEW.variant_id;
  END IF;
  RETURN NEW;
END;
$fn$;

COMMENT ON FUNCTION public.stamp_line_cogs() IS
  'Records line COGS at insert time from the variant cost. Only fills NULL; never overwrites a recorded cost. Not an authorization mechanism.';

DROP TRIGGER IF EXISTS trg_stamp_line_cogs ON sale_items;
CREATE TRIGGER trg_stamp_line_cogs
  BEFORE INSERT ON sale_items
  FOR EACH ROW EXECUTE FUNCTION public.stamp_line_cogs();

-- the generic name-stamper must not touch this table
DROP TRIGGER IF EXISTS trg_stamp_display_names ON sale_items;
