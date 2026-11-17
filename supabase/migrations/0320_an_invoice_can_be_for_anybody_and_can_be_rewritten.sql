-- 0320_an_invoice_can_be_for_anybody_and_can_be_rewritten.sql
--
-- WHY THIS EXISTS
--
-- 0319 wrote invoices for a customer and only a customer. The owner's next instruction (2026-11-17)
-- was two things the paper already does by hand:
--
--   1. A bill can be raised for whoever the shop deals with — a customer, a supplier, an employee,
--      or somebody with no record at all (a walk-in). The "BILL TO" block on the paper is a name
--      and a phone number; which table the name came from is the app's business, not the reader's.
--      So `party_type` + `party_id` sit beside the copied name, exactly as `customer_id` already
--      did: the typed or chosen identity is frozen onto the invoice.
--
--   2. A bill gets corrected after it is written — a line was wrong, the discount changed, the shop
--      logo is now on the header. `update_invoice` rewrites the invoice and its lines in one
--      transaction, recomputing the same totals `create_invoice` computes from the same helper, so
--      two code paths cannot disagree about what a bill adds up to. The number is never reissued:
--      it is the shop's series and it is already on paper.
--
--   DESIGN. `design` records which of the three paper layouts the shop chose for this invoice
--   (atelier / royal / aurora). It is stored with the invoice rather than as a device setting,
--   because a bill reprinted from the archive a month later must look like the one that was handed
--   over.
--
-- WHAT DOES NOT CHANGE. 0319's tables, policies, `invoice_json` and `set_invoice_payment` stay as
-- they are; `create_invoice` is replaced only to carry the three new columns. Existing rows get
-- `party_type = 'customer'` and `design = 'royal'`, which is what they were written as.
--
-- PRODUCTION. Additive columns with defaults plus two replaced/added functions; no row is rewritten
-- in a way that changes its meaning. Same batch as 0319 — see docs/PRODUCTION_MIGRATION_PLAN.md §5.

-- ─── 1. Who the bill is for, and how it looks ──────────────────────────────────────────────

alter table public.invoices
  add column if not exists party_type text not null default 'customer'
    check (party_type in ('customer', 'supplier', 'employee', 'other')),
  add column if not exists party_id uuid,
  add column if not exists design text not null default 'royal'
    check (design in ('atelier', 'royal', 'aurora'));

comment on column public.invoices.party_type is
  'Which kind of party the paper bills: a customer, a supplier, an employee, or somebody with no record (other). The name is copied either way (0320).';

-- ─── 2. One arithmetic, used by both write paths ───────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'invoice_amounts') then
    create type public.invoice_amounts as (
      subtotal numeric,
      discount numeric,
      tax      numeric,
      total    numeric
    );
  end if;
end;
$$;

create or replace function public.invoice_amounts_for(
  p_items jsonb,
  p_discount_type text,
  p_discount_value numeric,
  p_tax_rate numeric
)
returns public.invoice_amounts
language plpgsql
immutable
as $fn$
declare
  v_subtotal numeric := 0;
  v_discount numeric := 0;
  v_tax      numeric := 0;
  v_item     record;
begin
  for v_item in
    select * from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb))
      as x(description text, qty numeric, "unitPrice" numeric, discount numeric, "productId" uuid)
  loop
    v_subtotal := v_subtotal + greatest(
      round(coalesce(v_item.qty, 1) * coalesce(v_item."unitPrice", 0), 2)
        - least(coalesce(v_item.discount, 0),
                round(coalesce(v_item.qty, 1) * coalesce(v_item."unitPrice", 0), 2)),
      0);
  end loop;

  v_discount := case
    when p_discount_type = 'percent' then round(v_subtotal * least(greatest(coalesce(p_discount_value, 0), 0), 100) / 100.0, 2)
    else least(greatest(coalesce(p_discount_value, 0), 0), v_subtotal)
  end;
  v_tax := round((v_subtotal - v_discount) * greatest(coalesce(p_tax_rate, 0), 0) / 100.0, 2);

  return (v_subtotal, v_discount, v_tax, round(v_subtotal - v_discount + v_tax, 2))::public.invoice_amounts;
end;
$fn$;

comment on function public.invoice_amounts_for(jsonb, text, numeric, numeric) is
  'What an invoice adds up to: line amounts less per-line discount, then the bill discount, then tax (0320).';

