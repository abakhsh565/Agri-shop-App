-- 0258 — the money paid when a delivery is recorded is a payment, not a footnote.
--
-- WHAT WAS WRONG. `create_purchase` reduced the supplier's payable by the advance
-- (`total - amountPaid`) and kept `purchases.amount_paid` on the bill — but never wrote the
-- advance into `supplier_payments`. Three consequences followed, and all three are the report
-- that opened this file:
--
--   * The supplier's Payments tab, the supplier-payments screen and the payments ledger listed
--     every payment EXCEPT the one handed over when the delivery was booked, so the history was
--     incomplete exactly where the money was largest (the advance is usually the biggest part).
--   * "Paid to suppliers" understated what had actually left the shop by the whole sum of
--     advances, while the balance it was being compared against already counted them.
--   * Two formulas described the same debt: the branch balance added
--     `purchases.amount_paid` + `supplier_payments`, while the supplier's own total was
--     maintained by hand in `create_purchase`/`record_supplier_payment`. Either could be
--     changed without the other noticing.
--
-- WHAT THIS DOES. Money going out to a supplier has one home: `supplier_payments`. The advance
-- is written there when the bill is booked, linked to that bill through `purchase_id` (so the
-- history can say which delivery it paid for, and a replay cannot pay it twice). The branch
-- balance is the bills minus that one ledger. `purchases.amount_paid` stays as the bill's own
-- snapshot of what was paid when it was recorded — the number the bill prints — and is no
-- longer a second source of the balance.
--
-- EXISTING DATA IS NOT REPRICED. Every advance already on the books is backfilled from the
-- bill itself, with the bill's own branch, method and timestamp, so money that counted through
-- `purchases.amount_paid` now counts through the payment row for the same money. Each supplier
-- therefore keeps exactly the balance they had before this file ran; what changes is that the
-- payments screens can finally see it.
--
-- Idempotent and forward-only: re-running it adds no column, no index and no payment twice.

-- ── 1. A bill remembers how its advance was paid ──────────────────────────────────────────────
-- The order form has always sent a method and the database has always dropped it, so a bill
-- could only ever say "cash". The enum is not widened here: the app offers cash and bank
-- transfer, and an unknown word falls back to cash in the function below rather than refusing a
-- delivery whose stock has already been counted.
alter table public.purchases
  add column if not exists payment_method public.payment_method not null default 'cash';

-- ── 2. A payment can say which bill it settled ────────────────────────────────────────────────
alter table public.supplier_payments
  add column if not exists purchase_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'supplier_payments_purchase_id_fkey'
  ) then
    alter table public.supplier_payments
      add constraint supplier_payments_purchase_id_fkey
      foreign key (purchase_id) references public.purchases(id) on delete cascade;
  end if;
end
$$;

-- One advance per bill, enforced by the database rather than by the caller remembering. A
-- conflict target is deliberately absent from the insert below because this index IS the rule.
create unique index if not exists supplier_payments_one_advance_per_bill
  on public.supplier_payments (purchase_id)
  where purchase_id is not null;

-- ── 3. Backfill: every advance already recorded becomes the payment it always was ─────────────
-- Guarded by the bill link, so a second run inserts nothing. Cancelled bills are skipped for the
-- same reason the balance function skips them: they are not a debt.
insert into public.supplier_payments
  (id, company_id, amount, method, notes, recorded_by, recorded_by_name, branch_id, purchase_id, created_at)
select gen_random_uuid(),
       p.company_id,
       p.amount_paid,
       p.payment_method,
       null,
       p.recorded_by,
       null,
       p.branch_id,
       p.id,
       p.created_at
  from public.purchases p
 where p.amount_paid > 0
   and p.company_id is not null
   and coalesce(p.status, 'completed') <> 'cancelled'
   and not exists (
     select 1 from public.supplier_payments sp where sp.purchase_id = p.id
   )
on conflict do nothing;

