-- ═══════════════════════════════════════════════════════════════════════════════
-- 0239 — A branch only moves its own stock
--
-- WHY. 0238 made the product screens READ the branch's shelf, but the write paths
-- still spoke about one shop-wide number:
--
--   • `adjust_stock` read `products.stock_qty` (the whole shop's stock) and wrote
--     `product_variants.stock_qty` to the result. An owner standing in a branch
--     that held nothing, with 40 packs in another branch, could choose "set 10" and
--     the branch ledger received +10 while the shop-wide number became 10 — three
--     different answers to one question.
--   • `create_sale` only checked the shop-wide quantity, so a branch with no pack
--     could sell one. That is how K plus reached −1 in Main Branch: the sale was
--     allowed by the shop total, and the branch ledger recorded a debt of stock it
--     never had.
--
-- WHAT THIS DOES. Two rules, enforced where the data is written:
--
--   1. An adjustment is measured against, and recorded in, the branch the account
--      is working in. "Set 10" means "this branch now has 10", never "the shop now
--      has 10". The shop-wide quantity moves by the same delta so the two stay in
--      step; it is no longer the before-value the screen decides against.
--
--   2. A movement that removes stock cannot take a branch below zero. The guard is
--      on `inventory_movements`, the one place every write path records stock, so it
--      covers sales, returns, purchases, voids, adjustments and any future path that
--      forgets to ask. A sale with no stock in this branch is refused; the branch
--      cannot lend another branch's packs.
--
-- WHAT IT DOES NOT DO. It does not rewrite history, move stock between branches,
-- hide a product, or change the catalogue. A negative ledger left by an older sale
-- stays in the ledger; the read (0238) already reports it as zero, and a receipt in
-- that branch brings the shelf back to zero rather than deeper into debt.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── the one question: how many of this pack does this branch hold? ─────────────
-- The same rule 0238 uses, for one variant and an explicit branch. The answer can be
-- negative when an older write oversold the branch: the caller decides whether that is a
-- display problem (show zero) or a ledger fact (an adjustment of +1 brings it to zero).
CREATE OR REPLACE FUNCTION public.branch_variant_qty(p_variant_id uuid, p_branch_id uuid DEFAULT NULL)
RETURNS numeric
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_branch  uuid := COALESCE(p_branch_id, public.current_branch_id());
  v_shop    uuid;
  v_stock   numeric;
  v_net     numeric;
  v_has     boolean;
  v_only    boolean;
  v_default uuid;
BEGIN
  SELECT p.shop_id, v.stock_qty INTO v_shop, v_stock
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
   WHERE v.id = p_variant_id;

  IF v_shop IS NULL THEN RETURN 0; END IF;

  -- Rows written before branch stamping belong to a branch only when the shop has
  -- exactly one active branch; otherwise they belong to no particular branch.
  SELECT EXISTS (
           SELECT 1 FROM public.branches b
            WHERE b.tenant_id = v_shop AND b.is_active
            HAVING count(*) = 1
         )
    INTO v_only;

  SELECT COALESCE(SUM(m.qty_change), 0), count(*) > 0
    INTO v_net, v_has
    FROM public.inventory_movements m
   WHERE m.variant_id = p_variant_id
     AND (m.branch_id = v_branch OR (m.branch_id IS NULL AND v_only));

  IF v_has THEN RETURN v_net; END IF;

  -- This branch has no movement for the pack. A pack that was never branch-stamped
  -- at all is the shop's opening stock, and it belongs to the default branch only.
  IF NOT EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.variant_id = p_variant_id) THEN
    SELECT b.id INTO v_default
      FROM public.branches b
     WHERE b.tenant_id = v_shop AND b.is_active
     ORDER BY b.is_default DESC, b.created_at, b.id
     LIMIT 1;
    IF v_branch = v_default THEN RETURN COALESCE(v_stock, 0); END IF;
  END IF;

  RETURN 0;
END;
$$;

