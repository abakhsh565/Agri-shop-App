-- 0007_product_update_delete.sql
-- CR-013 — Inventory & Products: edit + delete product actions.
--
-- Adds an is_active flag on products so a product with financial/sales history
-- is *deactivated* rather than hard-deleted (ADR-004: never hard-delete records
-- with sales history). Adds two admin-only SECURITY DEFINER RPCs:
--   • update_product — edit catalogue fields + upsert variants (never negative
--     stock; historical sale prices on sale_items are untouched).
--   • delete_product — hard-delete only when the product has no sale history;
--     otherwise deactivate. Returns which path was taken so the UI can explain.

-- ---- 1. Soft-delete flag ----------------------------------------------------
alter table products add column if not exists is_active boolean not null default true;

-- ---- 2. update_product ------------------------------------------------------
-- payload: { id, name, company, category, imageUrl?,
--   variants: [{ id?, name, sellingPrice, costPrice, lowStockThreshold }] }
-- Variants with an id are updated; those without are inserted. Stock is NOT
-- changed here (use adjust_stock) so this can never make stock negative.
create or replace function update_product(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid := (payload->>'id')::uuid;
  item jsonb;
  v_variant_id uuid;
begin
  if not app_is_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_product_id is null then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  update products set
    name     = coalesce(payload->>'name', name),
    company  = coalesce(payload->>'company', company),
    category = coalesce((payload->>'category')::product_category, category),
    image_url = case when payload ? 'imageUrl'
                     then nullif(payload->>'imageUrl','') else image_url end
  where id = v_product_id;

  for item in select jsonb_array_elements(payload->'variants') loop
    v_variant_id := nullif(item->>'id','')::uuid;
    if v_variant_id is null then
      insert into product_variants(product_id, name, selling_price, cost_price, stock_qty, low_stock_threshold)
      values (v_product_id, item->>'name',
        coalesce((item->>'sellingPrice')::numeric,0),
        coalesce((item->>'costPrice')::numeric,0),
        greatest(coalesce((item->>'stockQty')::int,0),0),
        greatest(coalesce((item->>'lowStockThreshold')::int,5),0));
    else
      update product_variants set
        name                = coalesce(item->>'name', name),
        selling_price       = coalesce((item->>'sellingPrice')::numeric, selling_price),
        cost_price          = coalesce((item->>'costPrice')::numeric, cost_price),
        low_stock_threshold = greatest(coalesce((item->>'lowStockThreshold')::int, low_stock_threshold),0)
      where id = v_variant_id and product_id = v_product_id;
    end if;
  end loop;

  return jsonb_build_object('id', v_product_id);
end;
$$;

-- ---- 3. delete_product ------------------------------------------------------
-- payload: { id }
create or replace function delete_product(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product_id uuid := (payload->>'id')::uuid;
  v_has_history boolean;
begin
  if not app_is_admin() then
    raise exception 'NOT_AUTHORIZED';
  end if;
  if v_product_id is null then
    raise exception 'PRODUCT_NOT_FOUND';
  end if;

  -- Any sale line referencing one of this product's variants = financial history.
  select exists (
    select 1 from sale_items si
    join product_variants pv on pv.id = si.variant_id
    where pv.product_id = v_product_id
  ) into v_has_history;

  if v_has_history then
    -- ADR-004: preserve the record; hide from catalogue instead.
    update products set is_active = false where id = v_product_id;
    return jsonb_build_object('id', v_product_id, 'deactivated', true);
  else
    -- No history: safe to hard-delete (variants cascade).
    delete from products where id = v_product_id;
    return jsonb_build_object('id', v_product_id, 'deactivated', false);
  end if;
end;
$$;

-- ---- 4. Grants --------------------------------------------------------------
grant execute on function update_product(jsonb) to authenticated;
grant execute on function delete_product(jsonb) to authenticated;
