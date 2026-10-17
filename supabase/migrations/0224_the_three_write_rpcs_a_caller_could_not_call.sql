-- ═══════════════════════════════════════════════════════════════════════════════
-- 0224 — The three write RPCs a caller could not actually call
--
-- MEASURED ON PRODUCTION 2026-10-17, as the owner, inside a rolled-back transaction:
--
--   select public.create_sale('{"customerName":"x", …}'::jsonb);
--   ERROR: column "payload" does not exist
--
-- Not a permission error, not a validation error — the function body names a variable that does not
-- exist. Three of the eight write RPCs are in that state:
--
--   create_sale(jsonb) · create_purchase(jsonb) · adjust_stock(jsonb)
--
-- ROOT CAUSE. Their parameters are named `p_payload`, and the guard that `0192` (re-issued by `0213`)
-- injected opens every body with
--
--   PERFORM public.guard_operational_request('<name>', payload);
--
-- `0213` was extracting each function's body from the ledger and splicing that call in after `BEGIN`.
-- It assumed the parameter was named `payload` — true on staging, where those functions had been
-- rewritten, and false on production, where `0208` had just recreated the *older* bodies that name
-- it `p_payload`. The splice is textual, so it compiled and then failed at the first call: the
-- function now refers to a column that does not exist, and every sale, purchase and stock adjustment
-- through the app would raise.
--
-- WHY THE FIX IS A RE-DEFINITION, NOT A RENAME. Production's bodies are also out of date in a way the
-- rename would hide: its `create_sale` is the pre-`0134` version that writes a sale with no
-- shop/branch resolution and no idempotency wrapper. The bodies below are staging's — the ones the
-- app has been exercised against, including `create_sale`'s idempotent wrapper around
-- `create_sale_unchecked` (0214), which is where the branch stamping of 0222 applies.
--
-- The drop and the recreate are in one transaction per file, so there is no window in which the RPC
-- is missing. `create or replace` alone cannot do it: PostgreSQL refuses a replace across a
-- parameter rename.
-- ═══════════════════════════════════════════════════════════════════════════════

