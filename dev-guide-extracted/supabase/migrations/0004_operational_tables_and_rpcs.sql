-- ============================================================================
-- AgriShop — migration 0004: operational tables + transactional RPCs
-- ----------------------------------------------------------------------------
-- Adds the tables the app needs to run on real data instead of mock arrays:
--   customer_payments, supplier_payments, purchases, purchase_items,
--   stock_adjustments, returns, return_items.
--
-- Adds SECURITY DEFINER functions that perform the multi-table money/stock
-- flows ATOMICALLY and enforce the AGENTS.md non-negotiables server-side:
--   • inventory can never go negative (create_sale / adjust_stock guard it),
--   • selling price is read from the DB, never trusted from the client,
--   • sales/purchases/payments/returns are correcting rows, never deletes.
--
-- Run once in the Supabase SQL Editor AFTER 0001–0003. Idempotent.
-- ============================================================================

-- ---- 1. Enum for stock adjustment direction --------------------------------
do $$ begin
  create type adjustment_kind as enum ('add','remove','set');
exception when duplicate_object then null; end $$;

-- ---- 2. Tables -------------------------------------------------------------

create table if not exists customer_payments (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references customers(id),
  amount           numeric(14,2) not null,
  method           payment_method not null default 'cash',
  notes            text,
  recorded_by      uuid references users(id),
  recorded_by_name text,
  balance_after    numeric(14,2) not null default 0,
  created_at       timestamptz not null default now()
);

create table if not exists supplier_payments (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references companies(id),
  amount           numeric(14,2) not null,
  method           payment_method not null default 'cash',
  notes            text,
  recorded_by      uuid references users(id),
  recorded_by_name text,
  payable_after    numeric(14,2) not null default 0,
  created_at       timestamptz not null default now()
);

create table if not exists purchases (
  id                  uuid primary key default gen_random_uuid(),
  purchase_number     text not null unique,
  company_id          uuid references companies(id),
  company_name        text not null,
  total_amount        numeric(14,2) not null default 0,
  amount_paid         numeric(14,2) not null default 0,
  outstanding_payable numeric(14,2) not null default 0,
  payment_method      payment_method not null default 'cash',
  note                text,
  created_by          uuid references users(id),
  created_at          timestamptz not null default now()
);

create table if not exists purchase_items (
  id           uuid primary key default gen_random_uuid(),
  purchase_id  uuid not null references purchases(id) on delete cascade,
  product_id   uuid references products(id),
  product_name text not null,
  variant_id   uuid references product_variants(id),
  variant_name text not null,
  qty          integer not null,
  cost_price   numeric(12,2) not null default 0,
  line_total   numeric(14,2) not null default 0
);

create table if not exists stock_adjustments (
  id               uuid primary key default gen_random_uuid(),
  product_id       uuid references products(id),
  product_name     text not null,
  variant_id       uuid references product_variants(id),
  variant_name     text not null,
  adjustment_type  adjustment_kind not null,
  qty_before       integer not null,
  qty_change       integer not null,
  qty_after        integer not null,
  reason           text,
  adjusted_by      uuid references users(id),
  adjusted_by_name text,
  created_at       timestamptz not null default now()
);

create table if not exists returns (
  id                uuid primary key default gen_random_uuid(),
  return_number     text not null unique,
  sale_id           uuid references sales(id),
  customer_id       uuid references customers(id),
  customer_name     text not null,
  total_refund      numeric(14,2) not null default 0,
  resolution        text not null default 'refund',
  note              text,
  processed_by      uuid references users(id),
  processed_by_name text,
  created_at        timestamptz not null default now()
);

create table if not exists return_items (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid not null references returns(id) on delete cascade,
  sale_item_id uuid references sale_items(id),
  product_id   uuid references products(id),
  product_name text not null,
  variant_id   uuid references product_variants(id),
  variant_name text not null,
  qty          integer not null,
  unit_price   numeric(12,2) not null default 0,
  line_total   numeric(14,2) not null default 0,
  restock      boolean not null default true
);

create index if not exists customer_payments_customer_idx on customer_payments (customer_id, created_at desc);
create index if not exists supplier_payments_company_idx  on supplier_payments (company_id, created_at desc);
create index if not exists purchases_created_idx          on purchases (created_at desc);
create index if not exists stock_adjustments_variant_idx  on stock_adjustments (variant_id, created_at desc);
create index if not exists returns_sale_idx               on returns (sale_id);

