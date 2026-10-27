-- ═══════════════════════════════════════════════════════════════════════════════
-- 0252 — The sale gate reads the same number the shelf shows
--
-- THE REPORT. Completing a sale of `K plus · 28 KG` failed with "There is not enough stock for
-- this. Please check the quantity." while every screen said the shop held 502 of that pack.
-- Measured on the development database:
--
--     the shop's total                     (`product_variants.stock_qty`)          502.00
--     what the product screens showed      (`get_branch_variant_stock`, main)      502
--     what the write gate decided against  (`branch_variant_qty`, main)             −1.00
--
-- WHY THEY DISAGREED. Both numbers are sums over the same ledger, and 0244 changed only one of
-- them ("stock in an archived branch still has a home" — everything the ACTIVE branches' ledgers
-- cannot explain is carried by the main branch, so the branch cards add up to the product
-- screen). `get_branch_variant_stock()` got that rule. `branch_variant_qty()` did not:
--
--   * It answered with the branch's own ledger net, plus the shop's opening stock ONLY when the
--     pack had no movement anywhere. A pack whose movements all sit in an ARCHIVED branch — the
--     500-unit adjustment and the purchases of K plus are stamped to "Default Shop - Main", which
--     was archived when the branch set changed — had movements, so the fallback was skipped and
--     the branch reported whatever its own rows said. For K plus those rows are one sale and no
--     receipt: −1.
--   * The shelf never showed that −1. It showed 502, the number the owner can see.
--
-- The guard then refused the sale, and reported it as INSUFFICIENT_STOCK, which the app maps to
-- "check the quantity" — the one sentence that cannot be acted on, because the quantity was never
-- the problem. Nine of the fifteen packs in that shop were in the same state on the main branch.
--
-- WHAT THIS FILE DOES — one rule, in one place:
--
--   1. `branch_variant_qty()` BECOMES that rule: the branch's own ledger net, plus the unclaimed
--      remainder on the main branch. Its new third argument is how much of `stock_qty` the
--      pending movement has already taken, because a BEFORE INSERT trigger runs after the caller
--      moved the shop number (`create_sale_unchecked` and `adjust_stock` both update
--      `product_variants.stock_qty` before inserting the movement) and the question is what the
--      branch held BEFORE that movement. Reconstructing the pre-movement number moves here, once,
--      instead of living in the guard.
--   2. `get_branch_variant_stock()` is re-stated as the clamped form of that same function, so the
--      shelf and the gate cannot answer differently again.
--   3. `guard_branch_stock_movement()` asks that function and nothing else. Its `v_never` special
--      case is gone because the general rule already subsumes it: a pack with no movement anywhere
--      has `net = 0` and `active_net = 0`, which is 0 on a sub-branch and `stock_before` on the
--      main branch — the same two answers the special case produced.
--
-- A refusal now means what it should: the shelf already showed less than this movement takes.
--
-- Forward-only and idempotent. The 2-argument overload is dropped on purpose — leaving it beside
-- the new one would let an exact-arity call keep resolving to the old body.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The one rule ─────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.branch_variant_qty(uuid, uuid);

CREATE OR REPLACE FUNCTION public.branch_variant_qty(
  p_variant_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_pending_change numeric DEFAULT 0
)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_branch  uuid := COALESCE(p_branch_id, public.current_branch_id());
  v_shop    uuid;
  v_stock   numeric;
  v_before  numeric;
  v_net     numeric;
  v_active  numeric;
  v_only    boolean;
  v_default uuid;