-- ── 4. The bill records the advance, once, as a payment ───────────────────────────────────────
-- Unchanged in shape from 0224 except where marked: the paid amount is clamped to the bill
-- (a bill cannot be paid more than it is worth) and the advance reaches the ledger.
create or replace function public.create_purchase(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_number text;
  v_total numeric(14,4) := 0;
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
  v_method public.payment_method := 'cash';
  v_branch uuid;
begin
  perform public.guard_operational_request('create_purchase', payload);
  v_actor := app_current_user_id();
  v_resolved := resolve_shop_and_actor(
    nullif(payload->>'shopId','')::uuid,
    nullif(payload->>'userId','')::uuid,
    nullif(payload->>'createdBy','')::uuid
  );
  v_shop_id := (v_resolved->>'shop_id')::uuid;
  perform authorize_business_action('purchases.create', v_shop_id, nullif(payload->>'branchId','')::uuid);

  v_key := nullif(coalesce(payload->>'idempotencyKey', payload->>'idempotency_key'), '');
  if v_key is not null then
    select p.id, p.purchase_number, p.total_amount, p.amount_due
      into v_existing
      from purchases p
     where p.idempotency_key = v_key and p.shop_id = v_shop_id
     limit 1;

    if v_existing.id is not null then
      perform public.guard_operational_request('create_purchase', payload);
      return jsonb_build_object(
        'id', v_existing.id,
        'purchaseNumber', v_existing.purchase_number,
        'totalAmount', v_existing.total_amount,
        'outstandingPayable', coalesce(v_existing.amount_due, 0),
        'idempotent', true
      );
    end if;
  end if;

  -- How the advance was handed over. A word the enum does not know is treated as cash: the
  -- delivery is the job, and refusing it over a label would leave the stock uncounted.
  begin
    v_method := coalesce(nullif(payload->>'paymentMethod',''), 'cash')::public.payment_method;
  exception when invalid_text_representation then
    v_method := 'cash';
  end;

  v_number := 'PUR-' || lpad(floor(random() * 99999)::text, 5, '0');
  v_paid := coalesce((payload->>'amountPaid')::numeric, 0);
  select name into v_company_name
    from companies
   where id = (payload->>'companyId')::uuid and shop_id = v_shop_id;

  begin
    insert into purchases(id, purchase_number, company_id, company_name, total_amount, amount_paid,
                          amount_due, status, notes, shop_id, recorded_by, payment_method,
                          idempotency_key, created_at, updated_at)
    values(gen_random_uuid(), v_number, nullif(payload->>'companyId','')::uuid,
           coalesce(v_company_name, 'Unknown'), 0, v_paid, 0, 'completed', payload->>'note',
           v_shop_id, v_actor::text, v_method, v_key, now(), now())
    returning id, branch_id into v_id, v_branch;
  exception when unique_violation then
    select p.id, p.purchase_number, p.total_amount, p.amount_due
      into v_existing
      from purchases p
     where p.idempotency_key = v_key and p.shop_id = v_shop_id
     limit 1;

    perform public.guard_operational_request('create_purchase', payload);
    return jsonb_build_object(
      'id', v_existing.id,
      'purchaseNumber', v_existing.purchase_number,
      'totalAmount', v_existing.total_amount,
      'outstandingPayable', coalesce(v_existing.amount_due, 0),
      'idempotent', true
    );
  end;

  for v_item in select * from jsonb_array_elements(coalesce(payload->'items','[]'::jsonb)) loop
    v_qty := coalesce((v_item->>'qty')::numeric, 0);
    v_unit := coalesce((v_item->>'costPrice')::numeric, 0);
    v_line := coalesce((v_item->>'lineTotal')::numeric, v_qty * v_unit);
    v_total := v_total + v_line;

    insert into purchase_items(id, purchase_id, product_id, product_name, variant_id, variant_name,
                               qty, unit_price, unit_size, base_unit, line_total)
    values(gen_random_uuid(), v_id, nullif(v_item->>'productId','')::uuid, v_item->>'productName',
           nullif(v_item->>'variantId','')::uuid, coalesce(v_item->>'variantName',''), v_qty, v_unit,
           coalesce((v_item->>'unitSize')::numeric, 1), coalesce(v_item->>'baseUnit','piece'), v_line);

    if nullif(v_item->>'variantId','') is not null then
      v_sell := coalesce((v_item->>'sellingPrice')::numeric, 0);
      select stock_qty into v_before from product_variants
       where id = (v_item->>'variantId')::uuid for update;
      v_before := coalesce(v_before, 0);
      v_after := v_before + v_qty;
      update product_variants
         set stock_qty = v_after,
             cost_price = case when v_unit > 0 then v_unit else cost_price end,
             selling_price = case when v_sell > 0 then v_sell else selling_price end
       where id = (v_item->>'variantId')::uuid;

      insert into inventory_movements (product_id, variant_id, movement_type, qty_before, qty_change,
        qty_after, reference_type, reference_id, unit_cost, created_by, created_at)
      values (nullif(v_item->>'productId','')::uuid, (v_item->>'variantId')::uuid, 'purchase',
        v_before, v_qty, v_after, 'purchase', v_id, v_unit, v_actor, now());
    end if;
  end loop;

  -- A bill cannot be paid more than it is worth. Paying 120,000 against a delivery of 100,000 is
  -- not a 20,000 credit against this bill, and recording it would drive the payable negative; the
  -- extra belongs in a payment of its own, on the supplier's page. This is the same clamp the
  -- order form applies before it sends the number.
  v_paid := least(greatest(coalesce(v_paid, 0), 0), v_total);

  update purchases
     set total_amount = v_total,
         amount_paid = v_paid,
         amount_due = greatest(0, v_total - v_paid),
         updated_at = now()
   where id = v_id
   returning branch_id into v_branch;

  -- The advance is money that left the shop, so it is written where every other payment lives,
  -- linked to the bill it settled. The unique index on `purchase_id` is what makes a replay of
  -- this delivery unable to pay it twice, which matters because the idempotency key above only
  -- guards the purchase row itself.
  if v_paid > 0 and nullif(payload->>'companyId','') is not null then
    insert into supplier_payments (id, company_id, amount, method, recorded_by, branch_id,
                                   purchase_id, created_at)
    values (gen_random_uuid(), (payload->>'companyId')::uuid, v_paid, v_method, v_actor::text,
            v_branch, v_id, now())
    on conflict do nothing;
  end if;

  if nullif(payload->>'companyId','') is not null then
    update companies
       set outstanding_payable = greatest(0, coalesce(outstanding_payable, 0) + (v_total - v_paid)),
           total_purchases = coalesce(total_purchases, 0) + v_total,
           updated_at = now()
     where id = (payload->>'companyId')::uuid and shop_id = v_shop_id;
  end if;

  insert into audit_events(user_id, action, entity_type, entity_id, details)
  values (v_actor, 'purchase_recorded', 'purchase', v_id,
          jsonb_build_object('purchaseNumber', v_number, 'totalAmount', v_total,
                             'amountPaid', v_paid, 'shopId', v_shop_id));

  perform public.guard_operational_request('create_purchase', payload);
  return jsonb_build_object('id', v_id, 'purchaseNumber', v_number, 'totalAmount', v_total,
                            'amountPaid', v_paid, 'outstandingPayable', greatest(0, v_total - v_paid));
end;
$$;

-- ── 5. One balance, from the one ledger ───────────────────────────────────────────────────────
-- `purchases.amount_paid` is removed from the sum because the same money is now the advance row
-- in `supplier_payments`; leaving it in would count every advance twice. The bills still supply
-- what was bought; the payments supply what was paid — one source each.
create or replace function public.get_branch_company_balances()
returns table (company_id uuid, total_purchases numeric, total_paid numeric, outstanding_payable numeric)
language sql
stable
security definer
set search_path = public
as $$
  with b as (select public.current_branch_id() as id),
  bought as (
    select p.company_id, sum(p.total_amount) as total
      from public.purchases p, b
     where p.shop_id = public.current_shop_id()
       and p.branch_id = b.id
       and p.status <> 'cancelled'
       and p.company_id is not null
     group by p.company_id
  ),
  paid as (
    select sp.company_id, sum(sp.amount) as amount
      from public.supplier_payments sp
      join public.companies c on c.id = sp.company_id
      join b on b.id = sp.branch_id
     where c.shop_id = public.current_shop_id()
       and sp.company_id is not null
     group by sp.company_id
  )
  select c.id,
         coalesce(bought.total, 0),
         coalesce(paid.amount, 0),
         greatest(coalesce(bought.total, 0) - coalesce(paid.amount, 0), 0)
    from public.companies c
    left join bought on bought.company_id = c.id
    left join paid on paid.company_id = c.id
   where c.shop_id = public.current_shop_id()
     and c.is_active = true
     and public.company_in_branch(c.id);
$$;

grant execute on function public.get_branch_company_balances() to authenticated;
revoke all on function public.get_branch_company_balances() from public, anon;