GRANT EXECUTE ON FUNCTION public.branch_variant_qty(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.branch_variant_qty(uuid, uuid) FROM PUBLIC, anon;

-- ── the read: never report a negative shelf ──────────────────────────────────
-- Same contract as 0238; a branch that oversold before this migration reports zero
-- rather than a debt. `GET /admin/products` already maps a variant missing from this
-- answer to 0, so a zero row is not required.
CREATE OR REPLACE FUNCTION public.get_branch_variant_stock()
RETURNS TABLE (variant_id uuid, qty numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH shop AS (
    SELECT public.current_shop_id() AS id
  ),
  this_branch AS (
    SELECT public.current_branch_id() AS id
  ),
  branches_of_shop AS (
    SELECT b.id
      FROM public.branches b
     WHERE b.is_active AND b.tenant_id = (SELECT id FROM shop)
  ),
  only_branch AS (
    SELECT (array_agg(b.id))[1] AS id
      FROM branches_of_shop b
    HAVING count(*) = 1
  ),
  default_branch AS (
    SELECT b.id
      FROM public.branches b
     WHERE b.is_active AND b.tenant_id = (SELECT id FROM shop)
     ORDER BY b.is_default DESC, b.created_at, b.id
     LIMIT 1
  ),
  net AS (
    SELECT m.variant_id, GREATEST(SUM(m.qty_change), 0) AS qty
      FROM public.inventory_movements m
      LEFT JOIN only_branch ob ON true
     WHERE m.branch_id = (SELECT id FROM this_branch)
        OR (m.branch_id IS NULL AND ob.id = (SELECT id FROM this_branch))
     GROUP BY m.variant_id
  ),
  legacy AS (
    SELECT v.id AS variant_id, v.stock_qty AS qty
      FROM public.product_variants v
      JOIN public.products p ON p.id = v.product_id
     WHERE p.shop_id = (SELECT id FROM shop)
       AND p.is_active AND v.is_active
       AND v.stock_qty > 0
       AND (SELECT id FROM this_branch) = (SELECT id FROM default_branch)
       AND NOT EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.variant_id = v.id)
  )
  SELECT x.variant_id, SUM(x.qty) AS qty
    FROM (SELECT * FROM net UNION ALL SELECT * FROM legacy) x
    JOIN public.product_variants v ON v.id = x.variant_id
    JOIN public.products p ON p.id = v.product_id
   WHERE p.shop_id = (SELECT id FROM shop)
     AND p.is_active AND v.is_active
   GROUP BY x.variant_id;
$$;

GRANT EXECUTE ON FUNCTION public.get_branch_variant_stock() TO authenticated;
REVOKE ALL ON FUNCTION public.get_branch_variant_stock() FROM PUBLIC, anon;

-- ── the write: the adjustment is the branch's ─────────────────────────────────
drop function if exists public.adjust_stock(jsonb);

CREATE OR REPLACE FUNCTION public.adjust_stock(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_branch uuid;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_change numeric(12,2);
  v_shop_before numeric(12,2);
  v_shop_after numeric(12,2);
  v_qty numeric(12,2);
  v_actor uuid;
  v_adjustment_type text;
  v_shop uuid;
  v_key text;
  v_existing record;
BEGIN
  PERFORM public.guard_operational_request('adjust_stock',payload);
  v_actor := app_current_user_id();
  v_product_id := NULLIF(payload->>'productId', '')::uuid;
  v_variant_id := NULLIF(payload->>'variantId', '')::uuid;
  v_qty := (payload->>'qty')::numeric;
  v_adjustment_type := payload->>'adjustmentType';
  v_branch := COALESCE(NULLIF(payload->>'branchId', '')::uuid, public.current_branch_id());

  SELECT shop_id INTO v_shop FROM products WHERE id = v_product_id;
  PERFORM authorize_business_action('inventory.adjust', COALESCE(v_shop, current_shop_id()), v_branch);

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product ID is required';
  END IF;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product does not belong to your organization';
  END IF;
  IF v_branch IS NULL THEN
    RAISE EXCEPTION 'INVALID_BRANCH_SCOPE: an adjustment must name the branch it belongs to';
  END IF;
  IF v_variant_id IS NULL THEN
    RAISE EXCEPTION 'VARIANT_NOT_FOUND: choose the pack whose stock is being adjusted';
  END IF;

  v_key := NULLIF(COALESCE(payload->>'idempotency_key', payload->>'idempotencyKey'), '');
  IF v_key IS NOT NULL THEN
    SELECT sa.id, sa.qty_before, sa.qty_change, sa.qty_after
      INTO v_existing
      FROM stock_adjustments sa
     WHERE sa.idempotency_key = v_key
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      PERFORM public.guard_operational_request('adjust_stock',payload);
 RETURN jsonb_build_object(
        'id', v_existing.id,
        'qtyBefore', v_existing.qty_before,
        'qtyChange', v_existing.qty_change,
        'qtyAfter', v_existing.qty_after,
        'idempotent', true
      );
    END IF;
  END IF;

  -- The row is locked first: two tills adjusting the same pack must not both read
  -- the same "before" and each write a full shelf.
  SELECT v.stock_qty INTO v_shop_before
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
   WHERE v.id = v_variant_id AND v.product_id = v_product_id AND p.shop_id = v_shop
   FOR UPDATE OF v;

  IF v_shop_before IS NULL THEN
    RAISE EXCEPTION 'VARIANT_NOT_FOUND: this pack does not belong to the product in this shop';
  END IF;

  -- What the person in this branch is looking at, not the shop total.
  v_before := public.branch_variant_qty(v_variant_id, v_branch);

  IF v_adjustment_type = 'add' THEN
    v_after := v_before + v_qty;
  ELSIF v_adjustment_type = 'remove' THEN
    v_after := GREATEST(0, v_before - v_qty);
  ELSIF v_adjustment_type = 'set' THEN
    v_after := v_qty;
  ELSE
    RAISE EXCEPTION 'INVALID_ADJUSTMENT_TYPE: Unknown adjustment type: %', v_adjustment_type;
  END IF;

  v_change := v_after - v_before;

  IF v_change = 0 THEN
    RAISE EXCEPTION 'NO_CHANGE: Adjustment does not change stock level';
  END IF;

  IF v_after < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_STOCK: Adjustment would make stock negative';
  END IF;

  v_id := gen_random_uuid();
  v_shop_after := GREATEST(0, v_shop_before + v_change);

  BEGIN
    INSERT INTO stock_adjustments (id, product_id, product_name, variant_id, variant_name,
      adjustment_type, qty_before, qty_change, qty_after, reason, adjusted_by, idempotency_key,
      created_at, branch_id)
    VALUES (v_id, v_product_id,
      COALESCE(payload->>'productName', (SELECT name FROM public.products WHERE id = v_product_id)),
      v_variant_id, COALESCE(payload->>'variantName', ''),
      v_adjustment_type, v_before, v_change, v_after,
      payload->>'reason', v_actor, v_key, now(), v_branch);

  EXCEPTION WHEN unique_violation THEN
    SELECT sa.id, sa.qty_before, sa.qty_change, sa.qty_after
      INTO v_existing
      FROM stock_adjustments sa
     WHERE sa.idempotency_key = v_key
     LIMIT 1;

    PERFORM public.guard_operational_request('adjust_stock',payload);
 RETURN jsonb_build_object(
      'id', v_existing.id,
      'qtyBefore', v_existing.qty_before,
      'qtyChange', v_existing.qty_change,
      'qtyAfter', v_existing.qty_after,
      'idempotent', true
    );
  END;

  UPDATE product_variants
     SET stock_qty = v_shop_after,
         updated_at = now()
   WHERE id = v_variant_id;

  -- The product's own number is the sum of its packs, not a separate truth.
  UPDATE products p
     SET stock_qty = COALESCE((
           SELECT SUM(v.stock_qty)
             FROM public.product_variants v
            WHERE v.product_id = v_product_id AND v.is_active
         ), v_shop_after),
         updated_at = now()
   WHERE p.id = v_product_id;

  INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
    reference_type, reference_id, created_by, created_at, branch_id)
  VALUES (
    v_product_id,
    v_variant_id,
    'adjustment', v_before, v_change, v_after,
    'adjustment', v_id, v_actor, now(), v_branch
  );

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'stock_adjusted', 'product', v_product_id,
    jsonb_build_object('type', v_adjustment_type, 'before', v_before, 'after', v_after,
                       'branchId', v_branch));

  PERFORM public.guard_operational_request('adjust_stock',payload);
 RETURN jsonb_build_object(
    'id', v_id,
    'qtyBefore', v_before,
    'qtyChange', v_change,
    'qtyAfter', v_after
  );