BEGIN
  SELECT p.shop_id, v.stock_qty INTO v_shop, v_stock
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
   WHERE v.id = p_variant_id;

  IF v_shop IS NULL THEN RETURN 0; END IF;

  -- The caller may already have moved the shop number for the movement being checked. The
  -- question here is what the branch held BEFORE it, so the pending change is added back once,
  -- in this function, rather than in every caller that needs it.
  v_before := COALESCE(v_stock, 0) - COALESCE(p_pending_change, 0);

  -- Rows written before branch stamping belong to a branch only when the shop has exactly one
  -- active branch; otherwise they belong to no particular branch.
  SELECT EXISTS (
           SELECT 1 FROM public.branches b
            WHERE b.tenant_id = v_shop AND b.is_active
            HAVING count(*) = 1
         )
    INTO v_only;

  SELECT COALESCE(SUM(m.qty_change), 0)
    INTO v_net
    FROM public.inventory_movements m
   WHERE m.variant_id = p_variant_id
     AND (m.branch_id = v_branch OR (m.branch_id IS NULL AND v_only));

  SELECT COALESCE(SUM(m.qty_change), 0)
    INTO v_active
    FROM public.inventory_movements m
   WHERE m.variant_id = p_variant_id
     AND m.branch_id IN (
           SELECT b.id FROM public.branches b
            WHERE b.tenant_id = v_shop AND b.is_active
         );

  SELECT b.id INTO v_default
    FROM public.branches b
   WHERE b.tenant_id = v_shop AND b.is_active
   ORDER BY b.is_default DESC, b.created_at, b.id
   LIMIT 1;

  -- The main branch carries what no active branch's ledger explains (0244): stock received before
  -- branch stamping, and stock whose branch was archived. Every other branch answers with its own
  -- ledger alone, so a sub-branch still cannot sell what it never received.
  RETURN v_net
       + CASE WHEN v_branch = v_default
              THEN GREATEST(v_before - v_active, 0)
              ELSE 0 END;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.branch_variant_qty(uuid, uuid, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.branch_variant_qty(uuid, uuid, numeric) FROM PUBLIC, anon;

-- ── 2. The shelf shows the same number, clamped at zero ─────────────────────────
CREATE OR REPLACE FUNCTION public.get_branch_variant_stock()
RETURNS TABLE (variant_id uuid, qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $function$
  -- The displayed shelf IS the gate's number, clamped at zero. A shelf is never negative on a
  -- screen, and the write path asks the same function with the pending change added back — so the
  -- two can no longer disagree about how much this branch holds.
  SELECT v.id,
         GREATEST(public.branch_variant_qty(v.id, public.current_branch_id()), 0)
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
   WHERE p.shop_id = public.current_shop_id()
     AND p.is_active AND v.is_active;
$function$;

GRANT EXECUTE ON FUNCTION public.get_branch_variant_stock() TO authenticated;
REVOKE ALL ON FUNCTION public.get_branch_variant_stock() FROM PUBLIC, anon;

-- ── 3. The gate asks that one rule ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_branch_stock_movement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v_available numeric := 0;
BEGIN
  -- Only a movement that takes stock away can oversell. Receipts, returns and corrections are
  -- always allowed: they are how a branch recovers.
  IF NEW.variant_id IS NULL OR NEW.branch_id IS NULL OR COALESCE(NEW.qty_change, 0) >= 0 THEN
    RETURN NEW;
  END IF;

  -- The number the product screens show, with this movement added back: `stock_qty` has already
  -- been moved by the caller, so the function is asked what the branch held BEFORE the movement.
  -- A refusal therefore means the shelf was already showing less than this movement takes.
  v_available := public.branch_variant_qty(NEW.variant_id, NEW.branch_id, NEW.qty_change);

  IF v_available + NEW.qty_change < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: this branch holds % of this pack, and this movement takes %',
      v_available, -NEW.qty_change;
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_branch_stock_movement() FROM PUBLIC, anon;

-- ── Assertions — the migration fails loudly rather than half-applying ────────────
DO $assert$
DECLARE
  v_args text;
  v_def  text;
BEGIN
  -- The old exact-arity function must be gone: with both present, a 2-argument call resolves to
  -- the 2-argument body and the gate silently decides against the old rule again.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'branch_variant_qty'
       AND pg_get_function_identity_arguments(p.oid) = 'uuid, uuid'
  ) THEN
    RAISE EXCEPTION '0252: the 2-argument branch_variant_qty is still present, so a 2-argument call keeps the old rule';
  END IF;

  SELECT pg_get_function_identity_arguments(p.oid), pg_get_functiondef(p.oid)
    INTO v_args, v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'branch_variant_qty';

  IF v_args IS NULL OR position('p_pending_change' IN v_args) = 0 THEN
    RAISE EXCEPTION '0252: branch_variant_qty cannot be asked for the pre-movement number (args: %)', v_args;
  END IF;
  IF position('GREATEST' IN v_def) = 0 OR position('v_default' IN v_def) = 0 THEN
    RAISE EXCEPTION '0252: branch_variant_qty no longer carries the remainder the main branch explains';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_branch_variant_stock';
  IF position('branch_variant_qty' IN v_def) = 0 THEN
    RAISE EXCEPTION '0252: get_branch_variant_stock answers from its own formula again — the shelf and the gate can drift';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'guard_branch_stock_movement';
  IF position('branch_variant_qty(NEW.variant_id, NEW.branch_id, NEW.qty_change)' IN v_def) = 0 THEN
    RAISE EXCEPTION '0252: the movement guard no longer asks branch_variant_qty for the pre-movement number';
  END IF;
  IF position('v_never' IN v_def) > 0 THEN
    RAISE EXCEPTION '0252: the movement guard still carries its own opening-stock special case';
  END IF;

  -- Behavioural, for the session's own branch: the number the shelf reports and the number the
  -- gate would decide against must be the same function of the same ledger. This fires on the
  -- pre-0252 definitions (the shelf said 502 for a pack the gate answered −1 for), so it is the
  -- probe that would have caught the reported defect.
  IF public.current_shop_id() IS NOT NULL AND public.current_branch_id() IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
        FROM public.product_variants v
        JOIN public.products p ON p.id = v.product_id
       WHERE p.shop_id = public.current_shop_id()
         AND p.is_active AND v.is_active
         AND GREATEST(public.branch_variant_qty(v.id, public.current_branch_id()), 0)
          <> COALESCE((SELECT s.qty FROM public.get_branch_variant_stock() s
                        WHERE s.variant_id = v.id), 0)
    ) THEN
      RAISE EXCEPTION '0252: the shelf and the gate answer differently for the branch this session is in';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'zz_guard_branch_stock_trg' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION '0252: the movement guard is no longer attached to inventory_movements';
  END IF;
END
$assert$;
