-- ═══════════════════════════════════════════════════════════════════════════════
-- 0219 — The people table is scoped to the shop you are standing in
--
-- MEASURED (2026-10-17): the tracked model scopes `public.users` by shop —
-- `users_select`, `users_insert` and `users_update` all carry `shop_id = current_shop_id()` locally.
-- Production's out-of-band setup left `users` among its fourteen PERMISSIVE policies whose expression
-- is `true` (`device-evidence/production-acls-measured-2026-10-17.md` §1), which is why an admin of
-- one shop could edit a person belonging to another there. `0216` removed only the unauthenticated
-- half; this file is the row half: the row must belong to the caller's shop.
--
-- WHY IT IS SAFE
--   * It removes only policies whose expression is exactly `true` — a policy that asks nothing.
--     A scoped policy, restrictive policy or trigger is never touched.
--   * The three canonical policies are replaced with the same shop predicate the local, verified
--     model already carries, plus `id = app_current_user_id()` so a person can always read and edit
--     their own row even when `users.shop_id` (one value per person) is not the shop they are standing
--     in. Nothing is widened: both halves were already reachable through the old policy.
--   * `prevent_role_escalation` is untouched and still decides role/status/other-user edits.
--   * No table, column, row or grant is changed. Policies only.
-- ═══════════════════════════════════════════════════════════════════════════════

do $guard$
declare
  v_dropped text[] := '{}';
  r record;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'users' and c.relkind = 'r'
  ) then
    raise exception '0219: public.users does not exist, so this file cannot do what it says';
  end if;

  execute 'alter table public.users enable row level security';

  -- Only the policies that answer nothing. `true` is the whole finding this file corrects.
  for r in
    select p.polname
      from pg_policy p
     where p.polrelid = 'public.users'::regclass
       and p.polpermissive
       and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') in ('true', '(true)')
            or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') in ('true', '(true)'))
  loop execute format('drop policy %I on public.users', r.polname);
    v_dropped := v_dropped || r.polname;
  end loop;

  execute $stmt$drop policy if exists users_select on public.users;$stmt$;
  execute $stmt$create policy users_select on public.users
    for select to authenticated
    using (shop_id = public.current_shop_id() or id = public.app_current_user_id());$stmt$;

  execute $stmt$drop policy if exists users_insert on public.users;$stmt$;
  execute $stmt$create policy users_insert on public.users
    for insert to authenticated
    with check (shop_id = public.current_shop_id());$stmt$;

  execute $stmt$drop policy if exists users_update on public.users;$stmt$;
  execute $stmt$create policy users_update on public.users
    for update to authenticated
    using (shop_id = public.current_shop_id() or id = public.app_current_user_id())
    with check (shop_id = public.current_shop_id() or id = public.app_current_user_id());$stmt$;

  raise notice '0219: users policies rewritten; dropped always-true policies: [%]',
    array_to_string(v_dropped, ', ');
end
$guard$;

-- A policy that still answers `true` is the exact state this file exists to remove.
do $check$
declare
  v_open    text[];
  v_missing text[];
begin
  select array_agg(p.polname order by p.polname) into v_open
    from pg_policy p
   where p.polrelid = 'public.users'::regclass
     and p.polpermissive
     and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') in ('true', '(true)')
          or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') in ('true', '(true)'));
  if v_open is not null then
    raise exception '0219: an always-true policy remains on public.users: %', array_to_string(v_open, ', ');
  end if;

  select array_agg(want.name order by want.name) into v_missing
    from (values ('users_select'), ('users_insert'), ('users_update')) want(name)
   where not exists (
     select 1 from pg_policy p
      where p.polrelid = 'public.users'::regclass and p.polname = want.name
        and (coalesce(pg_get_expr(p.polqual, p.polrelid), '')
             || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')) like '%current_shop_id%'
   );
  if v_missing is not null then
    raise exception '0219: a users policy does not name the caller''s shop: %', array_to_string(v_missing, ', ');
  end if;

  raise notice '0219: public.users is readable and writable only inside the caller''s shop';
end
$check$;
