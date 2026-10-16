-- ============================================================
-- 0180 — `app_is_admin()` is not a boundary
-- ============================================================
-- FINDING (live policy catalog, QA, 2026-10-02; reproduced by
-- tests/integration/tenantBoundarySweep.test.ts):
--
--   After 0178 closed `product_variants`, the same question was asked of every other policy:
--   *which ones are reachable by an authenticated session but never constrain the row to the
--   caller's shop?* `app_is_admin()` answers "is this caller an admin", not "is this caller an
--   admin of THIS row" — so a policy that is only `app_is_admin()` lets the admin of any shop
--   touch every shop's rows.
--
--   Two tables were still in that shape, both carrying money-adjacent records:
--
--     stock_adjustments      INSERT `app_is_admin()`
--                            SELECT `app_is_admin()` OR branch-scope
--                            → tenant A's admin read tenant B's adjustment row (reproduced:
--                              1 row returned for a row that belongs to another shop), and the
--                              branch-scope half had no shop predicate either, so a caller with
--                              no branch scope matched every shop's rows.
--     cash_reconciliations   INSERT `app_is_admin()`, SELECT `app_is_admin()`
--                            → the same cross-tenant read (reproduced).
--
--   Measured together with the ones that were already correct or are out of scope:
--   `notifications` scopes through `my_shop_ids()` and stays as it is; `app_settings`,
--   `permissions` are reference data with no `shop_id`; `sale_submissions` denies clients
--   outright; `user_permissions` INSERT/DELETE are refused by RLS in the cross-tenant case
--   (asserted in the sweep suite, so the day that stops being true the suite says so).
--
-- WHAT THIS DOES
--   Both tables already carry `shop_id`, so the fix is the plain predicate the rest of the
--   schema uses. SELECT and INSERT are replaced on both; the branch-scope policy on
--   `stock_adjustments` is replaced rather than kept, because OR-ing it with an admin policy
--   is what made the table readable across shops in the first place.
--
--   `stock_adjustments` SELECT keeps its branch half for the sessions it was written for, but
--   now under the shop predicate: shop scope AND branch scope, never either alone.
--
-- SCOPE
--   Applied to QA/staging first (this file, in the ledger). Production is migrated forward only
--   by the schema-strategy decision, never by replaying history.

-- ── stock_adjustments ───────────────────────────────────────────────────────
drop policy if exists stock_adjustments_select on public.stock_adjustments;
create policy stock_adjustments_select on public.stock_adjustments
  for select to authenticated
  using (app_is_admin() and shop_id = current_shop_id());

drop policy if exists stock_adjustments_branch_select on public.stock_adjustments;
create policy stock_adjustments_branch_select on public.stock_adjustments
  for select to authenticated
  using (
    shop_id = current_shop_id()
    and (current_branch_scope() is null or branch_id = any (current_branch_scope()))
  );

drop policy if exists stock_adjustments_insert on public.stock_adjustments;
create policy stock_adjustments_insert on public.stock_adjustments
  for insert to authenticated
  with check (app_is_admin() and shop_id = current_shop_id());

-- ── cash_reconciliations ────────────────────────────────────────────────────
drop policy if exists cash_reconciliations_select on public.cash_reconciliations;
create policy cash_reconciliations_select on public.cash_reconciliations
  for select to authenticated
  using (app_is_admin() and shop_id = current_shop_id());

drop policy if exists cash_reconciliations_insert on public.cash_reconciliations;
create policy cash_reconciliations_insert on public.cash_reconciliations
  for insert to authenticated
  with check (app_is_admin() and shop_id = current_shop_id());

-- ── proof, in the migration itself ──────────────────────────────────────────
-- A policy on these tables that is reachable by `authenticated` and mentions neither the shop
-- nor a parent row's shop is the exact shape this file exists to remove.
do $$
declare
  v_open text;
begin
  select string_agg(c.relname || '.' || p.polname, ', ')
    into v_open
    from pg_policy p
    join pg_class c on c.oid = p.polrelid
   where c.relname in ('stock_adjustments', 'cash_reconciliations')
     and c.relnamespace = 'public'::regnamespace
     and coalesce(pg_get_expr(p.polqual, p.polrelid), '') !~ 'current_shop_id'
     and coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') !~ 'current_shop_id';

  if v_open is not null then
    raise exception '0180 left a tenant-blind policy in place: %', v_open;
  end if;
  raise notice '0180: stock_adjustments and cash_reconciliations are scoped to the caller shop';
end $$;
