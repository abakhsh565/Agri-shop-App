-- ═══════════════════════════════════════════════════════════════════════════════
-- 0228 — The reminder tables the app actually queries
--
-- Found by asking production the question no migration guard could: what does the CLIENT name?
-- `node scripts/audit-app-surface.mjs --env production` reads every simple `.from(x).select(a, b)` in
-- `src/` and every `supabase.rpc(name)`, then asks the live database for those columns and functions.
-- Measured 2026-10-17, production was missing six columns and held three permissive policies:
--
--   business_settings.setting_value   the app selects exactly this, filtered on `setting_key` — which
--                                     production also does not have. Its copy is the pre-0093 shape
--                                     (id, owner_id, crops jsonb, updated_at) and PostgREST answers 400
--                                     to every crops read, once per customer row on the customers
--                                     screen: the crop-based reminders were silently empty.
--   customer_crops.acreage, .planting_date, .expected_harvest
--   reminder_configs.group_id, .group_name
--   business_settings_all / customer_crops_all / reminder_configs_all
--                                     permissive policies whose predicate is the literal `true`, and
--                                     `customer_crops_select_anon` (also `true`) with
--                                     `customer_crops_insert_anon` (no check at all). 0223 retargeted
--                                     these to `authenticated`; it could not scope them, because that is
--                                     a decision about the row, not about the role. So any signed-in user
--                                     could read and write any shop's crops and reminder schedules.
--
-- WHY A MIGRATION AND NOT AN APP CHANGE
--   The columns are the shape the app has been exercised against on staging, and the boundary is the
--   one staging carries (`customer_crops_tenant`, `reminder_configs_select/insert/update/delete`). The
--   client is the same build in both places; the database was the one that differed. Fix the database.
--
-- WHAT THIS FILE CANNOT SEE, AND SAYS SO
--   Every block is guarded on the objects it needs (`to_regclass`, `information_schema.columns`, and
--   the existence of `current_shop_id()`), because the verifier replays it against production's frozen
--   2026-10-01 baseline, which predates them. When a guard is not satisfied nothing is attempted and
--   no assertion is made — an unchecked statement is never reported as a success.
--
-- BACKWARD-COMPATIBLE, PER THE PLAN'S RULES
--   Additive columns only (nullable or defaulted), policies replaced never widened, statements
--   idempotent, one transaction, and the assertions below run before the file is recorded.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── helper: does this database carry the function the scoped policies depend on? ───────────────
do $preflight$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'current_shop_id'
  ) then
    raise notice '0228: public.current_shop_id() is absent — the policy work is skipped here';
  end if;
end
$preflight$;

-- ── 1. business_settings gains its shop and its keys ───────────────────────────────────────────
do $business_settings$
declare
  v_has_crops boolean;
  v_has_scope boolean;
begin
  if to_regclass('public.business_settings') is null then
    raise notice '0228: business_settings absent — skipped';
    return;
  end if;

  execute 'alter table public.business_settings add column if not exists shop_id uuid';
  execute 'alter table public.business_settings add column if not exists setting_key varchar(100)';
  execute 'alter table public.business_settings add column if not exists setting_value text';
  execute 'alter table public.business_settings add column if not exists description text';
  execute 'alter table public.business_settings add column if not exists created_at timestamptz default now()';

  -- The one existing row (production holds exactly one, the demo shop's crops) is carried over rather
  -- than left as a shape the app cannot read.
  select exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'business_settings' and column_name = 'crops')
    into v_has_crops;
  if v_has_crops then
    execute $carry$
      update public.business_settings
         set setting_key   = coalesce(setting_key, 'crops'),
             setting_value = coalesce(setting_value, crops::text),
             shop_id       = coalesce(
                               shop_id,
                               (select u.shop_id from public.users u where u.id = business_settings.owner_id),
                               (select s.id from public.shops s order by s.created_at limit 1))
       where setting_key is null or setting_value is null or shop_id is null
    $carry$;
  end if;

  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'current_shop_id'
  ) into v_has_scope;

  if v_has_scope then
    -- A row written by the app (`insert({setting_key, setting_value})` — it sends no shop) is scoped
    -- by the default, so the boundary holds without the client having to know about it.
    execute 'alter table public.business_settings alter column shop_id set default public.current_shop_id()';

    execute 'create unique index if not exists business_settings_shop_key_idx
               on public.business_settings (shop_id, setting_key) where setting_key is not null';

    execute 'drop policy if exists business_settings_all on public.business_settings';
    execute 'drop policy if exists business_settings_select on public.business_settings';
    execute 'drop policy if exists business_settings_insert on public.business_settings';
    execute 'drop policy if exists business_settings_update on public.business_settings';
    execute 'drop policy if exists business_settings_delete on public.business_settings';
    execute 'create policy business_settings_select on public.business_settings
               for select to authenticated using (shop_id = public.current_shop_id())';
    execute 'create policy business_settings_insert on public.business_settings
               for insert to authenticated with check (shop_id = public.current_shop_id())';
    execute 'create policy business_settings_update on public.business_settings
               for update to authenticated using (shop_id = public.current_shop_id())
               with check (shop_id = public.current_shop_id())';
    execute 'create policy business_settings_delete on public.business_settings
               for delete to authenticated using (shop_id = public.current_shop_id())';
  end if;
