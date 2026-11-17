-- 0319_an_invoice_is_the_shops_own_paperwork.sql
--
-- WHY THIS EXISTS
--
-- The app can take money (sales, cart, payments) but it cannot hand a customer a bill for goods
-- they are buying on account with a due date: a shop that sells fertiliser to a farmer in June and
-- is paid in July keeps that on paper. The owner asked for the paperwork the shop already writes
-- by hand — an invoice with a number, a date, a due date, lines, discount, tax and what has been
-- paid against it — and for reminders to hang off it.
--
-- Two facts from the existing system shaped the shape below:
--   * a sale is the money moving (stock leaves, cash or credit is recorded); an invoice is the
--     promise that money will move. They are not the same record, so this is a new table pair and
--     nothing about `sales` changes;
--   * a bill can be written for somebody who is not a customer yet (a walk-in asking for a proper
--     bill, a supplier's driver). `customer_id` is therefore nullable and the name/phone/address are
--     copied onto the invoice, so the printed paper keeps what it said the day it was written even
--     if the customer record is later renamed — the same reason a sale keeps `customer_name`.
--
-- NUMBERING. `INV-0001` per shop, allocated inside the insert under an advisory lock, and guarded by
-- a unique (shop_id, invoice_number). A number a shop has written on paper must never be issued twice.
--
-- IDEMPOTENCY. `idempotency_key` is claimed by the RPC the same way `create_sale` claims one: a
-- double tap on "Save invoice" returns the invoice that already exists instead of a second number.
--
-- PERMISSIONS. Reading follows `sales.view`, writing follows `sales.create` — an invoice is the
-- shop's sales paperwork, and a role that may sell may raise the bill for what it sold. No new
-- permission code is introduced, so no existing role changes shape.
--
-- PRODUCTION. New, empty tables and two new functions; nothing existing is altered. Safe to run on
-- production in the same batch after 0318 — see docs/PRODUCTION_MIGRATION_PLAN.md §5.

-- ─── 1. The paperwork ───────────────────────────────────────────────────────────────────────

create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  shop_id         uuid not null references public.shops(id) on delete cascade,
  invoice_number  text not null,
  customer_id     uuid references public.customers(id) on delete set null,
  /* Copied, not joined: the paper keeps the name it was written for. */
  customer_name   text not null,
  customer_phone  text,
  customer_address text,
  issued_on       date not null default current_date,
  due_date        date,
  discount_type   text not null default 'amount' check (discount_type in ('amount', 'percent')),
  discount_value  numeric(12,2) not null default 0 check (discount_value >= 0),
  tax_rate        numeric(5,2)  not null default 0 check (tax_rate >= 0),
  subtotal        numeric(12,2) not null default 0,
  discount_amount numeric(12,2) not null default 0,
  tax_amount      numeric(12,2) not null default 0,
  total           numeric(12,2) not null default 0,
  amount_paid     numeric(12,2) not null default 0 check (amount_paid >= 0),
  payment_method  text,
  status          text not null default 'unpaid' check (status in ('unpaid', 'partial', 'paid')),
  notes           text,
  terms           text,
  idempotency_key text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint invoices_number_per_shop unique (shop_id, invoice_number),
  constraint invoices_one_per_key unique (shop_id, idempotency_key)
);

create index if not exists invoices_shop_issued_idx
  on public.invoices (shop_id, issued_on desc, created_at desc);
create index if not exists invoices_shop_status_idx
  on public.invoices (shop_id, status);