END;
$function$;

grant execute on function public.adjust_stock(jsonb) to authenticated;
revoke execute on function public.adjust_stock(jsonb) from public, anon;

-- ── the guard: no branch may go below zero ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.guard_branch_stock_movement()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_available numeric := 0;
  v_never     boolean;
  v_default   uuid;
  v_stock     numeric;
  v_shop      uuid;
BEGIN
  -- Only a movement that takes stock away can oversell. Receipts, returns and
  -- corrections are always allowed: they are how a branch recovers.
  IF NEW.variant_id IS NULL OR NEW.branch_id IS NULL OR COALESCE(NEW.qty_change, 0) >= 0 THEN
    RETURN NEW;
  END IF;

  SELECT p.shop_id, v.stock_qty INTO v_shop, v_stock
    FROM public.product_variants v
    JOIN public.products p ON p.id = v.product_id
   WHERE v.id = NEW.variant_id;

  SELECT NOT EXISTS (SELECT 1 FROM public.inventory_movements m WHERE m.variant_id = NEW.variant_id)
    INTO v_never;

  IF v_never THEN
    -- Opening stock was never stamped to a branch. It belongs to the shop's default
    -- branch. `stock_qty` has already been moved by the caller (sale/adjustment), so
    -- the amount before this movement is the current number minus the change.
    SELECT b.id INTO v_default
      FROM public.branches b
     WHERE b.tenant_id = v_shop AND b.is_active
     ORDER BY b.is_default DESC, b.created_at, b.id
     LIMIT 1;
    IF NEW.branch_id = v_default THEN
      v_available := GREATEST(0, COALESCE(v_stock, 0) - NEW.qty_change);
    ELSE
      v_available := 0;
    END IF;
  ELSE
    v_available := public.branch_variant_qty(NEW.variant_id, NEW.branch_id);
  END IF;

  IF v_available + NEW.qty_change < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: this branch holds % of this pack, and this movement takes %',
      v_available, -NEW.qty_change;
  END IF;

  RETURN NEW;