end
$business_settings$;

-- ── 2. customer_crops gains the agronomy the screens ask for, and a tenant ─────────────────────
do $customer_crops$
declare
  v_has_scope boolean;
begin
  if to_regclass('public.customer_crops') is null then
    raise notice '0228: customer_crops absent — skipped';
    return;
  end if;

  execute 'alter table public.customer_crops add column if not exists acreage numeric';
  execute 'alter table public.customer_crops add column if not exists planting_date date';
  execute 'alter table public.customer_crops add column if not exists expected_harvest date';

  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'current_shop_id'
  ) and exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'customers' and column_name = 'shop_id'
  ) into v_has_scope;

  if v_has_scope then
    -- Every policy on the table is replaced, not amended: one of them (`customer_crops_insert_anon`)
    -- carried no check at all, and a policy that is still there after this file runs is a hole this
    -- file claims to have closed.
    execute 'drop policy if exists customer_crops_all on public.customer_crops';
    execute 'drop policy if exists customer_crops_select_anon on public.customer_crops';
    execute 'drop policy if exists customer_crops_insert_anon on public.customer_crops';
    execute 'drop policy if exists customer_crops_delete_anon on public.customer_crops';
    execute 'drop policy if exists customer_crops_tenant on public.customer_crops';
    execute $policy$
      create policy customer_crops_tenant on public.customer_crops
        for all to authenticated
        using (exists (select 1 from public.customers c
                        where c.id = customer_crops.customer_id
                          and c.shop_id = public.current_shop_id()))
        with check (exists (select 1 from public.customers c
                             where c.id = customer_crops.customer_id
                               and c.shop_id = public.current_shop_id()))
    $policy$;
  end if;
end
$customer_crops$;

-- ── 3. reminder_configs gains its group and its tenant ─────────────────────────────────────────
do $reminder_configs$
declare
  v_has_scope boolean;
begin
  if to_regclass('public.reminder_configs') is null then
    raise notice '0228: reminder_configs absent — skipped';
    return;
  end if;

  execute 'alter table public.reminder_configs add column if not exists group_id uuid';
  execute 'alter table public.reminder_configs add column if not exists group_name text';
  execute 'alter table public.reminder_configs add column if not exists shop_id uuid';

  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'current_shop_id'
  ) and exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'customers' and column_name = 'shop_id'
  ) into v_has_scope;

  if v_has_scope then
    execute $carry$
      update public.reminder_configs rc
         set shop_id = c.shop_id
        from public.customers c
       where c.id = rc.customer_id and rc.shop_id is null
    $carry$;
    execute 'alter table public.reminder_configs alter column shop_id set default public.current_shop_id()';

    execute 'drop policy if exists reminder_configs_all on public.reminder_configs';
    execute 'drop policy if exists reminder_configs_select on public.reminder_configs';
    execute 'drop policy if exists reminder_configs_insert on public.reminder_configs';
    execute 'drop policy if exists reminder_configs_update on public.reminder_configs';
    execute 'drop policy if exists reminder_configs_delete on public.reminder_configs';
    -- A schedule is scoped to its own shop, and — because the customer is the thing it schedules for —
    -- a caller cannot attach one to a customer of another shop either.
    execute $scope$
      create policy reminder_configs_select on public.reminder_configs
        for select to authenticated using (shop_id = public.current_shop_id());
      create policy reminder_configs_insert on public.reminder_configs
        for insert to authenticated
        with check (shop_id = public.current_shop_id()
                    and (customer_id is null or exists (select 1 from public.customers c
                                                         where c.id = reminder_configs.customer_id
                                                           and c.shop_id = public.current_shop_id())));
      create policy reminder_configs_update on public.reminder_configs
        for update to authenticated
        using (shop_id = public.current_shop_id())
        with check (shop_id = public.current_shop_id());
      create policy reminder_configs_delete on public.reminder_configs
        for delete to authenticated using (shop_id = public.current_shop_id());
    $scope$;
  end if;