create table if not exists public.invoice_items (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  /* Denormalised for row-level security: a policy on lines must not need the parent row. */
  shop_id     uuid not null references public.shops(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  description text not null,
  qty         numeric(12,3) not null default 1 check (qty > 0),
  unit_price  numeric(12,2) not null default 0 check (unit_price >= 0),
  discount    numeric(12,2) not null default 0 check (discount >= 0),
  line_total  numeric(12,2) not null default 0,
  position    integer not null default 0
);

create index if not exists invoice_items_invoice_idx
  on public.invoice_items (invoice_id, position);

-- ─── 2. Who may read and write them ────────────────────────────────────────────────────────

alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;

drop policy if exists invoices_read on public.invoices;
create policy invoices_read on public.invoices
  for select to authenticated
  using (shop_id = public.current_shop_id() and public.has_effective_permission('sales.view'));

drop policy if exists invoices_write on public.invoices;
create policy invoices_write on public.invoices
  for insert to authenticated
  with check (shop_id = public.current_shop_id() and public.has_effective_permission('sales.create'));

drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update to authenticated
  using (shop_id = public.current_shop_id() and public.has_effective_permission('sales.create'))
  with check (shop_id = public.current_shop_id() and public.has_effective_permission('sales.create'));

drop policy if exists invoice_items_read on public.invoice_items;
create policy invoice_items_read on public.invoice_items
  for select to authenticated
  using (shop_id = public.current_shop_id() and public.has_effective_permission('sales.view'));

drop policy if exists invoice_items_write on public.invoice_items;
create policy invoice_items_write on public.invoice_items
  for insert to authenticated
  with check (shop_id = public.current_shop_id() and public.has_effective_permission('sales.create'));

-- ─── 3. One invoice, as the app reads it ───────────────────────────────────────────────────

create or replace function public.invoice_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $fn$
  select to_jsonb(i) || jsonb_build_object(
    'items', coalesce(
      (select jsonb_agg(to_jsonb(it) order by it.position, it.id)
         from public.invoice_items it
        where it.invoice_id = i.id),
      '[]'::jsonb
    )
  )
    from public.invoices i
   where i.id = p_id;
$fn$;

comment on function public.invoice_json(uuid) is
  'One invoice with its lines, in the shape the app reads (0319).';

-- ─── 4. Writing one ────────────────────────────────────────────────────────────────────────

create or replace function public.create_invoice(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_shop     uuid := public.current_shop_id();
  v_key      text := nullif(payload->>'idempotencyKey', '');
  v_existing uuid;
  v_id       uuid;
  v_customer uuid;
  v_name     text;
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_tax      numeric := 0;
  v_total    numeric := 0;
  v_paid     numeric := 0;
  v_status   text;
  v_type     text := coalesce(nullif(payload->>'discountType', ''), 'amount');
  v_value    numeric := greatest(coalesce((payload->>'discountValue')::numeric, 0), 0);
  v_rate     numeric := greatest(coalesce((payload->>'taxRate')::numeric, 0), 0);
  v_seq      integer;
  v_number   text;
  v_item     record;
  v_pos      integer := 0;
begin
  if v_shop is null then
    raise exception 'No shop is selected for this session';
  end if;
  if not public.has_effective_permission('sales.create') then
    raise exception 'You are not allowed to raise invoices';
  end if;

  -- A retried save returns the invoice the first attempt wrote. Never a second number.
  if v_key is not null then
    select id into v_existing
      from public.invoices
     where shop_id = v_shop and idempotency_key = v_key;
    if v_existing is not null then
      return public.invoice_json(v_existing);
    end if;
  end if;

  if jsonb_typeof(coalesce(payload->'items', 'null'::jsonb)) <> 'array'
     or jsonb_array_length(payload->'items') = 0 then
    raise exception 'An invoice needs at least one item';
  end if;

  v_customer := nullif(payload->>'customerId', '')::uuid;
  v_name := nullif(btrim(coalesce(payload->>'customerName', '')), '');
  if v_name is null then
    raise exception 'An invoice needs a name to bill';
  end if;

  -- Lines: qty × price, less the line's own discount, never below zero.
  for v_item in
    select * from jsonb_to_recordset(payload->'items')
      as x(description text, qty numeric, "unitPrice" numeric, discount numeric, "productId" uuid)
  loop
    v_subtotal := v_subtotal + greatest(
      round(coalesce(v_item.qty, 1) * coalesce(v_item."unitPrice", 0), 2)
        - least(coalesce(v_item.discount, 0), round(coalesce(v_item.qty, 1) * coalesce(v_item."unitPrice", 0), 2)),
      0);
  end loop;

  v_discount := case
    when v_type = 'percent' then round(v_subtotal * least(v_value, 100) / 100.0, 2)
    else least(v_value, v_subtotal)
  end;
  v_tax := round((v_subtotal - v_discount) * v_rate / 100.0, 2);
  v_total := round(v_subtotal - v_discount + v_tax, 2);
  v_paid := least(greatest(coalesce((payload->>'amountPaid')::numeric, 0), 0), v_total);
  v_status := case
    when v_paid >= v_total and v_total > 0 then 'paid'
    when v_paid > 0 then 'partial'
    else 'unpaid'
  end;

  -- One allocator per shop at a time: two tills saving together must get two different numbers.
  perform pg_advisory_xact_lock(hashtext('invoice:' || v_shop::text));
  select coalesce(max(substring(invoice_number from '([0-9]+)$')::integer), 0) + 1
    into v_seq
    from public.invoices
   where shop_id = v_shop;
  v_number := 'INV-' || lpad(v_seq::text, 4, '0');

  insert into public.invoices (
    shop_id, invoice_number, customer_id, customer_name, customer_phone, customer_address,
    issued_on, due_date, discount_type, discount_value, tax_rate,
    subtotal, discount_amount, tax_amount, total, amount_paid, payment_method, status,
    notes, terms, idempotency_key, created_by
  ) values (
    v_shop, v_number, v_customer, v_name,
    nullif(payload->>'customerPhone', ''), nullif(payload->>'customerAddress', ''),
    coalesce(nullif(payload->>'issuedOn', '')::date, current_date),
    nullif(payload->>'dueDate', '')::date,
    v_type, v_value, v_rate,
    v_subtotal, v_discount, v_tax, v_total, v_paid,
    nullif(payload->>'paymentMethod', ''), v_status,
    nullif(payload->>'notes', ''), nullif(payload->>'terms', ''), v_key,
    public.app_current_user_id()
  )
  returning id into v_id;

  for v_item in
    select * from jsonb_to_recordset(payload->'items')
      as x(description text, qty numeric, "unitPrice" numeric, discount numeric, "productId" uuid)
  loop
    v_pos := v_pos + 1;
    insert into public.invoice_items (
      invoice_id, shop_id, product_id, description, qty, unit_price, discount, line_total, position
    ) values (
      v_id, v_shop, v_item."productId", coalesce(nullif(btrim(v_item.description), ''), 'Item'),
      coalesce(v_item.qty, 1), coalesce(v_item."unitPrice", 0),
      least(coalesce(v_item.discount, 0), round(coalesce(v_item.qty, 1) * coalesce(v_item."unitPrice", 0), 2)),
      greatest(
        round(coalesce(v_item.qty, 1) * coalesce(v_item."unitPrice", 0), 2)
          - least(coalesce(v_item.discount, 0), round(coalesce(v_item.qty, 1) * coalesce(v_item."unitPrice", 0), 2)),
        0),
      v_pos
    );
  end loop;

  return public.invoice_json(v_id);
end;
$fn$;

comment on function public.create_invoice(jsonb) is
  'Writes one invoice and its lines, allocating INV-#### per shop under a lock; a repeated idempotency key returns the invoice already written (0319).';

-- ─── 5. Marking it paid (or not) ───────────────────────────────────────────────────────────

create or replace function public.set_invoice_payment(
  p_invoice_id uuid,
  p_amount_paid numeric,
  p_payment_method text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_shop  uuid := public.current_shop_id();
  v_total numeric;
  v_paid  numeric;
begin
  if not public.has_effective_permission('sales.create') then
    raise exception 'You are not allowed to settle invoices';
  end if;

  select total into v_total
    from public.invoices
   where id = p_invoice_id and shop_id = v_shop
   for update;
  if v_total is null then
    raise exception 'Invoice not found';
  end if;

  v_paid := least(greatest(coalesce(p_amount_paid, 0), 0), v_total);

  update public.invoices
     set amount_paid = v_paid,
         payment_method = coalesce(nullif(p_payment_method, ''), payment_method),
         status = case
           when v_paid >= v_total and v_total > 0 then 'paid'
           when v_paid > 0 then 'partial'
           else 'unpaid'
         end,
         updated_at = now()
   where id = p_invoice_id and shop_id = v_shop;

  return public.invoice_json(p_invoice_id);
end;
$fn$;

comment on function public.set_invoice_payment(uuid, numeric, text) is
  'Sets what has been paid against one invoice, clamped to its total, and derives unpaid/partial/paid (0319).';

revoke execute on function public.invoice_json(uuid) from public, anon;
revoke execute on function public.create_invoice(jsonb) from public, anon;
revoke execute on function public.set_invoice_payment(uuid, numeric, text) from public, anon;
grant execute on function public.invoice_json(uuid) to authenticated;
grant execute on function public.create_invoice(jsonb) to authenticated;
grant execute on function public.set_invoice_payment(uuid, numeric, text) to authenticated;

-- ─── 6. Self-checks ────────────────────────────────────────────────────────────────────────

do $$
declare
  v_missing text;
begin
  select string_agg(t, ', ') into v_missing
    from (values ('invoices'), ('invoice_items')) as x(t)
   where to_regclass('public.' || t) is null;
  if v_missing is not null then
    raise exception '0319: table(s) missing after migration: %', v_missing;
  end if;

  if not exists (
    select 1 from pg_policies where tablename = 'invoices' and policyname = 'invoices_read'
  ) then
    raise exception '0319: invoices has no read policy';
  end if;
end;
$$;
