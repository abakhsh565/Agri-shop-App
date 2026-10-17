-- ═══════════════════════════════════════════════════════════════════════════════
-- 0227 — A return shows its quantity, and a void can finish
--
-- Two defects found by driving the real flows on production inside a rolled-back transaction:
--
--   1. process_return completed its writes and then failed: "null value in column \"qty\" of relation
--      \"return_items\" violates not-null constraint". Production's return_items carries a legacy
--      `qty` (NOT NULL, no default) alongside the `qty_to_return` the function writes — and it is
--      `qty` that the sale detail and the return-select screens read. So even a return that got past
--      the constraint would have displayed zero returned units, and the "already returned" sum would
--      have been wrong. A trigger keeps the legacy column equal to the real quantity wherever both
--      columns exist; staging has only `qty_to_return`, so it is skipped there.
--
--   2. void_sale failed with "relation \"activity_log\" does not exist". Production's body is the old
--      one: it restores PRODUCT stock rather than the variant, ignores quantities already returned,
--      writes an activity_log row for a table production never received, and never records a
--      `voids` row. The body below is staging's, which is the shape the app has been exercised
--      against: it authorises `sales.void`, restores only the unreturned quantity to the variant,
--      writes an inventory movement, reverses the customer's outstanding balance and purchases,
--      records the void and an audit event. Same signature, so it replaces in place.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The legacy quantity follows the quantity that was actually returned ──────────────────
do $mirror$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'return_items' and column_name = 'qty')
     and exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'return_items' and column_name = 'qty_to_return') then
    execute $fn$
      create or replace function public.return_items_mirror_qty()
      returns trigger
      language plpgsql
      security definer
      set search_path = public
      as $body$
      begin
        new.qty := coalesce(new.qty_to_return, new.qty, 0);
        return new;
      end
      $body$;
    $fn$;
    execute 'revoke execute on function public.return_items_mirror_qty() from public, anon, authenticated';
    execute 'drop trigger if exists return_items_mirror_qty_trg on public.return_items';
    execute 'create trigger return_items_mirror_qty_trg before insert or update on public.return_items
               for each row execute function public.return_items_mirror_qty()';
    -- Existing rows, if any, are brought into step rather than left contradictory.
    execute 'update public.return_items set qty = coalesce(qty_to_return, 0)
              where qty is distinct from coalesce(qty_to_return, 0)';
  end if;
end
$mirror$;

-- ── 2. The void that can finish ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.void_sale(p_sale_id uuid, p_reason text, p_voided_by uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sale record;
  v_item record;
  v_void_id uuid;
  v_unpaid numeric(14,4);
  v_restored_stock numeric(14,4) := 0;
  v_actor uuid;
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_change numeric(12,2);
  v_already_returned numeric(14,4);
  v_sale_shop uuid;
BEGIN
  PERFORM public.guard_operational_request('void_sale',jsonb_build_object('saleId',p_sale_id));
  v_actor := COALESCE(app_current_user_id(), p_voided_by);

  SELECT shop_id INTO v_sale_shop FROM sales WHERE id = p_sale_id;
  PERFORM authorize_business_action('sales.void', COALESCE(v_sale_shop, current_shop_id()));

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF v_sale IS NULL THEN RAISE EXCEPTION 'Sale not found'; END IF;
  IF v_sale.is_voided THEN RAISE EXCEPTION 'Sale is already voided'; END IF;
  IF p_reason IS NULL OR trim(p_reason) = '' THEN RAISE EXCEPTION 'Void reason is required'; END IF;

  FOR v_item IN SELECT * FROM sale_items WHERE sale_id = p_sale_id LOOP
    SELECT COALESCE(SUM(ri.qty_to_return), 0) INTO v_already_returned
    FROM return_items ri JOIN returns r ON r.id = ri.return_id
    WHERE ri.sale_item_id = v_item.id AND r.sale_id = p_sale_id;

    v_change := ROUND(v_item.qty - v_already_returned, 4);

    IF v_item.variant_id IS NOT NULL AND v_change > 0 THEN
      SELECT stock_qty INTO v_before FROM product_variants WHERE id = v_item.variant_id;
      v_before := COALESCE(v_before, 0);
      v_after := v_before + v_change;
      UPDATE product_variants SET stock_qty = v_after, updated_at = now() WHERE id = v_item.variant_id;
      v_restored_stock := v_restored_stock + v_change;

      INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, created_by, created_at)
      VALUES (v_item.product_id, v_item.variant_id, 'void', v_before, v_change, v_after,
        'void', p_sale_id, v_actor, now());
    END IF;
  END LOOP;

  v_unpaid := GREATEST(0, v_sale.total_amount - v_sale.amount_paid);
  IF v_sale.customer_id IS NOT NULL AND v_unpaid > 0 THEN
    UPDATE customers SET outstanding_balance = GREATEST(0, outstanding_balance - v_unpaid), updated_at = now()
    WHERE id = v_sale.customer_id;
  END IF;

  IF v_sale.customer_id IS NOT NULL AND v_sale.total_amount > 0 THEN
    UPDATE customers SET total_purchases = GREATEST(0, total_purchases - v_sale.total_amount), updated_at = now()
    WHERE id = v_sale.customer_id;
  END IF;

  INSERT INTO voids (id, sale_id, reason, voided_by, created_at)
  VALUES (gen_random_uuid(), p_sale_id, p_reason, v_actor, now())
  RETURNING id INTO v_void_id;

  UPDATE sales SET is_voided = true, voided_at = now(), voided_by = v_actor, voided_by_name = (SELECT name FROM users WHERE id = v_actor), void_reason = p_reason WHERE id = p_sale_id;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'sale_voided', 'sale', p_sale_id,
    jsonb_build_object('reason', p_reason, 'reversedOutstanding', v_unpaid));

  PERFORM public.guard_operational_request('void_sale',jsonb_build_object('saleId',p_sale_id));
 RETURN jsonb_build_object('id', v_void_id, 'saleId', p_sale_id, 'restoredStock', v_restored_stock, 'reversedOutstanding', v_unpaid, 'status', 'voided');
END;
$function$
;

grant execute on function public.void_sale(uuid, text, uuid) to authenticated;
revoke execute on function public.void_sale(uuid, text, uuid) from public, anon;

-- Assert the two properties this file exists for.
do $assert$
declare
  v_qty_is_synced boolean;
  v_void_mentions_activity_log boolean;
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'return_items' and column_name = 'qty')
     and exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'return_items' and column_name = 'qty_to_return') then
    select exists (
      select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
       where c.relname = 'return_items' and t.tgname = 'return_items_mirror_qty_trg' and not t.tgisinternal
    ) into v_qty_is_synced;
    if not v_qty_is_synced then
      raise exception '0227: return_items.qty has no trigger to keep it equal to qty_to_return';
    end if;
  end if;

  select position('activity_log' in pg_get_functiondef(p.oid)) > 0
    into v_void_mentions_activity_log
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'void_sale'
   limit 1;

  if coalesce(v_void_mentions_activity_log, false) then
    raise exception '0227: void_sale still writes to the activity_log table production does not have';
  end if;

  raise notice '0227: returns store their quantity, voids no longer need activity_log';
end
$assert$;
