-- ═══════════════════════════════════════════════════════════════════════════════
-- 0223 — The public anon key reads no business table
--
-- MEASURED ON PRODUCTION 2026-10-17, with the anon key and the anon role:
--
--   sales 52 · customers 6 · products 6 · companies 4 · users 4 · memberships 4
--
-- readable without a session. Forty-two tables carried a grant to `anon`, and thirty-eight of them
-- carried a permissive policy whose predicate was the literal `true` — the legacy
-- `*_select_anon` / `public_all_*` set from the demo-era `0022`. RLS was enabled, and it was
-- answering "yes".
--
-- WHY IT WAS NOT CAUGHT. Every guard we wrote asked "can `authenticated` read only its own rows?".
-- That question was answered correctly, and it was the wrong question for a grant that `anon` also
-- holds: a policy is an OR across the policies that apply to the current role, and a
-- `to public ... using (true)` policy applies to every role.
--
-- WHAT IT DOES — narrowing only, and it cannot widen anything:
--   1. Every permissive policy that names `public` or `anon` is retargeted to `authenticated`. The
--      predicate is not touched, so `authenticated` keeps exactly the policies it had; `anon`
--      simply stops being one of their roles.
--   2. Every table, view, materialised view and sequence in `public` is revoked from `anon`. This is
--      the belt to the policy's braces: even a policy that a later migration re-opens cannot be
--      reached without a grant.
--   3. The pre-authentication flows do not read tables — they call SECURITY DEFINER functions
--      (`lookup_user_by_phone`, `get_my_shop_request`, `resolve_invite`, `resolve_shop_code`,
--      `insert_shop_request`). Those are functions, not tables; their grants are untouched, and
--      `0215`/`0217` already removed every write RPC from `anon`.
--   4. It asserts both properties and rolls itself back if either fails.
--
-- NOT TOUCHED ON PURPOSE. `permissions` is a catalogue the app reads after sign-in, not before; it
-- is retargeted like the rest and `authenticated` still reads it through `get_my_permissions`.
-- Nothing in `src/` reads a table before a session exists — checked, not assumed.
-- ═══════════════════════════════════════════════════════════════════════════════

do $policies$
declare
  r record;
  v_moved int := 0;
  v_left text;
begin
  for r in
    select p.tablename, p.policyname, p.roles::text[] as roles
      from pg_policies p
     where p.schemaname = 'public'
       and ('public' = any (p.roles) or 'anon' = any (p.roles))
  loop
    execute format('alter policy %I on public.%I to authenticated', r.policyname, r.tablename);
    v_moved := v_moved + 1;
  end loop;

  select string_agg(tablename || '.' || policyname, ', ')
    into v_left
    from pg_policies
   where schemaname = 'public'
     and ('public' = any (roles) or 'anon' = any (roles));

  if v_left is not null then
    raise exception '0223: policies still name public or anon: %', v_left;
  end if;

  raise notice '0223: retargeted % policy/policies from public/anon to authenticated', v_moved;
end
$policies$;

do $grants$
declare
  r record;
  v_revoked int := 0;
begin
  for r in
    select c.relname, c.relkind
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm', 'S')
  loop
    if r.relkind = 'S' then
      execute format('revoke all on sequence public.%I from anon', r.relname);
    else
      execute format('revoke all on table public.%I from anon', r.relname);
    end if;
    v_revoked := v_revoked + 1;
  end loop;

  -- Assert the thing that was measured: anon holds no privilege on any relation in public.
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p', 'v', 'm')
       and (
         has_table_privilege('anon', c.oid, 'SELECT')
         or has_table_privilege('anon', c.oid, 'INSERT')
         or has_table_privilege('anon', c.oid, 'UPDATE')
         or has_table_privilege('anon', c.oid, 'DELETE')
       )
  loop
    raise exception '0223: anon still holds a table privilege on public.%', r.relname;
  end loop;

  raise notice '0223: revoked every privilege from anon on % relation(s)', v_revoked;
end
$grants$;