end
$reminder_configs$;

-- ── 4. the quantity a return screen reads exists wherever the table does ───────────────────────
--
-- `return_items` carries two quantity columns on production: `qty` (legacy,
-- NOT NULL) and `qty_to_return` (what the function writes). The app reads `qty` in three screens
-- (`SaleDetailView`, `AdminReturnSelectItemsPage`, `ReturnSelectItemsPage`) — measured by the same
-- audit, staging has only `qty_to_return`, so those screens were asking for a column that did not
-- exist there. Where the column is missing it is added and kept equal by the same trigger 0227
-- installs on production.
do $return_items$
begin
  if to_regclass('public.return_items') is null then
    raise notice '0228: return_items absent — skipped';
    return;
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'return_items' and column_name = 'qty_to_return') then
    raise notice '0228: return_items has no qty_to_return — nothing to mirror';
    return;
  end if;

  execute 'alter table public.return_items add column if not exists qty numeric';
  execute 'update public.return_items set qty = coalesce(qty_to_return, qty, 0)
             where qty is distinct from coalesce(qty_to_return, qty, 0)';

  execute $fn$
    create or replace function public.return_items_mirror_qty()
    returns trigger
    language plpgsql
    security definer
    set search_path = public
    as $body$
    begin
      new.qty := coalesce(new.qty_to_return, new.qty, 0);
      return new;
    end
    $body$;
  $fn$;
  execute 'revoke execute on function public.return_items_mirror_qty() from public, anon, authenticated';
  execute 'drop trigger if exists return_items_mirror_qty_trg on public.return_items';
  execute 'create trigger return_items_mirror_qty_trg before insert or update on public.return_items
             for each row execute function public.return_items_mirror_qty()';
end
$return_items$;

-- ── The properties this file exists for, asserted (and only where they were attempted) ─────────
do $assert$
declare
  v_missing text[] := array[]::text[];
  v_true_policies text[] := array[]::text[];
  v_has_scope boolean;
begin
  -- 1. the columns the app names
  if to_regclass('public.business_settings') is not null then
    select array_agg(c) into v_missing from unnest(array['shop_id','setting_key','setting_value']) c
     where not exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='business_settings' and column_name = c);
    if v_missing is not null then
      raise exception '0228: business_settings is still missing %', v_missing;
    end if;
  end if;

  if to_regclass('public.customer_crops') is not null then
    select array_agg(c) into v_missing from unnest(array['acreage','planting_date','expected_harvest']) c
     where not exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='customer_crops' and column_name = c);
    if v_missing is not null then
      raise exception '0228: customer_crops is still missing %', v_missing;
    end if;
  end if;

  if to_regclass('public.reminder_configs') is not null then
    select array_agg(c) into v_missing from unnest(array['group_id','group_name']) c
     where not exists (select 1 from information_schema.columns
                        where table_schema='public' and table_name='reminder_configs' and column_name = c);
    if v_missing is not null then
      raise exception '0228: reminder_configs is still missing %', v_missing;
    end if;
  end if;

  -- 2. the quantity the return screens read
  if to_regclass('public.return_items') is not null then
    if not exists (select 1 from information_schema.columns
                    where table_schema='public' and table_name='return_items' and column_name='qty') then
      raise exception '0228: return_items has no qty column for the screens that read it';
    end if;
  end if;

  -- 3. no always-true policy survives on the three tables — the condition for the policy work, so it
  --    is asserted only where that work was possible.
  select exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'current_shop_id'
  ) into v_has_scope;

  if v_has_scope then
    select array_agg(policyname) into v_true_policies
      from pg_policies
     where schemaname = 'public'
       and tablename in ('business_settings','customer_crops','reminder_configs')
       and btrim(coalesce(qual, '')) = 'true'
       and cmd in ('SELECT','ALL','UPDATE','DELETE');
    if v_true_policies is not null then
      raise exception '0228: a permissive policy survives on %', v_true_policies;
    end if;
  end if;

  raise notice '0228: the reminder tables carry the columns the app names, inside their own shop';
end
$assert$;
