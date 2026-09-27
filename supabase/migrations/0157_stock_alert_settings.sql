-- 0157 — the shop's own stock-alert policy becomes something the owner can actually set.
--
-- `app_settings` has carried two rows since migration 0009:
--
--     low_stock_threshold_default = 10      'Default low stock alert threshold'
--     (and, added here) stock_alert_frequency
--
-- and **nothing in the app has ever read either one** (zero matches for `app_settings`
-- across `src/`). So the number that decided when the shop was told about low stock was
-- not the shop's number at all — it was whatever each screen happened to hardcode
-- (`variants[0]?.lowStockThreshold ?? 5` in the signal engine, `?? 5` in the reorder
-- page, `?? 5` in the product form's own hidden default). Three screens, three ways of
-- guessing, and no way for an owner to say "warn me at 20".
--
-- Three functions, no schema change. The per-product override already round-trips
-- correctly through `create_product` / `update_product` (0145 writes it, 0109 reads it),
-- so the only thing missing was a place to state the shop-wide number and a way to put
-- it on the products that predate it.
--
-- Why `apply_stock_threshold_to_all` exists rather than a backfill in this migration:
-- every threshold currently in the table is `5`, and no human ever chose it — the column
-- default did. Silently rewriting them to the shop's number would change what the shop's
-- alerts mean without the owner seeing it happen, which is the same class of bug as the
-- value being unreachable in the first place. So the owner is offered the one-tap action
-- and it is theirs to press, and nothing about the existing alerts moves until they do.

-- ── Reading the shop's policy ─────────────────────────────────────────────────────
--
-- Defaults are answered here rather than in each screen: a shop that has never opened
-- the setting still gets a number, and it is the same number everywhere.
CREATE OR REPLACE FUNCTION public.get_stock_alert_settings(payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_resolved jsonb;
  v_shop uuid;
  v_threshold int;
  v_frequency text;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId','')::uuid,
    NULLIF(payload->>'userId','')::uuid,
    NULLIF(payload->>'actorId','')::uuid
  );
  v_shop := (v_resolved->>'shop_id')::uuid;

  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'NO_SHOP_CONTEXT';
  END IF;

  -- Anyone who may look at the shop's products may see the policy they are alerted by.
  PERFORM authorize_business_action('products.view', v_shop, NULL);

  SELECT GREATEST(COALESCE(setting_value::int, 0), 0) INTO v_threshold
    FROM app_settings WHERE shop_id = v_shop AND setting_key = 'low_stock_threshold_default';

  SELECT setting_value INTO v_frequency
    FROM app_settings WHERE shop_id = v_shop AND setting_key = 'stock_alert_frequency';

  RETURN jsonb_build_object(
    'threshold', COALESCE(v_threshold, 10),
    'frequency', COALESCE(NULLIF(v_frequency, ''), 'on_cross')
  );
END;
$function$;

-- ── Writing it ────────────────────────────────────────────────────────────────────
--
-- The two values are validated here rather than trusted from the client: a threshold is
-- a non-negative integer, and a frequency is one of exactly three words. An unrecognised
-- frequency is refused instead of stored, because a stored word the alert path does not
-- know would silently behave as "no frequency" and the owner would never learn why their
-- choice did nothing.
CREATE OR REPLACE FUNCTION public.set_stock_alert_settings(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_resolved jsonb;
  v_shop uuid;
  v_actor uuid;
  v_threshold int;
  v_frequency text;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId','')::uuid,
    NULLIF(payload->>'userId','')::uuid,
    NULLIF(payload->>'actorId','')::uuid
  );
  v_shop := (v_resolved->>'shop_id')::uuid;
  v_actor := (v_resolved->>'actor_id')::uuid;

  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'NO_SHOP_CONTEXT';
  END IF;

  -- Changing when the whole shop is alerted is a stock decision, so it carries the same
  -- permission as editing the catalogue. An employee cannot move the shop's alert line.
  PERFORM authorize_business_action('products.edit', v_shop, NULL);

  v_threshold := GREATEST(COALESCE((payload->>'threshold')::int, 10), 0);

  v_frequency := COALESCE(NULLIF(payload->>'frequency',''), 'on_cross');
  IF v_frequency NOT IN ('on_cross', 'daily', 'every_3_days') THEN
    RAISE EXCEPTION 'BAD_FREQUENCY: %', v_frequency;
  END IF;

  INSERT INTO app_settings(shop_id, setting_key, setting_value, description)
  VALUES (v_shop, 'low_stock_threshold_default', v_threshold::text,
          'Default low stock alert threshold')
  ON CONFLICT (shop_id, setting_key)
  DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();

  INSERT INTO app_settings(shop_id, setting_key, setting_value, description)
  VALUES (v_shop, 'stock_alert_frequency', v_frequency,
          'How often a product that stays low is alerted on')
  ON CONFLICT (shop_id, setting_key)
  DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now();

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'stock_alert_settings_updated', 'shop', v_shop,
          jsonb_build_object('threshold', v_threshold, 'frequency', v_frequency));

  RETURN jsonb_build_object('threshold', v_threshold, 'frequency', v_frequency);
END;
$function$;

-- ── Putting the shop's number on the products that predate it ─────────────────────
--
-- Inactive variants are left alone: they are not on the shelf, so they should not be
-- raising alerts either way. The count comes back so the screen can say what happened
-- instead of claiming success over zero rows.
CREATE OR REPLACE FUNCTION public.apply_stock_threshold_to_all(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_resolved jsonb;
  v_shop uuid;
  v_actor uuid;
  v_threshold int;
  v_updated int;
BEGIN
  v_resolved := resolve_shop_and_actor(
    NULLIF(payload->>'shopId','')::uuid,
    NULLIF(payload->>'userId','')::uuid,
    NULLIF(payload->>'actorId','')::uuid
  );
  v_shop := (v_resolved->>'shop_id')::uuid;
  v_actor := (v_resolved->>'actor_id')::uuid;

  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'NO_SHOP_CONTEXT';
  END IF;

  PERFORM authorize_business_action('products.edit', v_shop, NULL);

  v_threshold := GREATEST(COALESCE((payload->>'threshold')::int, 10), 0);

  UPDATE product_variants v
     SET low_stock_threshold = v_threshold,
         updated_at = now()
   FROM products p
  WHERE v.product_id = p.id
    AND p.shop_id = v_shop
    AND COALESCE(v.is_active, true)
    AND v.low_stock_threshold IS DISTINCT FROM v_threshold;

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'stock_threshold_applied_to_all', 'shop', v_shop,
          jsonb_build_object('threshold', v_threshold, 'variants', v_updated));

  RETURN jsonb_build_object('threshold', v_threshold, 'updated', v_updated);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_stock_alert_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_stock_alert_settings(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_stock_threshold_to_all(jsonb) TO authenticated;
