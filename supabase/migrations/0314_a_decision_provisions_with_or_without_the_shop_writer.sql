-- 0314_a_decision_provisions_with_or_without_the_shop_writer.sql
--
-- WHY THIS EXISTS (2026-11-14, measured on production `gkswcfljxlutkfdvvqng`):
--
-- 0313 made the approval trigger call whichever `create_shop_internal` the database has, and
-- production answered `SHOP_WRITER_MISSING`: that database has NO shop writer at all. Its
-- catalogue has `insert_shop_request`, `get_my_shop_request` and this release's own
-- `shop_requests_apply_decision`, but no `create_shop_internal`, no `create_shop_for_me` and no
-- `approve_shop_request` — production was built from the older tenant schema, where a shop is a
-- row in `shops` plus a branch, a `users` row, a copy of the system role templates and a
-- `memberships` row (production today: 1 seed shop, 4 system roles, 61 role permissions, 0 users,
-- 0 memberships).
--
-- So "approving provisions the shop" cannot be delegated to a function that does not exist. This
-- file keeps the delegation for the databases that DO have the writer (development, staging) and
-- adds the provisioning itself as the fallback, written against the older schema that production
-- actually has. One function, both shapes; the trigger keeps calling it.
--
-- WHAT IT DOES NOT DO. No new authority (SECURITY DEFINER, EXECUTE-revoked from every client
-- role), no second shop for an account that already owns one, nothing for `hold`/`rejected`, and
-- no change to `approve_shop_request` where it exists.