-- Production's `sales` also carries a legacy `customer_name NOT NULL` that staging does not have at
-- all. The working body writes `customer_name_snapshot` (the column the app reads) and nothing else,
-- so the constraint rejects every sale. It becomes nullable, matching the shape the body is written
-- for; an insert that still supplies it is unaffected.
do $legacy$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'sales' and column_name = 'customer_name') then
    execute 'alter table public.sales alter column customer_name drop not null';
    execute 'alter table public.sales alter column customer_name set default ''''';
  end if;
end
$legacy$;

-- The purchase screens read `amount_due` and the working body writes it; production never received
-- the columns that the post-0208 shape uses. They are added with the values the body and the UI
-- expect, and the legacy `outstanding_payable` is kept in step for any older reader.
alter table public.purchases add column if not exists amount_due numeric not null default 0;
alter table public.purchases add column if not exists status text not null default 'completed';
alter table public.purchases add column if not exists notes text;
alter table public.purchases add column if not exists recorded_by varchar;
alter table public.purchases add column if not exists recorded_by_name varchar;
alter table public.purchases add column if not exists due_date date;

update public.purchases
   set amount_due = coalesce(outstanding_payable, 0)
 where amount_due = 0 and coalesce(outstanding_payable, 0) <> 0;

alter table public.purchase_items add column if not exists unit_price numeric not null default 0;
alter table public.purchase_items add column if not exists base_unit varchar not null default 'piece';

update public.purchase_items
   set unit_price = coalesce(cost_price, 0)
 where unit_price = 0 and coalesce(cost_price, 0) <> 0;

-- The idempotency ledger `0134`'s wrapper writes through, missing on production for the same reason
-- the bodies above are stale: `0207`/`0208` recreated relations from staging's schema list, and this one
-- never made the list. Shape and access copied from staging, where the wrapper has been exercised.
create table if not exists public.sale_submissions (
  shop_id uuid not null references public.shops(id) on delete cascade,
  idempotency_key text not null,
  sale_id uuid references public.sales(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (shop_id, idempotency_key)
);

alter table public.sale_submissions enable row level security;

do $access$
begin
  drop policy if exists sale_submissions_no_client_access on public.sale_submissions;
  create policy sale_submissions_no_client_access on public.sale_submissions
    for all to anon, authenticated using (false) with check (false);
  revoke all on table public.sale_submissions from public, anon;
  grant select, insert on table public.sale_submissions to authenticated;
end
$access$;

-- drop the mis-parameterised definition, then install the working one (same transaction)
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
  v_before numeric(12,2);
  v_after numeric(12,2);
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

  SELECT shop_id INTO v_shop FROM products WHERE id = v_product_id;
  PERFORM authorize_business_action('inventory.adjust', COALESCE(v_shop, current_shop_id()));

  IF v_product_id IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product ID is required';
  END IF;
  IF v_shop IS NULL THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND: Product does not belong to your organization';
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

  SELECT stock_qty INTO v_before FROM products WHERE id = v_product_id;
  IF v_before IS NULL THEN v_before := 0; END IF;

  IF v_adjustment_type = 'add' THEN
    v_after := v_before + v_qty;
  ELSIF v_adjustment_type = 'remove' THEN
    v_after := GREATEST(0, v_before - v_qty);
  ELSIF v_adjustment_type = 'set' THEN
    v_after := v_qty;
  ELSE
    RAISE EXCEPTION 'INVALID_ADJUSTMENT_TYPE: Unknown adjustment type: %', v_adjustment_type;
  END IF;

  IF v_after = v_before THEN
    RAISE EXCEPTION 'NO_CHANGE: Adjustment does not change stock level';
  END IF;

  IF v_after < 0 THEN
    RAISE EXCEPTION 'NEGATIVE_STOCK: Adjustment would make stock negative';
  END IF;

  v_id := gen_random_uuid();

  BEGIN
    INSERT INTO stock_adjustments (id, product_id, product_name, variant_id, variant_name,
      adjustment_type, qty_before, qty_change, qty_after, reason, adjusted_by, idempotency_key, created_at)
    VALUES (v_id, v_product_id,
      COALESCE(payload->>'productName', (SELECT name FROM public.products WHERE id = v_product_id)),
      v_variant_id, COALESCE(payload->>'variantName', ''),
      v_adjustment_type::adjustment_kind, v_before, v_after - v_before, v_after,
      payload->>'reason', v_actor, v_key, now());

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

  UPDATE products SET stock_qty = v_after, updated_at = now() WHERE id = v_product_id;

  IF v_variant_id IS NOT NULL THEN
    UPDATE product_variants SET stock_qty = v_after, updated_at = now() WHERE id = v_variant_id;
  END IF;

  INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
    reference_type, reference_id, created_by, created_at)
  VALUES (
    v_product_id,
    v_variant_id,
    'adjustment', v_before, v_after - v_before, v_after,
    'adjustment', v_id, v_actor, now()
  );

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'stock_adjusted', 'product', v_product_id,
    jsonb_build_object('type', v_adjustment_type, 'before', v_before, 'after', v_after));

  PERFORM public.guard_operational_request('adjust_stock',payload);
 RETURN jsonb_build_object(
    'id', v_id,
    'qtyBefore', v_before,
    'qtyChange', v_after - v_before,
    'qtyAfter', v_after
  );
END;
$function$
;

grant execute on function public.adjust_stock(jsonb) to authenticated;
revoke execute on function public.adjust_stock(jsonb) from public, anon;

-- drop the mis-parameterised definition, then install the working one (same transaction)
drop function if exists public.create_purchase(jsonb);

CREATE OR REPLACE FUNCTION public.create_purchase(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_number text;
  v_total numeric(14,4):=0;
  v_paid numeric(14,4);
  v_item jsonb;
  v_company_name text;
  v_shop_id uuid;
  v_resolved jsonb;
  v_actor uuid;
  v_key text;
  v_existing record;
  v_qty numeric(14,4);
  v_unit numeric(14,4);
  v_line numeric(14,4);
  v_sell numeric(14,4);
  v_before numeric(14,4);
  v_after numeric(14,4);
BEGIN
  PERFORM public.guard_operational_request('create_purchase',payload);
  v_actor := app_current_user_id();
  v_resolved:=resolve_shop_and_actor(NULLIF(payload->>'shopId','')::uuid,NULLIF(payload->>'userId','')::uuid,NULLIF(payload->>'createdBy','')::uuid);
  v_shop_id:=(v_resolved->>'shop_id')::uuid;
  PERFORM authorize_business_action('purchases.create',v_shop_id,NULLIF(payload->>'branchId','')::uuid);

  v_key := NULLIF(COALESCE(payload->>'idempotencyKey', payload->>'idempotency_key'), '');
  IF v_key IS NOT NULL THEN
    SELECT p.id, p.purchase_number, p.total_amount, p.amount_due
      INTO v_existing
      FROM purchases p
     WHERE p.idempotency_key = v_key AND p.shop_id = v_shop_id
     LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
      PERFORM public.guard_operational_request('create_purchase',payload);
 RETURN jsonb_build_object(
        'id', v_existing.id,
        'purchaseNumber', v_existing.purchase_number,
        'totalAmount', v_existing.total_amount,
        'outstandingPayable', COALESCE(v_existing.amount_due, 0),
        'idempotent', true
      );
    END IF;
  END IF;

  v_number:='PUR-'||LPAD(FLOOR(RANDOM()*99999)::text,5,'0');
  v_paid:=COALESCE((payload->>'amountPaid')::numeric,0);
  SELECT name INTO v_company_name FROM companies WHERE id=(payload->>'companyId')::uuid AND shop_id=v_shop_id;

  BEGIN
    INSERT INTO purchases(id,purchase_number,company_id,company_name,total_amount,amount_paid,amount_due,status,notes,shop_id,recorded_by,idempotency_key,created_at,updated_at)
    VALUES(gen_random_uuid(),v_number,NULLIF(payload->>'companyId','')::uuid,COALESCE(v_company_name,'Unknown'),0,v_paid,0,'completed',payload->>'note',v_shop_id,v_actor::text,v_key,now(),now()) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT p.id, p.purchase_number, p.total_amount, p.amount_due
      INTO v_existing
      FROM purchases p
     WHERE p.idempotency_key = v_key AND p.shop_id = v_shop_id
     LIMIT 1;

    PERFORM public.guard_operational_request('create_purchase',payload);
 RETURN jsonb_build_object(
      'id', v_existing.id,
      'purchaseNumber', v_existing.purchase_number,
      'totalAmount', v_existing.total_amount,
      'outstandingPayable', COALESCE(v_existing.amount_due, 0),
      'idempotent', true
    );
  END;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'items','[]'::jsonb)) LOOP
    v_qty := COALESCE((v_item->>'qty')::numeric, 0);
    v_unit := COALESCE((v_item->>'costPrice')::numeric, 0);
    v_line := COALESCE((v_item->>'lineTotal')::numeric, v_qty * v_unit);
    v_total := v_total + v_line;

    INSERT INTO purchase_items(id,purchase_id,product_id,product_name,variant_id,variant_name,qty,unit_price,unit_size,base_unit,line_total)
    VALUES(gen_random_uuid(),v_id,NULLIF(v_item->>'productId','')::uuid,v_item->>'productName',NULLIF(v_item->>'variantId','')::uuid,COALESCE(v_item->>'variantName',''),v_qty,v_unit,COALESCE((v_item->>'unitSize')::numeric,1),COALESCE(v_item->>'baseUnit','piece'),v_line);

    IF NULLIF(v_item->>'variantId','') IS NOT NULL THEN
      v_sell := COALESCE((v_item->>'sellingPrice')::numeric, 0);
      SELECT stock_qty INTO v_before FROM product_variants WHERE id = (v_item->>'variantId')::uuid FOR UPDATE;
      v_before := COALESCE(v_before, 0);
      v_after := v_before + v_qty;
      UPDATE product_variants
         SET stock_qty = v_after,
             cost_price    = CASE WHEN v_unit > 0 THEN v_unit ELSE cost_price END,
             selling_price = CASE WHEN v_sell > 0 THEN v_sell ELSE selling_price END
       WHERE id = (v_item->>'variantId')::uuid;

      INSERT INTO inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change, qty_after,
        reference_type, reference_id, unit_cost, created_by, created_at)
      VALUES (NULLIF(v_item->>'productId','')::uuid, (v_item->>'variantId')::uuid, 'purchase', v_before, v_qty, v_after,
        'purchase', v_id, v_unit, v_actor, now());
    END IF;
  END LOOP;

  UPDATE purchases SET total_amount=v_total,amount_due=GREATEST(0,v_total-v_paid),updated_at=now() WHERE id=v_id;

  IF NULLIF(payload->>'companyId','') IS NOT NULL THEN
    UPDATE companies SET outstanding_payable=outstanding_payable+(v_total-v_paid),total_purchases=total_purchases+v_total,updated_at=now() WHERE id=(payload->>'companyId')::uuid AND shop_id=v_shop_id;
  END IF;

  INSERT INTO audit_events(user_id, action, entity_type, entity_id, details)
  VALUES (v_actor, 'purchase_recorded', 'purchase', v_id,
          jsonb_build_object('purchaseNumber', v_number, 'totalAmount', v_total, 'shopId', v_shop_id));

  PERFORM public.guard_operational_request('create_purchase',payload);
 RETURN jsonb_build_object('id',v_id,'purchaseNumber',v_number,'totalAmount',v_total,'outstandingPayable',GREATEST(0,v_total-v_paid));
END; $function$
;

grant execute on function public.create_purchase(jsonb) to authenticated;
revoke execute on function public.create_purchase(jsonb) from public, anon;

-- drop the mis-parameterised definition, then install the working one (same transaction)
drop function if exists public.create_sale(jsonb);

CREATE OR REPLACE FUNCTION public.create_sale(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key      text;
  v_shop_id  uuid;
  v_actor    uuid;
  v_existing record;
  v_out      jsonb;
BEGIN
  PERFORM public.guard_operational_request('create_sale',payload);
  v_key := NULLIF(COALESCE(payload->>'idempotencyKey', payload->>'idempotency_key'), '');
  IF v_key IS NULL THEN
    RETURN public.create_sale_unchecked(payload);
  END IF;

  SELECT (r->>'shop_id')::uuid, (r->>'actor_id')::uuid
    INTO v_shop_id, v_actor
    FROM (SELECT public.resolve_shop_and_actor(
            NULLIF(payload->>'shopId', '')::uuid,
            NULLIF(payload->>'userId', '')::uuid,
            NULLIF(payload->>'createdBy', '')::uuid) AS r) s;

  PERFORM public.authorize_business_action('sales.create', v_shop_id, NULLIF(payload->>'branchId', '')::uuid);

  INSERT INTO public.sale_submissions (shop_id, idempotency_key)
  VALUES (v_shop_id, v_key)
  ON CONFLICT (shop_id, idempotency_key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT s.id, s.sale_number, s.total_amount, s.amount_paid, s.amount_due
      INTO v_existing
      FROM public.sale_submissions ss
      JOIN public.sales s ON s.id = ss.sale_id
     WHERE ss.shop_id = v_shop_id AND ss.idempotency_key = v_key;

    IF v_existing.id IS NOT NULL THEN
      PERFORM public.guard_operational_request('create_sale',payload);
 RETURN jsonb_build_object(
        'id', v_existing.id,
        'saleNumber', v_existing.sale_number,
        'totalAmount', v_existing.total_amount,
        'amountPaid', v_existing.amount_paid,
        'outstandingBalance', v_existing.amount_due,
        'duplicate', true
      );
    END IF;

    RAISE EXCEPTION 'DUPLICATE_SUBMISSION';
  END IF;

  v_out := public.create_sale_unchecked(payload);

  UPDATE public.sale_submissions
     SET sale_id = (v_out->>'id')::uuid
   WHERE shop_id = v_shop_id AND idempotency_key = v_key;

  RETURN v_out;
END; $function$
;

grant execute on function public.create_sale(jsonb) to authenticated;
revoke execute on function public.create_sale(jsonb) from public, anon;

-- Assert the defect is gone: no write RPC may reference `payload` unless that is its parameter.
do $assert$
declare
  r record;
  v_bad text[] := '{}';
begin
  for r in
    select p.oid::regprocedure::text as sig,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_functiondef(p.oid) as def
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('create_sale', 'create_purchase', 'adjust_stock')
  loop
    if r.args = 'p_payload jsonb' then
      v_bad := v_bad || r.sig;
    end if;
    if position('PERFORM public.guard_operational_request' in r.def) = 0 then
      v_bad := v_bad || (r.sig || ' (no guard)');
    end if;
  end loop;

  if cardinality(v_bad) > 0 then
    raise exception '0224: still mis-parameterised: %', array_to_string(v_bad, ', ');
  end if;

  raise notice '0224: create_sale, create_purchase and adjust_stock take their guard''s payload by name';
end
$assert$;
