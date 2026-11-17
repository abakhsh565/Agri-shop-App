-- 0321_a_bill_says_what_it_is_for.sql
--
-- WHY THIS EXISTS
--
-- 0319/0320 asked who a bill is for and never why it exists. The owner's instruction (2026-11-17)
-- is that the app should ask the purpose first, because the purpose is what changes the paper:
--
--   * a counter sale is paid now and needs no due date;
--   * a credit (udhaar) bill is on account and is only worth writing for a customer the shop can
--     chase, so a customer is required;
--   * a service/labour bill (spraying, transport, a repair) has no stock behind it and usually no
--     tax;
--   * an "other" bill covers the rest — a supplier, a member of staff, somebody with no record.
--
-- `party_type` answers *who*, `invoice_type` answers *why*; both are copied onto the row so a bill
-- printed a month later still says what it was. The printed sheet labels itself from this value.
--
-- The app already has a Purchases module for bills the shop *receives* from a supplier. This type is
-- deliberately not a fifth option: issuing an invoice that duplicates a purchase would be two
-- records of the same debt. `other` is the door for a one-off supplier or staff charge that has no
-- purchase behind it, and the create screen says so.
--
-- PRODUCTION. One additive column with a default, plus two replaced functions that carry it. Rows
-- written before this file read as `sale`, which is what every one of them was.

alter table public.invoices
  add column if not exists invoice_type text not null default 'sale'
    check (invoice_type in ('sale', 'credit', 'service', 'other'));

comment on column public.invoices.invoice_type is
  'Why the bill exists: a counter sale paid now, a credit (udhaar) bill, a service/labour bill, or another one-off charge. party_type answers who (0321).';

create index if not exists invoices_shop_type_idx
  on public.invoices (shop_id, invoice_type);

-- ─── create_invoice, carrying the type ─────────────────────────────────────────────────────

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
  v_type_of  text := coalesce(nullif(payload->>'invoiceType', ''), 'sale');
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

  -- A credit bill with nobody to chase is a paper the shop cannot use. The screen already requires
  -- a customer for it; this is the half that holds when a client calls the RPC directly.
  if v_type_of = 'credit' and v_customer is null then
    raise exception 'A credit bill needs a customer';
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
  v_number := 'INV-' || lpad(v_seq::text, 3, '0');

  insert into public.invoices (
    shop_id, invoice_number, customer_id, party_type, party_id, invoice_type,
    customer_name, customer_phone, customer_address,
    issued_on, due_date, discount_type, discount_value, tax_rate,
    subtotal, discount_amount, tax_amount, total, amount_paid, payment_method, status,
    notes, terms, design, idempotency_key, created_by
  ) values (
    v_shop, v_number, v_customer, v_party_t, v_party, v_type_of,
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

-- ─── update_invoice, carrying the type too ────────────────────────────────────────────────

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

  if coalesce(nullif(payload->>'invoiceType', ''), v_row.invoice_type) = 'credit'
     and coalesce(nullif(payload->>'customerId', '')::uuid, v_row.customer_id) is null then
    raise exception 'A credit bill needs a customer';
  end if;

  v_amounts := public.invoice_amounts_for(
    payload->'items',
    coalesce(nullif(payload->>'discountType', ''), v_row.discount_type),
    coalesce((payload->>'discountValue')::numeric, v_row.discount_value),
    coalesce((payload->>'taxRate')::numeric, v_row.tax_rate)
  );

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
    invoice_type     = coalesce(nullif(payload->>'invoiceType', ''), v_row.invoice_type),
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

revoke execute on function public.create_invoice(jsonb) from public, anon;
revoke execute on function public.update_invoice(uuid, jsonb) from public, anon;
grant execute on function public.create_invoice(jsonb) to authenticated;
grant execute on function public.update_invoice(uuid, jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'invoices' and column_name = 'invoice_type'
  ) then
    raise exception '0321: invoices.invoice_type is missing';
  end if;
end;
$$;
