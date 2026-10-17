-- ═══════════════════════════════════════════════════════════════════════════════
-- 0218 — A permission override is written inside the caller's own shop
--
-- MEASURED (local catalog, 2026-10-17; same shape on QA and production):
--
--   user_permissions_select  self OR admin whose users.shop_id = the target's
--   user_permissions_insert  WITH CHECK (caller's users.role = 'admin')      ← no target constraint
--   user_permissions_delete  USING     (caller's users.role = 'admin')       ← no target constraint
--
-- `user_permissions` has no tenant column and no trigger, and the effective permission set is
-- computed per user_id (`get_effective_permissions`). So an admin of shop A could insert a grant
-- for a user who belongs to shop B, and it would take effect the next time that person acted in
-- shop B. The RPC path (`update_employee_access` → `guard_employee_access_edit`) is already
-- shop-scoped; this file closes the direct-write path so the table and the RPC agree.
--
-- WHY MEMBERSHIP AND NOT users.shop_id. `users.shop_id` is one value for a person who may belong to
-- several shops; the membership row is the record that says which shops a person actually belongs
-- to. A pending invitation already has its membership (status 'pending') when `create_employee_core`
-- writes its overrides in the same transaction, so no status filter is applied here.
--
-- NOTHING IS WIDENED: the caller must still be an admin of the shop they are standing in, and the
-- target must now also belong to that shop. Self-reads are preserved, because every client needs
-- to see its own grants.
-- ═══════════════════════════════════════════════════════════════════════════════

do $guard$
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'user_permissions' and c.relkind = 'r'
  ) then
    raise exception '0218: public.user_permissions does not exist, so this file cannot do what it says';
  end if;

  execute $stmt$drop policy if exists user_permissions_select on public.user_permissions;$stmt$;
  execute $stmt$create policy user_permissions_select on public.user_permissions
    for select to authenticated
    using (
      user_id = public.app_current_user_id()
      or (
        public.app_is_admin()
        and exists (
          select 1 from public.memberships m
           where m.user_id = user_permissions.user_id
             and m.tenant_id = public.current_shop_id()
        )
      )
    );$stmt$;

  execute $stmt$drop policy if exists user_permissions_insert on public.user_permissions;$stmt$;
  execute $stmt$create policy user_permissions_insert on public.user_permissions
    for insert to authenticated
    with check (
      public.app_is_admin()
      and exists (
        select 1 from public.memberships m
         where m.user_id = user_permissions.user_id
           and m.tenant_id = public.current_shop_id()
      )
    );$stmt$;

  execute $stmt$drop policy if exists user_permissions_delete on public.user_permissions;$stmt$;
  execute $stmt$create policy user_permissions_delete on public.user_permissions
    for delete to authenticated
    using (
      public.app_is_admin()
      and exists (
        select 1 from public.memberships m
         where m.user_id = user_permissions.user_id
           and m.tenant_id = public.current_shop_id()
      )
    );$stmt$;
end
$guard$;

-- Prove the write policies now name the shop the target belongs to. A policy that only asks
-- "is the caller an admin" is the exact shape this file exists to remove, so its absence is
-- asserted rather than assumed: this raises and rolls the file back if it is still there.
do $check$
declare
  v_missing text[];
  v_wide    text[];
begin
  select array_agg(want.name order by want.name) into v_missing
    from (values ('user_permissions_select'), ('user_permissions_insert'), ('user_permissions_delete')) want(name)
   where not exists (
     select 1 from pg_policy p
      where p.polrelid = 'public.user_permissions'::regclass and p.polname = want.name
   );
  if v_missing is not null then
    raise exception '0218: policies missing after the rewrite: %', array_to_string(v_missing, ', ');
  end if;

  select array_agg(p.polname order by p.polname) into v_wide
    from pg_policy p
   where p.polrelid = 'public.user_permissions'::regclass
     and p.polcmd in ('a', 'd')
     and position('memberships' in coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
                                     || coalesce(pg_get_expr(p.polqual, p.polrelid), '')) = 0;
  if v_wide is not null then
    raise exception '0218: a client write policy on user_permissions names no shop: %', array_to_string(v_wide, ', ');
  end if;

  raise notice '0218: user_permissions writes require the target to belong to the caller''s shop';
end
$check$;
