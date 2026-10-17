-- ═══════════════════════════════════════════════════════════════════════════════
-- 0220 — The rows the membership model needs on a schema that never had them
--
-- THIS FILE IS THE APPLIED STATEMENT, VERBATIM. On 2026-10-17 production recorded this migration
-- with sha256 f4c0cba25d28… (11,192 bytes). The copy in the repository was then edited: two
-- post-conditions were narrowed so the file would also run on a database that already contained
-- multi-shop memberships or pending invitations (staging did). That edit changed the statements,
-- so the file on disk no longer matched the hash production recorded — a mismatch that `migrate
-- verify` reports, and it must not be papered over by editing the ledger's statements.
--
-- The statements below are the ones `supabase_migrations.schema_migrations` recorded as applied,
-- restored byte for byte from that row. The ledger's file hash is re-recorded against these bytes
-- with `reconciled_at` and a note naming the earlier hash, which is the only honest way to make
-- "what is recorded" and "what is on disk" the same fact again: the applied statements do not
-- change, only the comment around them.
--
-- The wider post-conditions are also the correct ones for a from-scratch replay — a fresh database
-- has no pre-existing membership, so nothing legitimate can trip them. The narrower variant existed
-- only for the staging database's out-of-band rows.
--
-- WHY. `0207` created the relations from staging's *schema only* (the plan's "no data statements"),
-- and production never received the membership rows that staging had grown out of band. Measured on
-- production after the 24-file batch:
--
--   shops 1 · users 4 (all with shop_id) · memberships 0 · branches 0 · roles 0 · permissions 0
--
-- so `authorize_business_action` refused every call ("tenant access denied"), `set_active_shop` had
-- no membership to accept, and `create_operating_branch` refused because the caller held no owner
-- membership. Access failed closed — and nothing could reopen it, because the RPC that would create a
-- membership is itself gated by one.
--
-- WHAT IT DOES, all of it additive and idempotent:
--   1. the permission catalogue from `0106`, `on conflict (code) do nothing`;
--   2. one default branch per shop that has users and no active branch;
--   3. the four canonical role templates (the same definitions `scripts/dev/canonical-roles.mjs`
--      checks against `0107`), matched by `(tenant_id, name)`;
--   4. one membership per user, in the shop their own `users.shop_id` names — owner for the original
--      owner (implicit all permissions), `admin` + Store Manager for the others who held
--      `users.role = 'admin'`, `employee` + Sales Employee for the rest.
--
-- WHY IT CANNOT WIDEN ACCESS. Every membership is keyed to the user's own `users.shop_id`; no row is
-- created for any other tenant. Owner memberships get `branch_scope = NULL` (which means "all
-- branches" only for role `owner`); everybody else is scoped to the shop's branch explicitly. The
-- file ends by asserting all four properties and rolls itself back if any fails.
-- ═══════════════════════════════════════════════════════════════════════════════

do $seed$
declare
  r record;
  v_branch uuid;
  v_role uuid;
  v_scope uuid[];
begin
  insert into public.permissions (code, module, action, label_en, label_ur) values
    ('customers.view','customers','view','View Customers','صارفین دیکھیں'),
    ('customers.create','customers','create','Create Customers','صارفین بنائیں'),
    ('customers.edit','customers','edit','Edit Customers','صارفین میں ترمیم کریں'),
    ('customers.delete','customers','delete','Delete/Archive Customers','صارفین حذف کریں'),
    ('customers.payments','customers','payments','Record Customer Payments','صارفین کی ادائیگیاں درج کریں'),
    ('products.view','products','view','View Products','مصنوعات دیکھیں'),
    ('products.create','products','create','Create Products','مصنوعات بنائیں'),
    ('products.edit','products','edit','Edit Products','مصنوعات میں ترمیم کریں'),
    ('products.delete','products','delete','Delete Products','مصنوعات حذف کریں'),
    ('sales.view','sales','view','View Sales','فروخت دیکھیں'),
    ('sales.create','sales','create','Create Sales','فروخت بنائیں'),
    ('sales.void','sales','void','Void Sales','فروخت منسوخ کریں'),
    ('returns.view','returns','view','View Returns','واپسیاں دیکھیں'),
    ('returns.create','returns','create','Process Returns','واپسیاں کریں'),
    ('purchases.view','purchases','view','View Purchases','خریداری دیکھیں'),
    ('purchases.create','purchases','create','Create Purchases','خریداری بنائیں'),
    ('payments.view','payments','view','View Payments','ادائیگیاں دیکھیں'),
    ('payments.supplier','payments','supplier','Record Supplier Payments','سپلائر ادائیگیاں درج کریں'),
    ('inventory.view','inventory','view','View Inventory','انوینٹری دیکھیں'),
    ('inventory.adjust','inventory','adjust','Adjust Stock','اسٹاک ایڈجسٹ کریں'),
    ('companies.view','companies','view','View Suppliers','سپلائرز دیکھیں'),
    ('companies.create','companies','create','Create Suppliers','سپلائرز بنائیں'),
    ('companies.edit','companies','edit','Edit Suppliers','سپلائرز میں ترمیم کریں'),
    ('reports.view','reports','view','View Reports','رپورٹس دیکھیں'),
    ('employees.view','employees','view','View Employees','عملہ دیکھیں'),
    ('employees.manage','employees','manage','Manage Employees','عملہ میں ترمیم کریں'),
    ('settings.view','settings','view','View Settings','ترتیبات دیکھیں'),
    ('settings.edit','settings','edit','Edit Settings','ترتیبات میں ترمیم کریں'),
    ('activity.view','activity','view','View Activity Log','سرگرمی لاگ دیکھیں'),
    ('notifications.view','notifications','view','View Notifications','اطلاعات دیکھیں'),
    ('alerts.view','alerts','view','View Action Center','ایکشن سینٹر دیکھیں'),
    ('alerts.manage','alerts','manage','Manage Alerts','الرٹس میں ترمیم کریں')
  on conflict (code) do nothing;

  -- One default branch per shop that has users and no active branch. Named the way staging named
  -- its first branch, so the two environments read the same.
  for r in
    select s.id, s.name from public.shops s
     where exists (select 1 from public.users u where u.shop_id = s.id)
       and not exists (select 1 from public.branches b where b.tenant_id = s.id and b.is_active)
  loop
    insert into public.branches (tenant_id, name, is_default, is_active)
    values (r.id, r.name || ' - Main', true, true)
    returning id into v_branch;
  end loop;

  -- The four canonical templates, per tenant that has people and no roles at all.
  for r in
    select distinct u.shop_id as tenant_id from public.users u where u.shop_id is not null
  loop
    continue when exists (select 1 from public.roles where tenant_id = r.tenant_id);

    insert into public.roles (tenant_id, name, description, is_system)
    values
      (r.tenant_id, 'Sales Employee', 'Shop floor: sales, customers, product viewing', true),
      (r.tenant_id, 'Sales Manager', 'Full sales management: sales, customers, returns, reports', true),
      (r.tenant_id, 'Store Manager', 'Full store operations: all except employee/settings management', true),
      (r.tenant_id, 'Inventory Clerk', 'Stock management: products, inventory, suppliers', true);

    insert into public.role_permissions (role_id, permission_id)
    select ro.id, p.id from public.roles ro join public.permissions p on true
     where ro.tenant_id = r.tenant_id
       and (
         (ro.name = 'Sales Employee' and p.code in
           ('customers.view','customers.create','sales.view','sales.create','products.view','inventory.view'))
         or (ro.name = 'Sales Manager' and p.code in
           ('customers.view','customers.create','customers.edit','customers.payments',
            'sales.view','sales.create','sales.void','returns.view','returns.create',
            'products.view','inventory.view','reports.view'))
         or (ro.name = 'Store Manager' and p.code not in
           ('employees.manage','settings.edit','employees.view'))
         or (ro.name = 'Inventory Clerk' and p.code in
           ('products.view','products.create','products.edit','inventory.view','inventory.adjust',
            'companies.view','companies.create','companies.edit','purchases.view','purchases.create',
            'payments.view','payments.supplier'))
       )
    on conflict do nothing;
  end loop;

  -- One membership per user, in that user's own shop. Never any other tenant.
  for r in
    select u.id, u.shop_id, u.role, u.is_original_owner
      from public.users u
     where u.shop_id is not null
       and not exists (select 1 from public.memberships m where m.user_id = u.id and m.tenant_id = u.shop_id)
  loop
    select id into v_branch from public.branches
     where tenant_id = r.shop_id and is_active
     order by is_default desc, created_at, id limit 1;
    if v_branch is null then
      raise exception '0220: shop % has no active branch', r.shop_id;
    end if;

    if r.is_original_owner then
      insert into public.memberships (user_id, tenant_id, role, status, branch_scope, role_id)
      values (r.id, r.shop_id, 'owner', 'active', null, null)
      on conflict (user_id, tenant_id) do nothing;
    elsif r.role = 'admin' then
      select id into v_role from public.roles where tenant_id = r.shop_id and name = 'Store Manager';
      insert into public.memberships (user_id, tenant_id, role, status, branch_scope, role_id)
      values (r.id, r.shop_id, 'admin', 'active', array[v_branch], v_role)
      on conflict (user_id, tenant_id) do nothing;
    else
      select id into v_role from public.roles where tenant_id = r.shop_id and name = 'Sales Employee';
      insert into public.memberships (user_id, tenant_id, role, status, branch_scope, role_id)
      values (r.id, r.shop_id, 'employee', 'active', array[v_branch], v_role)
      on conflict (user_id, tenant_id) do nothing;
    end if;

    insert into public.user_active_shops (user_id, shop_id, branch_id, updated_at)
    values (r.id, r.shop_id, v_branch, now())
    on conflict (user_id) do update set shop_id = excluded.shop_id, branch_id = excluded.branch_id,
      updated_at = now();
  end loop;

  -- The properties this file exists to establish, asserted rather than assumed.
  if exists (select 1 from public.users u where u.shop_id is not null
              and (select count(*) from public.memberships m
                    where m.user_id = u.id and m.tenant_id = u.shop_id) <> 1) then
    raise exception '0220: a user does not have exactly one membership in their own shop';
  end if;
  if exists (select 1 from public.memberships m join public.users u on u.id = m.user_id
              where m.tenant_id is distinct from u.shop_id) then
    raise exception '0220: a membership names a shop other than the user''s own';
  end if;
  if exists (select 1 from public.memberships m
              where m.role <> 'owner' and (m.role_id is null or m.branch_scope is null)) then
    raise exception '0220: a non-owner membership has no role or no branch scope';
  end if;
  if exists (select 1 from public.shops s where exists (select 1 from public.users u where u.shop_id = s.id)
              and not exists (select 1 from public.branches b where b.tenant_id = s.id and b.is_active)) then
    raise exception '0220: a shop with users has no active branch';
  end if;

  raise notice '0220: permissions %, branches %, roles %, memberships %',
    (select count(*) from public.permissions), (select count(*) from public.branches),
    (select count(*) from public.roles), (select count(*) from public.memberships);
end
$seed$;
