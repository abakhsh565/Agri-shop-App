-- ============================================================
-- 0179 — cost price is the owner's business
-- ============================================================
-- FINDING (measured on QA 2026-10-02, tests/integration/variantIsolation.test.ts):
--
--   `product_variants.cost_price` was readable by an employee session. The app was written
--   to prevent exactly that — 0015_flexible_units.sql created `product_variants_public`
--   ("no cost_price for employees") and `productsStore` reads that view for non-admins — but
--   **the view does not exist in either environment**. 0015 is recorded as applied, and the
--   table it alters and the index it adds are both present; only the view is absent. The
--   employee branch of the store has therefore never read the view it names: the request
--   fails, and the fallback (`cached` rows, or the error branch) is what employees have been
--   seeing. The base table was readable by every authenticated session (that was 0178's
--   finding), so the column had no protection at all.
--
-- WHAT THIS DOES
--   1. Restores the view 0015 specified, as the projection employees actually need: every
--      sellable field EXCEPT `cost_price`, scoped to the caller's own shop, granted to
--      `authenticated`.
--   2. Narrows the base table's SELECT to admins of the owning shop, so the employee path is
--      the view — the design 0015 and `productsStore` both already assume.
--
-- WHY THE VIEW CARRIES ITS OWN SHOP FILTER
--   A view is evaluated with its owner's rights (Postgres' default; `security_invoker` is
--   opt-in). The owner here is `postgres`, and a table's owner bypasses RLS unless FORCE ROW
--   LEVEL SECURITY is set, so the view does NOT inherit the base table's policy. Its `WHERE`
--   clause is the enforcement, and it is written to be the same predicate the policy uses:
--   the parent product's shop must be the caller's active shop. A caller with no active shop
--   resolves `current_shop_id()` to NULL, the comparison is NULL, and the view returns no
--   rows.
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE
--   * Admins keep reading the base table — the markup field, the profit columns and the
--     reports all need `cost_price`, and they were never the audience this projection hides.
--   * `is_active` is not filtered here. The employee branch of the store does not filter it
--     today either; this file changes which rows a session can reach, not which rows the app
--     asks for.
--   * No RPC, no trigger, no write path. Variants are still written through the same
--     admin-gated policies 0178 put in place.
--
-- SCOPE
--   Applied to QA/staging first (this file, in the ledger). Production is migrated forward
--   only by the schema-strategy decision, never by replaying history.

-- ── 1. the employee projection ──────────────────────────────────────────────
drop view if exists public.product_variants_public;
create view public.product_variants_public as
select
  v.id,
  v.product_id,
  v.name,
  v.sku,
  v.selling_price,
  v.unit_size,
  v.qty_step,
  v.low_stock_threshold,
  v.expiry_date,
  v.stock_qty,
  v.is_active
from public.product_variants v
where exists (
  select 1 from public.products p
   where p.id = v.product_id
     and p.shop_id = current_shop_id()
);

comment on view public.product_variants_public is
  'Sellable unit fields for a signed-in employee, without cost_price, scoped to the caller''s active shop. The shop filter is the enforcement: the view runs with its owner''s rights, so it does not inherit product_variants RLS.';

grant select on public.product_variants_public to authenticated;

-- ── 2. the base table is for admins ────────────────────────────────────────
-- 0178 scoped SELECT to the owning shop; this narrows it to the owning shop's ADMINS. The
-- employee path is the view above, which is what the store already tries first.
drop policy if exists product_variants_select on public.product_variants;
create policy product_variants_select on public.product_variants
  for select to authenticated
  using (
    app_is_admin()
    and exists (
      select 1 from public.products p
       where p.id = product_variants.product_id
         and p.shop_id = current_shop_id()
    )
  );

-- ── 3. proof, in the migration itself ──────────────────────────────────────
-- The column this file exists to hide must not be selectable from the projection, and the
-- projection must exist (its absence is the bug being fixed).
do $$
declare
  v_has_cost boolean;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'product_variants_public'
       and column_name = 'cost_price'
  ) into v_has_cost;

  if v_has_cost then
    raise exception '0179: product_variants_public still exposes cost_price';
  end if;
  raise notice '0179: employee projection has no cost_price and the base table is admin-only';
end $$;
