-- 0318_the_pairing_function_is_named_server_only.sql
--
-- WHY THIS EXISTS (measured 2026-11-16, CI run 43941204849 on PR #69):
--
-- `tests/unit/writeRpcAnonGuard.test.ts` unions every `v_server_only` declaration in this directory
-- and compares it, in both directions, with the set `scripts/lib/rpc-contract.mjs` derives from the
-- ledger's own revokes. `0317` added `role_permissions_pair_customers_credit_limit` and revoked it
-- from `public`, `anon` and `authenticated` — a trigger function no client may call — but a revoke
-- with no declaration is an intent the guard cannot see, so the ledger held 36 server-only
-- functions while the migrations named 35 and the gate went red.
--
-- `0309` set the rule this file follows: state the intent in a NEW forward file rather than editing
-- a recorded migration, because QA has already applied `0317` and a recorded file must never be
-- rewritten. It revokes on existence, so a replay before `0317` exists is a no-op rather than an
-- error, and it asserts what exists instead of assuming it.
--
-- The function stays SECURITY DEFINER and client-proof; nothing else in the ledger moves.

do $server_only$
declare
  v_server_only constant text[] := array[
    'role_permissions_pair_customers_credit_limit'
  ];
  v_name text;
  v_sig text;
  v_open integer := 0;
begin
  foreach v_name in array v_server_only loop
    for v_sig in
      select p.oid::regprocedure::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
    loop
      execute format('revoke all on function %s from public, anon, authenticated', v_sig);
    end loop;
  end loop;

  -- Self-check: whoever can still execute it is the gap this file exists to close. Counted over the
  -- roles that actually exist, so a database without `anon`/`authenticated` still runs.
  select count(*) into v_open
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   cross join (values ('anon'), ('authenticated')) as role(name)
   where n.nspname = 'public'
     and p.proname = any (v_server_only)
     and has_function_privilege(role.name, p.oid, 'execute');

  if v_open > 0 then
    raise exception '0318: % client grant(s) remain on the credit-limit pairing function', v_open;
  end if;
end
$server_only$;
