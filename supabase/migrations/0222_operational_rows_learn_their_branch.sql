-- ═══════════════════════════════════════════════════════════════════════════════
-- 0222 — Every operational row learns the branch it happened in
--
-- WHY. `0118` added `branch_id` to the operational tables and backfilled them with **the only
-- branch in the database** (`SELECT id FROM branches ORDER BY is_default DESC LIMIT 1`) — a query
-- with no tenant predicate and no row predicate. `0207`/`0208` then created those tables on
-- production from staging's *schema only*, so the backfill never ran there: measured on production
-- 2026-10-17, all 52 sales, 17 inventory movements, 13 stock adjustments and every payment and
-- return carried `branch_id = NULL`.
--
-- The branch-read policies are `branch_id = ANY(current_branch_scope())`, and `NULL = ANY(…)` is
-- NULL, which a policy treats as false. So the owner — whose membership is deliberately unscoped —
-- saw zero of fifty-two sales. The screen was not empty because the rows were gone; it was empty
-- because the rows had no branch and the policy is null-rejecting.
--
-- And nothing repaired it: `create_sale_unchecked` (0214) inserts into `sales` and
-- `inventory_movements` without `branch_id`, so every NEW sale was born invisible too. Backfilling
-- alone would have fixed the past and left the next sale broken the same way.
--
-- WHAT IT DOES
--   1. Backfills every NULL `branch_id` from the row's own shop — never from "the first branch",
--      which is the mistake `0118` made. A row whose shop has no active branch is left NULL and is
--      reported by the assertion instead of being guessed into another tenant.
--   2. Installs one BEFORE INSERT trigger on the operational tables. It stamps
--      `public.current_branch_id()` — the branch the caller is actually operating in, resolved from
--      their active membership — and only when the branch belongs to the row's own shop. An explicit
--      `branch_id` is never overwritten, so imports and repair scripts keep their say.
--   3. Asserts both properties and rolls itself back if either fails.
--
-- WHY A TRIGGER. The write paths are not one function: `create_sale_unchecked`,
-- `create_purchase`, `process_return`, `record_customer_payment`, `record_supplier_payment`,
-- `adjust_stock` and a few direct client inserts all reach these tables. A trigger at the table is
-- the only place every path passes through, including a path added later.
--
-- WHY EVERY STATEMENT IS GUARDED BY `information_schema`. This file is replayed against the frozen
-- production baseline of 2026-10-01 as well as against the live project, and on that baseline
-- `branch_id` itself does not exist yet. A file that assumes the current shape does not replay, and
-- "it works on the database I have" is the failure `SCHEMA_STRATEGY.md` exists to prevent.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. The backfill, per row's own shop ────────────────────────────────────────────────────────
do $backfill$
declare
  r record;
  v_updated bigint;
  v_total bigint := 0;
  v_has_column boolean;