-- ─── 3. Writing one, now carrying party and design ─────────────────────────────────────────

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
  v_party    uuid;
  v_party_t  text := coalesce(nullif(payload->>'partyType', ''), 'customer');
  v_name     text;
  v_amounts  public.invoice_amounts;
  v_paid     numeric := 0;
  v_status   text;
  v_type     text := coalesce(nullif(payload->>'discountType', ''), 'amount');
  v_value    numeric := greatest(coalesce((payload->>'discountValue')::numeric, 0), 0);
  v_rate     numeric := greatest(coalesce((payload->>'taxRate')::numeric, 0), 0);
  v_design   text := coalesce(nullif(payload->>'design', ''), 'royal');
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
  v_party := nullif(payload->>'partyId', '')::uuid;
  v_name := nullif(btrim(coalesce(payload->>'customerName', '')), '');
  if v_name is null then
    raise exception 'An invoice needs a name to bill';
  end if;

  v_amounts := public.invoice_amounts_for(payload->'items', v_type, v_value, v_rate);
  v_paid := least(greatest(coalesce((payload->>'amountPaid')::numeric, 0), 0), v_amounts.total);
  v_status := case
    when v_paid >= v_amounts.total and v_amounts.total > 0 then 'paid'
    when v_paid > 0 then 'partial'
    else 'unpaid'
  end;

  perform pg_advisory_xact_lock(hashtext('invoice:' || v_shop::text));
  select coalesce(max(substring(invoice_number from '([0-9]+)$')::integer), 0) + 1
    into v_seq
    from public.invoices
   where shop_id = v_shop;
  v_number := 'INV-' || lpad(v_seq::text, 4, '0');

  insert into public.invoices (
    shop_id, invoice_number, customer_id, party_type, party_id,
    customer_name, customer_phone, customer_address,
    issued_on, due_date, discount_type, discount_value, tax_rate,
    subtotal, discount_amount, tax_amount, total, amount_paid, payment_method, status,
    notes, terms, design, idempotency_key, created_by
  ) values (
    v_shop, v_number, v_customer, v_party_t, v_party,
    v_name, nullif(payload->>'customerPhone', ''), nullif(payload->>'customerAddress', ''),
    coalesce(nullif(payload->>'issuedOn', '')::date, current_date),
    nullif(payload->>'dueDate', '')::date,
    v_type, v_value, v_rate,
    v_amounts.subtotal, v_amounts.discount, v_amounts.tax, v_amounts.total,
    v_paid, nullif(payload->>'paymentMethod', ''), v_status,
    nullif(payload->>'notes', ''), nullif(payload->>'terms', ''), v_design, v_key,
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

-- ─── 4. Rewriting one ──────────────────────────────────────────────────────────────────────

create or replace function public.update_invoice(p_invoice_id uuid, payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_shop    uuid := public.current_shop_id();
  v_row     public.invoices%rowtype;
  v_amounts public.invoice_amounts;
  v_paid    numeric;
  v_status  text;
  v_item    record;
  v_pos     integer := 0;
begin
  if not public.has_effective_permission('sales.create') then
    raise exception 'You are not allowed to change invoices';
  end if;

  select * into v_row
    from public.invoices
   where id = p_invoice_id and shop_id = v_shop
   for update;
  if not found then
    raise exception 'Invoice not found';
  end if;

  if jsonb_typeof(coalesce(payload->'items', 'null'::jsonb)) <> 'array'
     or jsonb_array_length(payload->'items') = 0 then
    raise exception 'An invoice needs at least one item';
  end if;

  v_amounts := public.invoice_amounts_for(
    payload->'items',
    coalesce(nullif(payload->>'discountType', ''), v_row.discount_type),
    coalesce((payload->>'discountValue')::numeric, v_row.discount_value),
    coalesce((payload->>'taxRate')::numeric, v_row.tax_rate)
  );

  -- What has already been paid cannot exceed the corrected total; a total that shrank below the
  -- money received is a refund, which is a separate decision the shop makes, not a silent edit.
  v_paid := least(v_row.amount_paid, v_amounts.total);
  v_status := case
    when v_paid >= v_amounts.total and v_amounts.total > 0 then 'paid'
    when v_paid > 0 then 'partial'
    else 'unpaid'
  end;

  update public.invoices set
    customer_id      = coalesce(nullif(payload->>'customerId', '')::uuid, v_row.customer_id),
    party_type       = coalesce(nullif(payload->>'partyType', ''), v_row.party_type),
    party_id         = case when payload ? 'partyId' then nullif(payload->>'partyId', '')::uuid else v_row.party_id end,
    customer_name    = coalesce(nullif(btrim(coalesce(payload->>'customerName', '')), ''), v_row.customer_name),
    customer_phone   = case when payload ? 'customerPhone' then nullif(payload->>'customerPhone', '') else v_row.customer_phone end,
    customer_address = case when payload ? 'customerAddress' then nullif(payload->>'customerAddress', '') else v_row.customer_address end,
    issued_on        = coalesce(nullif(payload->>'issuedOn', '')::date, v_row.issued_on),
    due_date         = case when payload ? 'dueDate' then nullif(payload->>'dueDate', '')::date else v_row.due_date end,
    discount_type    = coalesce(nullif(payload->>'discountType', ''), v_row.discount_type),
    discount_value   = coalesce((payload->>'discountValue')::numeric, v_row.discount_value),
    tax_rate         = coalesce((payload->>'taxRate')::numeric, v_row.tax_rate),
    subtotal         = v_amounts.subtotal,
    discount_amount  = v_amounts.discount,
    tax_amount       = v_amounts.tax,
    total            = v_amounts.total,
    amount_paid      = v_paid,
    status           = v_status,
    payment_method   = coalesce(nullif(payload->>'paymentMethod', ''), v_row.payment_method),
    notes            = case when payload ? 'notes' then nullif(payload->>'notes', '') else v_row.notes end,
    terms            = case when payload ? 'terms' then nullif(payload->>'terms', '') else v_row.terms end,
    design           = coalesce(nullif(payload->>'design', ''), v_row.design),
    updated_at       = now()
  where id = p_invoice_id and shop_id = v_shop;

  -- Lines are a set, not a history: the corrected bill is the bill. The old lines are replaced
  -- inside this transaction so no reader ever sees a half-rewritten invoice.
  delete from public.invoice_items where invoice_id = p_invoice_id and shop_id = v_shop;

  for v_item in
    select * from jsonb_to_recordset(payload->'items')
      as x(description text, qty numeric, "unitPrice" numeric, discount numeric, "productId" uuid)
  loop
    v_pos := v_pos + 1;
    insert into public.invoice_items (
      invoice_id, shop_id, product_id, description, qty, unit_price, discount, line_total, position
    ) values (
      p_invoice_id, v_shop, v_item."productId",
      coalesce(nullif(btrim(v_item.description), ''), 'Item'),
      coalesce(v_item.qty, 1), coalesce(v_item."unitPrice", 0),
      least(coalesce(v_item.discount, 0), round(coalesce(v_item.qty, 1) * coalesce(v_item."unitPrice", 0), 2)),
      greatest(
        round(coalesce(v_item.qty, 1) * coalesce(v_item."unitPrice", 0), 2)
          - least(coalesce(v_item.discount, 0), round(coalesce(v_item.qty, 1) * coalesce(v_item."unitPrice", 0), 2)),
        0),
      v_pos
    );
  end loop;

  return public.invoice_json(p_invoice_id);
end;
$fn$;

comment on function public.update_invoice(uuid, jsonb) is
  'Rewrites one invoice and its lines, recomputing totals with invoice_amounts_for; the number is kept because it is already on paper (0320).';

revoke execute on function public.invoice_amounts_for(jsonb, text, numeric, numeric) from public, anon;
revoke execute on function public.create_invoice(jsonb) from public, anon;
revoke execute on function public.update_invoice(uuid, jsonb) from public, anon;
grant execute on function public.invoice_amounts_for(jsonb, text, numeric, numeric) to authenticated;
grant execute on function public.create_invoice(jsonb) to authenticated;
grant execute on function public.update_invoice(uuid, jsonb) to authenticated;

-- ─── 5. Self-checks ────────────────────────────────────────────────────────────────────────

do $$
declare
  v_missing text;
  v_check   public.invoice_amounts;
begin
  select string_agg(c, ', ') into v_missing
    from (values ('party_type'), ('party_id'), ('design')) as x(c)
   where not exists (
     select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'invoices' and column_name = c
   );
  if v_missing is not null then
    raise exception '0320: invoices is missing column(s): %', v_missing;
  end if;

  v_check := public.invoice_amounts_for(
    '[{"description":"a","qty":2,"unitPrice":100}]'::jsonb, 'amount', 50, 0);
  if v_check.total <> 150 then
    raise exception '0320: invoice arithmetic changed shape (2 × 100 − 50 should be 150, got %)', v_check.total;
  end if;
end;
$$;