END;
$$;

-- Named to sort after `enforce_branch_scope_trg` (BEFORE triggers fire in name
-- order), so the row has its branch before this guard reads it. The guard also
-- accepts an explicitly stamped row, which every internal path supplies.
DROP TRIGGER IF EXISTS zz_guard_branch_stock_trg ON public.inventory_movements;
CREATE TRIGGER zz_guard_branch_stock_trg
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION public.guard_branch_stock_movement();

REVOKE ALL ON FUNCTION public.guard_branch_stock_movement() FROM PUBLIC, anon;

DO $assert$
DECLARE
  v_def text;
BEGIN
  SELECT pg_get_functiondef('public.adjust_stock(jsonb)'::regprocedure) INTO v_def;
  IF position('branch_variant_qty' IN v_def) = 0 THEN
    RAISE EXCEPTION '0239: adjust_stock still decides against the shop total';
  END IF;
  IF position('branch_id' IN v_def) = 0 THEN
    RAISE EXCEPTION '0239: adjust_stock still records no branch';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'zz_guard_branch_stock_trg'
       AND tgrelid = 'public.inventory_movements'::regclass
  ) THEN
    RAISE EXCEPTION '0239: the branch stock guard is missing';
  END IF;
  RAISE NOTICE '0239: a branch only moves its own stock';
END
$assert$;