create or replace function public.shop_request_provision(
  p_shop_name text,
  p_phone text,
  p_owner_name text,
  p_owner uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_nargs integer;
  v_shop uuid;
  v_user uuid;
  v_auth_user uuid;
  v_template record;
  v_role uuid;
begin
  -- The databases that carry the real writer keep using it: it copies the role templates, seeds
  -- the branch and the membership the way the app already expects.
  select p.pronargs into v_nargs
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'create_shop_internal'
   order by p.pronargs desc
   limit 1;

  if v_nargs is not null then
    -- The writer exists: it creates the shop, its branch, its roles and (for an existing account)
    -- the owner membership.
    if v_nargs >= 3 then
      execute 'select public.create_shop_internal($1::text, $2::uuid, $3::uuid[])'
        into v_shop using p_shop_name, p_owner, null;
    else
      execute 'select public.create_shop_internal($1::text, $2::uuid)'
        into v_shop using p_shop_name, p_owner;
    end if;
  else
    -- ── The older tenant schema: the shop, its branch and its role templates are ours to make. ──
    insert into shops (name, phone, owner_id, join_code)
    values (p_shop_name, p_phone, null, upper(substr(md5(random()::text), 1, 6)))
    returning id into v_shop;

    -- Departments and the product taxonomy seed themselves from the `shops` triggers (production:
    -- shops_seed_departments_trg, shops_seed_product_taxonomy). The branch does not — and a shop
    -- with no branch stamps NULL on every record, so it is created here.
    insert into branches (tenant_id, name, is_default, is_active)
    values (v_shop, p_shop_name || ' - Main', true, true);

    -- The role templates, copied from the system set. A name this shop already carries (the shops
    -- triggers seed some) is left alone: its permissions come with it, and re-inserting the pair
    -- would violate the role_permissions key.
    for v_template in
      select r.*
        from roles r
       where r.is_system
         and exists (select 1 from role_permissions rp where rp.role_id = r.id)
    loop
      v_role := null;
      insert into roles (id, tenant_id, name, description, is_system)
      values (gen_random_uuid(), v_shop, v_template.name, v_template.description, false)
      on conflict (tenant_id, name) do nothing
      returning id into v_role;

      if v_role is not null then
        insert into role_permissions (role_id, permission_id)
        select v_role, rp.permission_id
          from role_permissions rp
         where rp.role_id = v_template.id
        on conflict do nothing;
      end if;
    end loop;
  end if;

  -- The account. A brand-new phone gets one here; an existing account is attached to the shop and
  -- keeps its identity (`users.phone` is unique).
  --
  -- `users.id` IS the auth user's id — that is the identity every read in the app resolves
  -- (src/lib/auth.ts loads the profile by the session's uid, and every seeded row in development
  -- matches `auth.users.id`). A profile built on a fresh random uuid signs in and then reads as
  -- nobody: the app asked for `users?id=eq.undefined` and PATCHed the same row with a 400. The
  -- phone was verified at registration, so the auth user for it already exists and its id is the
  -- one to use.
  select a.id into v_auth_user
    from auth.users a
   where public.canonical_phone(a.phone) = public.canonical_phone(p_phone)
   limit 1;

  if p_owner is null then
    v_user := coalesce(v_auth_user, gen_random_uuid());
    insert into users (id, name, phone, role, is_original_owner, is_active, employee_number, shop_id)
    values (v_user, p_owner_name, p_phone, 'admin', true, true, 'EMP-001', v_shop);
  else
    v_user := p_owner;
    update users set shop_id = v_shop, role = 'admin', is_active = true where id = v_user;
  end if;
  update shops set owner_id = v_user where id = v_shop;

  -- The join code employees type to find this shop (`resolve_shop_code` wants exactly six
  -- characters). A writer that sets its own keeps it; one that does not leaves NULL, which the
  -- Share-code screen would show as blank.
  update shops
     set join_code = upper(substr(md5(random()::text), 1, 6))
   where id = v_shop and (join_code is null or length(join_code) <> 6);

  -- `role owner / status active / access_kind standard / role_id null` is exactly what the owner
  -- membership looks like in a shop the app created itself.
  insert into memberships (user_id, tenant_id, role, status, access_kind)
  values (v_user, v_shop, 'owner', 'active', 'standard')
  on conflict do nothing;

  return v_shop;
end;
$function$;

comment on function public.shop_request_provision(text, text, text, uuid) is
  'Provisions an approved shop request: through public.create_shop_internal where that writer exists, and directly against the older tenant schema where it does not. Server-side only.';

revoke execute on function public.shop_request_provision(text, text, text, uuid) from public, anon, authenticated;

create or replace function public.shop_requests_apply_decision()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_existing_user uuid;
begin
  -- Only the transition INTO approved provisions. Re-saving an already-approved row is a no-op.
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select u.id into v_existing_user
      from users u
     where public.canonical_phone(u.phone) = public.canonical_phone(new.phone)
     limit 1;

    if v_existing_user is not null then
      -- The phone already answers for an account (the common case: the person registered, was left
      -- pending, and is being approved now). Attach a shop, but never a second one.
      if not exists (select 1 from shops s where s.owner_id = v_existing_user) then
        perform public.shop_request_provision(
          new.shop_name::text, new.phone::text, coalesce(new.owner_name, new.phone)::text,
          v_existing_user
        );
      end if;
    else
      perform public.shop_request_provision(
        new.shop_name::text, new.phone::text, coalesce(new.owner_name, new.phone)::text, null
      );
    end if;

    new.reviewed_at := coalesce(new.reviewed_at, now());
    new.reviewed_by := coalesce(new.reviewed_by, auth.uid());
  end if;

  -- `rejected` and `hold` need no provisioning: the sign-in path in src/lib/auth.ts reads the
  -- status and routes to /login/rejected or /login/under-review.
  return new;
end;
$function$;

comment on function public.shop_requests_apply_decision() is
  'A decision taken on a shop request does what the decision means: approving provisions the shop, account and membership, so the owner can approve from a dropdown.';

drop trigger if exists shop_requests_apply_decision on public.shop_requests;
create trigger shop_requests_apply_decision
  before update of status on public.shop_requests
  for each row
  execute function public.shop_requests_apply_decision();

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'shop_request_provision'
  ) then
    raise exception '0314: shop_request_provision is missing, so a dropdown approval could not provision';
  end if;
end $$;
