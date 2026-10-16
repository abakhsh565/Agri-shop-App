-- ============================================================
-- 0178 — a variant belongs to the shop that owns its product
-- ============================================================
-- FINDING (measured on QA 2026-10-02, reproduced by tests/integration/variantIsolation.test.ts):
--
--   `product_variants` was the only business table in `public` whose SELECT policy was the
--   literal `true` (0010_comprehensive_rls.sql:47). It also has no `shop_id` column — the
--   tenant boundary lives one join away, on `products.shop_id` — so the child table was the
--   only thing standing between one shop and every other shop's sellable units.
--
--   Nothing enforced it. Through the real JWT → PostgREST → RLS path, an admin of shop A:
--     * read shop B's variant row and its `cost_price` (targeted read by id: 1 row returned);
--     * UPDATEd shop B's variant — `stock_qty` 100 → 1 and `selling_price` 700 → 1 both
--       committed, because the UPDATE policy was `app_is_admin()`, which answers "is this
--       caller an admin" and never "of this row";
--     * INSERTed a variant onto shop B's product, because the INSERT policy was the same
--       tenant-blind `app_is_admin()`.
--
--   The app's own reads are always filtered (`products` is filtered first, then variants are
--   attached by product id), so this was invisible in the UI. It was reachable by anyone who
--   can send a request with their own session — a phone, a script, or a console — which is
--   exactly the "enforced at the correct layer" question: the boundary has to be the policy,
--   not the caller's query.
--
-- WHAT THIS DOES
--   Replaces the three policies with the same shape every other child table in this schema
--   already uses (`sale_items` → `sales`, `return_items` → `returns`, `inventory_movements`
--   → `products`, `purchase_items` → `purchases`): the row is visible when the parent row's
--   shop is the caller's active shop.
--
--     SELECT  own shop only
--     INSERT  admin of the owning shop
--     UPDATE  admin, and neither the old row nor the new one may leave the shop
--             (USING sees the old row, WITH CHECK sees the new — one without the other is how
--              a row gets moved out of a tenant)
--     DELETE  no policy, exactly as before: variants are deactivated (`is_active = false`),
--             never deleted through PostgREST. This file does not add one.
--
--   `cost_price` exposure to employee sessions is a separate, still-open item and is NOT
--   addressed here — see ENGINEERING_OS_STATE.md. This file only closes the tenant boundary.
--
-- SCOPE
--   Applied to QA/staging first (this file, in the ledger). Production does not carry the
--   membership/role model yet, so production is migrated forward only by the schema-strategy
--   decision, never by replaying history.

-- ── SELECT: the caller's own shop ───────────────────────────────────────────
drop policy if exists product_variants_select on public.product_variants;
create policy product_variants_select on public.product_variants
  for select to authenticated
  using (
    exists (
      select 1 from public.products p
       where p.id = product_variants.product_id
         and p.shop_id = current_shop_id()
    )
  );

-- ── INSERT: an admin may only add a variant to their own shop's product ─────
drop policy if exists product_variants_insert on public.product_variants;
create policy product_variants_insert on public.product_variants
  for insert to authenticated
  with check (
    app_is_admin()
    and exists (
      select 1 from public.products p
       where p.id = product_variants.product_id
         and p.shop_id = current_shop_id()
    )
  );

-- ── UPDATE: admin, and the row may not be moved between shops ───────────────
drop policy if exists product_variants_update on public.product_variants;
create policy product_variants_update on public.product_variants
  for update to authenticated
  using (
    app_is_admin()
    and exists (
      select 1 from public.products p
       where p.id = product_variants.product_id
         and p.shop_id = current_shop_id()
    )
  )
  with check (
    app_is_admin()
    and exists (
      select 1 from public.products p
       where p.id = product_variants.product_id
         and p.shop_id = current_shop_id()
    )
  );

-- ── the anon-era policies 0053 added are dropped, not left to RLS-permissive luck ──
-- 0053_rls_hardening.sql created `product_variants_select_anon` and friends `TO public`. A
-- policy addressed to `public` also applies to `authenticated`, so leaving one behind would
-- OR its predicate with the policies above and re-open the same hole. Idempotent.
drop policy if exists product_variants_select_anon on public.product_variants;
drop policy if exists product_variants_insert_anon on public.product_variants;
drop policy if exists product_variants_update_anon on public.product_variants;

-- ── proof, in the migration itself ─────────────────────────────────────────
-- A migration that believes it closed a hole should say so where the next reader looks. This
-- raises if any policy on the table is still the literal `true`.
do $$
declare
  v_open text;
begin
  select string_agg(p.polname, ', ')
    into v_open
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
   where c.relname = 'product_variants'
     and c.relnamespace = 'public'::regnamespace
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') = 'true';

  if v_open is not null then
    raise exception '0178 did not close every permissive-true policy on product_variants: %', v_open;
  end if;
  raise notice '0178: product_variants policies are scoped to the owning shop';
end $$;