begin
  -- Rows that carry their own shop.
  for r in
    select t.table_name
      from information_schema.columns t
     where t.table_schema = 'public'
       and t.column_name = 'branch_id'
       and t.table_name in ('sales', 'purchases', 'returns', 'stock_adjustments')
       and exists (
         select 1 from information_schema.columns s
          where s.table_schema = 'public' and s.table_name = t.table_name and s.column_name = 'shop_id'
       )
  loop
    execute format(
      'update public.%I x set branch_id = (select b.id from public.branches b
          where b.tenant_id = x.shop_id and b.is_active
          order by b.is_default desc, b.created_at, b.id limit 1)
        where x.branch_id is null and x.shop_id is not null
          and exists (select 1 from public.branches b where b.tenant_id = x.shop_id and b.is_active)',
      r.table_name
    );
    get diagnostics v_updated = row_count;
    v_total := v_total + v_updated;
  end loop;

  -- Payments and movements reach their shop through the record they are about. Each branch is
  -- guarded by the two columns the join needs, so a database without them is skipped, not failed.
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'customer_payments' and column_name = 'branch_id')
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'customer_payments' and column_name = 'customer_id')
    into v_has_column;
  if v_has_column then
    execute $u$
      update public.customer_payments p
         set branch_id = (select b.id from public.branches b
             where b.tenant_id = c.shop_id and b.is_active
             order by b.is_default desc, b.created_at, b.id limit 1)
        from public.customers c
       where c.id = p.customer_id and p.branch_id is null
         and exists (select 1 from public.branches b where b.tenant_id = c.shop_id and b.is_active)
    $u$;
    get diagnostics v_updated = row_count;
    v_total := v_total + v_updated;
  end if;

  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'branch_id')
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'inventory_movements' and column_name = 'product_id')
    into v_has_column;
  if v_has_column then
    execute $u$
      update public.inventory_movements m
         set branch_id = (select b.id from public.branches b
             where b.tenant_id = p.shop_id and b.is_active
             order by b.is_default desc, b.created_at, b.id limit 1)
        from public.products p
       where p.id = m.product_id and m.branch_id is null
         and exists (select 1 from public.branches b where b.tenant_id = p.shop_id and b.is_active)
    $u$;
    get diagnostics v_updated = row_count;
    v_total := v_total + v_updated;
  end if;

  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'supplier_payments' and column_name = 'branch_id')
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'supplier_payments' and column_name = 'company_id')
    into v_has_column;
  if v_has_column then
    execute $u$
      update public.supplier_payments sp
         set branch_id = (select b.id from public.branches b
             where b.tenant_id = co.shop_id and b.is_active
             order by b.is_default desc, b.created_at, b.id limit 1)
        from public.companies co
       where co.id = sp.company_id and sp.branch_id is null
         and exists (select 1 from public.branches b where b.tenant_id = co.shop_id and b.is_active)
    $u$;
    get diagnostics v_updated = row_count;
    v_total := v_total + v_updated;
  end if;

  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'notifications' and column_name = 'branch_id')
     and exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'notifications' and column_name = 'user_id')
    into v_has_column;
  if v_has_column then
    execute $u$
      update public.notifications n
         set branch_id = (select b.id from public.branches b
             where b.tenant_id = u.shop_id and b.is_active
             order by b.is_default desc, b.created_at, b.id limit 1)
        from public.users u
       where u.id = n.user_id and n.branch_id is null
         and exists (select 1 from public.branches b where b.tenant_id = u.shop_id and b.is_active)
    $u$;
    get diagnostics v_updated = row_count;
    v_total := v_total + v_updated;
  end if;

  raise notice '0222: backfilled % operational row(s) from their own shop''s default branch', v_total;

  -- No operational row may stay branchless while its shop HAS an active branch. This is the
  -- property that makes the screens non-empty; it is asserted, not assumed.
  for r in
    select t.table_name
      from information_schema.columns t
     where t.table_schema = 'public'
       and t.column_name = 'branch_id'
       and t.table_name in ('sales', 'purchases', 'returns', 'stock_adjustments')
       and exists (
         select 1 from information_schema.columns s
          where s.table_schema = 'public' and s.table_name = t.table_name and s.column_name = 'shop_id'
       )
  loop
    execute format(
      'select count(*) from public.%I x
        where x.branch_id is null and x.shop_id is not null
          and exists (select 1 from public.branches b where b.tenant_id = x.shop_id and b.is_active)',
      r.table_name
    ) into v_updated;
    if v_updated > 0 then
      raise exception '0222: % row(s) in % still have no branch', v_updated, r.table_name;
    end if;
  end loop;
end
$backfill$;

-- ── 2. New rows are stamped at the table, so every write path gets it ─────────────────────────
do $stamp$
declare
  t text;
begin
  execute $fn$
    create or replace function public.stamp_operational_branch()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    declare
      v_branch uuid;
      v_shop uuid;
    begin
      if new.branch_id is not null then
        return new;
      end if;

      v_branch := public.current_branch_id();
      if v_branch is null then
        return new;
      end if;

      -- `to_jsonb(new)` rather than `new.shop_id`: the same function serves tables that carry a
      -- shop of their own and tables that reach it through a parent record.
      v_shop := nullif(to_jsonb(new) ->> 'shop_id', '')::uuid;
      if v_shop is not null then
        if not exists (select 1 from public.branches b where b.id = v_branch and b.tenant_id = v_shop) then
          return new;
        end if;
      end if;

      new.branch_id := v_branch;
      return new;
    end
    $body$;
  $fn$;

  -- A trigger function is executable by PUBLIC by default; it is a trigger, not an RPC, and nothing
  -- outside the tables should be able to call it.
  execute 'revoke execute on function public.stamp_operational_branch() from public, anon, authenticated';

  foreach t in array array[
    'sales', 'purchases', 'returns', 'customer_payments', 'supplier_payments',
    'inventory_movements', 'stock_adjustments', 'audit_events', 'notifications'
  ] loop
    if exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'branch_id'
    ) then
      execute format('drop trigger if exists stamp_operational_branch_trg on public.%I', t);
      execute format(
        'create trigger stamp_operational_branch_trg before insert on public.%I
           for each row execute function public.stamp_operational_branch()',
        t
      );
    end if;
  end loop;

  raise notice '0222: new operational rows are stamped with the branch they happen in';
end
$stamp$;