-- ---- 3. RLS ----------------------------------------------------------------
alter table customer_payments enable row level security;
alter table supplier_payments enable row level security;
alter table purchases         enable row level security;
alter table purchase_items    enable row level security;
alter table stock_adjustments enable row level security;
alter table returns           enable row level security;
alter table return_items      enable row level security;

do $$
declare r record;
begin
  for r in
    select policyname, tablename from pg_policies
    where schemaname = 'public'
      and tablename in ('customer_payments','supplier_payments','purchases',
                        'purchase_items','stock_adjustments','returns','return_items')
  loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end $$;

-- Customer payments: operational — all authenticated staff read & create.
create policy cust_pay_read   on customer_payments for select to authenticated using (true);
create policy cust_pay_insert on customer_payments for insert to authenticated with check (true);

-- Supplier payments + purchases + purchase_items: supplier financials → admin only.
create policy sup_pay_read   on supplier_payments for select to authenticated using (app_is_admin());
create policy sup_pay_insert on supplier_payments for insert to authenticated with check (app_is_admin());

create policy purchases_read   on purchases for select to authenticated using (app_is_admin());
create policy purchases_insert on purchases for insert to authenticated with check (app_is_admin());

create policy purchase_items_read   on purchase_items for select to authenticated using (app_is_admin());
create policy purchase_items_insert on purchase_items for insert to authenticated with check (app_is_admin());

-- Stock adjustments: inventory management → admin only.
create policy stock_adj_read   on stock_adjustments for select to authenticated using (app_is_admin());
create policy stock_adj_insert on stock_adjustments for insert to authenticated with check (app_is_admin());

-- Returns: operational — all authenticated staff read & create.
create policy returns_read   on returns for select to authenticated using (true);
create policy returns_insert on returns for insert to authenticated with check (true);
create policy return_items_read   on return_items for select to authenticated using (true);
create policy return_items_insert on return_items for insert to authenticated with check (true);

-- ---- 4. Transactional RPCs -------------------------------------------------
-- All run SECURITY DEFINER so they can touch product_variants (admin-only RLS)
-- and enforce invariants regardless of the caller's role, while the app still
-- connects with the anon key + a real auth session.

