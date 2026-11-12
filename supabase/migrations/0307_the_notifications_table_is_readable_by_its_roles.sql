-- 0307: the notification table is readable by the roles that use it
--
-- Root cause (measured 2026-11-12): QA's `/rest/v1/notifications` answers
--   {"code":"42501","message":"permission denied for table notifications",
--    "hint":"Grant the required privileges to the current role with: GRANT SELECT ON public.notifications TO anon;"}
-- so every signed-in screen that opens the notification drawer gets an HTTP 500
-- and tests/e2e/educationHelp.spec.ts fails on the console error it causes
-- (it passed on development, where the grants exist).
--
-- `notifications` is legacy out-of-band schema: no migration in this directory
-- creates it, so no migration ever re-issued its privileges. The development
-- database has them (`has_table_privilege('authenticated', ...) = true`), QA has
-- none, and production's ACL was never re-issued after 0223/0213 tightened the
-- schema. Policies alone do not grant access — PostgreSQL checks the table
-- privilege first — so the rows the policies describe stay unreachable.
--
-- This file re-issues the three privileges the application actually uses
-- (select the drawer, insert a notification, mark one read) to `authenticated`
-- only. Row visibility is still decided by the RLS policies on the table
-- (0213 owns them); nothing is granted to `anon`, and no policy, table, column
-- or write path is changed. Guarded on the table's existence so a database that
-- never had it changes nothing, and idempotent so a replay is a no-op.

do $do$
begin
  if to_regclass('public.notifications') is null then
    raise notice '0307: public.notifications is absent; nothing to grant';
    return;
  end if;

  execute 'grant select, insert, update on public.notifications to authenticated';
end $do$;

-- Self-check: the read path works for a signed-in caller and stays closed to anon.
do $do$
begin
  if to_regclass('public.notifications') is null then
    return;
  end if;

  if not has_table_privilege('authenticated', 'public.notifications', 'SELECT') then
    raise exception '0307: authenticated still cannot select from public.notifications';
  end if;
  if not has_table_privilege('authenticated', 'public.notifications', 'INSERT') then
    raise exception '0307: authenticated still cannot insert into public.notifications';
  end if;
  if not has_table_privilege('authenticated', 'public.notifications', 'UPDATE') then
    raise exception '0307: authenticated still cannot update public.notifications';
  end if;
  if has_table_privilege('anon', 'public.notifications', 'SELECT') then
    raise exception '0307: anon must not read public.notifications';
  end if;
end $do$;