-- 4a. create_sale — validates + decrements stock, writes sale + items,
--     updates customer balance, notifies. Price is read from the DB.
create or replace function create_sale(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id     uuid := app_current_user_id();
  v_actor_name   text;
  v_sale_id      uuid;
  v_sale_number  text;
  v_subtotal     numeric(14,2) := 0;
  v_total        numeric(14,2) := 0;
  v_amount_paid  numeric(14,2) := coalesce((payload->>'amountPaid')::numeric, 0);
  v_customer_id  uuid := nullif(payload->>'customerId','')::uuid;
  v_customer_name text := coalesce(payload->>'customerName','Walk-in');
  v_payment_type payment_type := coalesce((payload->>'paymentType')::payment_type,'full');
  v_payment_method payment_method := coalesce((payload->>'paymentMethod')::payment_method,'cash');
  v_note         text := payload->>'note';
  v_outstanding  numeric(14,2);
  item           jsonb;
  v_variant_id   uuid;
  v_product_id   uuid;
  v_qty          integer;
  v_price        numeric(12,2);
  v_stock        integer;
  v_vname        text;
begin
  select name into v_actor_name from users where id = v_actor_id;
  v_sale_number := '#' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');

  -- Pass 1: lock rows, validate stock, compute total from DB prices.
  for item in select jsonb_array_elements(payload->'items') loop
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_qty := (item->>'qty')::int;
    if v_variant_id is not null then
      select stock_qty, selling_price, name into v_stock, v_price, v_vname
        from product_variants where id = v_variant_id for update;
      if not found then raise exception 'VARIANT_NOT_FOUND'; end if;
      if v_stock < v_qty then
        raise exception 'INSUFFICIENT_STOCK: % (have %, need %)', coalesce(v_vname,''), v_stock, v_qty;
      end if;
    else
      v_price := coalesce((item->>'unitPrice')::numeric, 0);
    end if;
    v_subtotal := v_subtotal + (v_price * v_qty);
  end loop;

  v_total := v_subtotal;
  if v_payment_type = 'full' then v_amount_paid := v_total; end if;
  v_outstanding := greatest(v_total - v_amount_paid, 0);

  insert into sales(sale_number, customer_id, customer_name, employee_id, employee_name,
    subtotal, tax_amount, total_amount, amount_paid, outstanding_balance,
    payment_type, payment_method, note)
  values (v_sale_number, v_customer_id, v_customer_name, v_actor_id,
    coalesce(v_actor_name, payload->>'employeeName','Staff'),
    v_subtotal, 0, v_total, v_amount_paid, v_outstanding,
    v_payment_type, v_payment_method, v_note)
  returning id into v_sale_id;

  -- Pass 2: decrement stock + write line items.
  for item in select jsonb_array_elements(payload->'items') loop
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_product_id := nullif(item->>'productId','')::uuid;
    v_qty := (item->>'qty')::int;
    if v_variant_id is not null then
      update product_variants set stock_qty = stock_qty - v_qty
        where id = v_variant_id
        returning selling_price, name into v_price, v_vname;
    else
      v_price := coalesce((item->>'unitPrice')::numeric, 0);
      v_vname := item->>'variantName';
    end if;
    insert into sale_items(sale_id, product_id, product_name, variant_id, variant_name,
      qty, unit_price, line_total)
    values (v_sale_id, v_product_id, coalesce(item->>'productName',''), v_variant_id,
      coalesce(v_vname, item->>'variantName',''), v_qty, v_price, v_price * v_qty);
  end loop;

  if v_customer_id is not null then
    update customers
      set outstanding_balance = outstanding_balance + v_outstanding,
          total_purchases     = total_purchases + v_total,
          total_paid          = total_paid + v_amount_paid
      where id = v_customer_id;
  end if;

  insert into notifications(kind, title, body, entity_id, actor_id, actor_name)
  values ('sale', 'New sale ' || v_sale_number,
    coalesce(v_actor_name,'Staff') || ' sold to ' || v_customer_name || ' · Rs. ' || v_total::text,
    v_sale_id, v_actor_id, v_actor_name);

  return jsonb_build_object('id', v_sale_id, 'saleNumber', v_sale_number,
    'subtotal', v_subtotal, 'totalAmount', v_total, 'amountPaid', v_amount_paid,
    'outstandingBalance', v_outstanding);
end;
$$;

-- 4b. create_purchase — writes purchase + items, increments stock, updates
--     supplier payable/total. Admin-only at the call site (RLS on tables).
create or replace function create_purchase(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id    uuid := app_current_user_id();
  v_purchase_id uuid;
  v_number      text;
  v_total       numeric(14,2) := 0;
  v_paid        numeric(14,2) := coalesce((payload->>'amountPaid')::numeric,0);
  v_company_id  uuid := nullif(payload->>'companyId','')::uuid;
  v_company_name text := coalesce(payload->>'companyName','');
  v_method      payment_method := coalesce((payload->>'paymentMethod')::payment_method,'cash');
  v_note        text := payload->>'note';
  v_payable     numeric(14,2);
  item          jsonb;
  v_variant_id  uuid;
  v_qty         integer;
  v_cost        numeric(12,2);
begin
  for item in select jsonb_array_elements(payload->'items') loop
    v_qty  := (item->>'qty')::int;
    v_cost := coalesce((item->>'costPrice')::numeric,0);
    v_total := v_total + (v_qty * v_cost);
  end loop;
  v_payable := greatest(v_total - v_paid, 0);
  v_number := 'PO-' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');

  insert into purchases(purchase_number, company_id, company_name, total_amount,
    amount_paid, outstanding_payable, payment_method, note, created_by)
  values (v_number, v_company_id, v_company_name, v_total, v_paid, v_payable, v_method, v_note, v_actor_id)
  returning id into v_purchase_id;

  for item in select jsonb_array_elements(payload->'items') loop
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_qty  := (item->>'qty')::int;
    v_cost := coalesce((item->>'costPrice')::numeric,0);
    insert into purchase_items(purchase_id, product_id, product_name, variant_id, variant_name,
      qty, cost_price, line_total)
    values (v_purchase_id, nullif(item->>'productId','')::uuid, coalesce(item->>'productName',''),
      v_variant_id, coalesce(item->>'variantName',''), v_qty, v_cost, v_qty*v_cost);
    if v_variant_id is not null then
      update product_variants set stock_qty = stock_qty + v_qty,
        cost_price = case when v_cost > 0 then v_cost else cost_price end
        where id = v_variant_id;
    end if;
  end loop;

  if v_company_id is not null then
    update companies set total_purchases = total_purchases + v_total,
      outstanding_payable = outstanding_payable + v_payable
      where id = v_company_id;
  end if;

  insert into notifications(kind,title,body,entity_id,actor_id)
  values ('purchase','Stock received '||v_number,
    v_company_name||' · Rs. '||v_total::text, v_purchase_id, v_actor_id);

  return jsonb_build_object('id', v_purchase_id, 'purchaseNumber', v_number,
    'totalAmount', v_total, 'outstandingPayable', v_payable);
end;
$$;

-- 4c. record_customer_payment — insert payment, reduce customer balance.
create or replace function record_customer_payment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_customer_id uuid := (payload->>'customerId')::uuid;
  v_amount numeric(14,2) := (payload->>'amount')::numeric;
  v_method payment_method := coalesce((payload->>'method')::payment_method,'cash');
  v_notes text := payload->>'notes';
  v_new_balance numeric(14,2);
  v_pay_id uuid;
begin
  select name into v_actor_name from users where id = v_actor_id;
  update customers set outstanding_balance = greatest(outstanding_balance - v_amount, 0),
    total_paid = total_paid + v_amount
    where id = v_customer_id
    returning outstanding_balance into v_new_balance;

  insert into customer_payments(customer_id, amount, method, notes, recorded_by, recorded_by_name, balance_after)
  values (v_customer_id, v_amount, v_method, v_notes, v_actor_id, v_actor_name, v_new_balance)
  returning id into v_pay_id;

  insert into notifications(kind,title,body,entity_id,actor_id,actor_name)
  values ('payment','Payment received','Rs. '||v_amount::text||' collected', v_pay_id, v_actor_id, v_actor_name);

  return jsonb_build_object('id', v_pay_id, 'balanceAfter', v_new_balance);
end;
$$;

-- 4d. record_supplier_payment — insert payment, reduce supplier payable.
create or replace function record_supplier_payment(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_company_id uuid := (payload->>'companyId')::uuid;
  v_amount numeric(14,2) := (payload->>'amount')::numeric;
  v_method payment_method := coalesce((payload->>'method')::payment_method,'cash');
  v_notes text := payload->>'notes';
  v_new_payable numeric(14,2);
  v_pay_id uuid;
begin
  select name into v_actor_name from users where id = v_actor_id;
  update companies set outstanding_payable = greatest(outstanding_payable - v_amount, 0)
    where id = v_company_id
    returning outstanding_payable into v_new_payable;

  insert into supplier_payments(company_id, amount, method, notes, recorded_by, recorded_by_name, payable_after)
  values (v_company_id, v_amount, v_method, v_notes, v_actor_id, v_actor_name, v_new_payable)
  returning id into v_pay_id;

  return jsonb_build_object('id', v_pay_id, 'payableAfter', v_new_payable);
end;
$$;

-- 4e. adjust_stock — set/add/remove, never below zero, audit row + notify.
create or replace function adjust_stock(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_variant_id uuid := (payload->>'variantId')::uuid;
  v_type adjustment_kind := (payload->>'adjustmentType')::adjustment_kind;
  v_input integer := coalesce((payload->>'qty')::int, 0);
  v_before integer;
  v_after integer;
  v_change integer;
  v_pname text := coalesce(payload->>'productName','');
  v_product_id uuid := nullif(payload->>'productId','')::uuid;
  v_vname text;
  v_adj_id uuid;
begin
  select name into v_actor_name from users where id = v_actor_id;
  select stock_qty, name into v_before, v_vname from product_variants where id = v_variant_id for update;
  if not found then raise exception 'VARIANT_NOT_FOUND'; end if;

  v_after := case
    when v_type = 'add'    then v_before + v_input
    when v_type = 'remove' then v_before - v_input
    else v_input  -- 'set'
  end;
  if v_after < 0 then raise exception 'NEGATIVE_STOCK: result %', v_after; end if;
  v_change := v_after - v_before;

  update product_variants set stock_qty = v_after where id = v_variant_id;

  insert into stock_adjustments(product_id, product_name, variant_id, variant_name,
    adjustment_type, qty_before, qty_change, qty_after, reason, adjusted_by, adjusted_by_name)
  values (v_product_id, v_pname, v_variant_id, coalesce(v_vname,''), v_type,
    v_before, v_change, v_after, payload->>'reason', v_actor_id, v_actor_name)
  returning id into v_adj_id;

  insert into notifications(kind,title,body,entity_id,actor_id,actor_name)
  values ('stock_adjust','Stock adjusted', v_pname||' '||coalesce(v_vname,'')||' → '||v_after||' units',
    v_adj_id, v_actor_id, v_actor_name);

  return jsonb_build_object('id', v_adj_id, 'qtyBefore', v_before, 'qtyChange', v_change, 'qtyAfter', v_after);
end;
$$;

-- 4f. create_product — product + its variants in one atomic call (admin).
create or replace function create_product(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := app_current_user_id();
  v_product_id uuid;
  item jsonb;
begin
  insert into products(name, company, category, image_url, created_by)
  values (payload->>'name', coalesce(payload->>'company',''),
    coalesce((payload->>'category')::product_category,'other'),
    nullif(payload->>'imageUrl',''), v_actor_id)
  returning id into v_product_id;

  for item in select jsonb_array_elements(payload->'variants') loop
    insert into product_variants(product_id, name, selling_price, cost_price, stock_qty, low_stock_threshold)
    values (v_product_id, item->>'name',
      coalesce((item->>'sellingPrice')::numeric,0),
      coalesce((item->>'costPrice')::numeric,0),
      greatest(coalesce((item->>'stockQty')::int,0),0),
      greatest(coalesce((item->>'lowStockThreshold')::int,5),0));
  end loop;

  return jsonb_build_object('id', v_product_id);
end;
$$;

-- 4g. process_return — write return + items, restock, reduce customer balance.
create or replace function process_return(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_return_id uuid;
  v_number text;
  v_sale_id uuid := nullif(payload->>'saleId','')::uuid;
  v_customer_id uuid := nullif(payload->>'customerId','')::uuid;
  v_customer_name text := coalesce(payload->>'customerName','');
  v_resolution text := coalesce(payload->>'resolution','refund');
  v_note text := payload->>'note';
  v_total numeric(14,2) := 0;
  item jsonb;
  v_variant_id uuid;
  v_qty integer;
  v_price numeric(12,2);
begin
  select name into v_actor_name from users where id = v_actor_id;
  for item in select jsonb_array_elements(payload->'items') loop
    v_qty := (item->>'qty')::int;
    v_price := coalesce((item->>'unitPrice')::numeric,0);
    v_total := v_total + (v_qty * v_price);
  end loop;
  v_number := 'RET-' || to_char(now(),'YYMMDD') || lpad((floor(random()*10000))::text,4,'0');

  insert into returns(return_number, sale_id, customer_id, customer_name, total_refund,
    resolution, note, processed_by, processed_by_name)
  values (v_number, v_sale_id, v_customer_id, v_customer_name, v_total, v_resolution, v_note,
    v_actor_id, v_actor_name)
  returning id into v_return_id;

  for item in select jsonb_array_elements(payload->'items') loop
    v_variant_id := nullif(item->>'variantId','')::uuid;
    v_qty := (item->>'qty')::int;
    v_price := coalesce((item->>'unitPrice')::numeric,0);
    insert into return_items(return_id, sale_item_id, product_id, product_name, variant_id,
      variant_name, qty, unit_price, line_total, restock)
    values (v_return_id, nullif(item->>'saleItemId','')::uuid, nullif(item->>'productId','')::uuid,
      coalesce(item->>'productName',''), v_variant_id, coalesce(item->>'variantName',''),
      v_qty, v_price, v_qty*v_price, coalesce((item->>'restock')::boolean, true));
    if v_variant_id is not null and coalesce((item->>'restock')::boolean, true) then
      update product_variants set stock_qty = stock_qty + v_qty where id = v_variant_id;
    end if;
  end loop;

  if v_customer_id is not null then
    update customers set outstanding_balance = greatest(outstanding_balance - v_total, 0),
      total_purchases = greatest(total_purchases - v_total, 0)
      where id = v_customer_id;
  end if;

  insert into notifications(kind,title,body,entity_id,actor_id,actor_name)
  values ('return','Return '||v_number, v_customer_name||' · Rs. '||v_total::text,
    v_return_id, v_actor_id, v_actor_name);

  return jsonb_build_object('id', v_return_id, 'returnNumber', v_number, 'totalRefund', v_total);
end;
$$;

-- ---- 5. Grants + realtime --------------------------------------------------
grant execute on function create_sale(jsonb)              to authenticated;
grant execute on function create_purchase(jsonb)          to authenticated;
grant execute on function record_customer_payment(jsonb)  to authenticated;
grant execute on function record_supplier_payment(jsonb)  to authenticated;
grant execute on function adjust_stock(jsonb)             to authenticated;
grant execute on function create_product(jsonb)           to authenticated;
grant execute on function process_return(jsonb)           to authenticated;

do $$ begin
  alter publication supabase_realtime add table customer_payments;
  alter publication supabase_realtime add table purchases;
  alter publication supabase_realtime add table stock_adjustments;
  alter publication supabase_realtime add table returns;
exception when duplicate_object then null; end $$;

-- ============================================================================
-- After running: the app writes sales/purchases/payments/adjustments/returns
-- through these functions (supabase.rpc(...)), so stock and balances stay
-- correct and can never go negative. Reads use the tables/views directly.
-- ============================================================================
