-- ═══════════════════════════════════════════════════════════════════════════════
-- 0229 — The return mirror is named where retirements are counted
--
-- `0227` and `0228` install `return_items_mirror_qty()`, the trigger that keeps `return_items.qty`
-- equal to the quantity the return actually carries, and revoke EXECUTE on it from
-- `public, anon, authenticated` — a trigger function is not an RPC and no API role should be able to
-- name it.
--
-- `tests/unit/writeRpcAnonGuard.test.ts` compares the ledger's server-only set with the names declared
-- inside migrations, in both directions. `0227` is applied and cannot be edited; this file puts the
-- name in the same `v_server_only constant text[]` shape `0217` and `0226` use, so the set stays exact
-- and a future retirement cannot ship unnamed. The guard reads every declaration in the directory and
-- unions them.
--
-- Catalog-guarded: on a database where neither file has run, the function does not exist and nothing
-- is asserted about it (a file that cannot be verified is a file that cannot be applied).
-- ═══════════════════════════════════════════════════════════════════════════════

do $server_only$
declare
  v_server_only constant text[] := array[
    'return_items_mirror_qty'
  ];
  v_name text;
  v_sig text;
  v_bad text[] := '{}';
  v_found int := 0;
begin
  foreach v_name in array v_server_only loop
    for v_sig in
      select p.oid::regprocedure::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
    loop
      v_found := v_found + 1;
      if has_function_privilege('anon', v_sig, 'EXECUTE')
         or has_function_privilege('authenticated', v_sig, 'EXECUTE')
         or has_function_privilege('public', v_sig, 'EXECUTE') then
        v_bad := v_bad || v_sig;
      end if;
    end loop;
  end loop;

  if cardinality(v_bad) > 0 then
    raise exception '0229: a retired function is still reachable by an API role: %',
      array_to_string(v_bad, ', ');
  end if;

  if v_found = 0 then
    raise notice '0229: the return mirror is not installed on this database — nothing to retire';
  else
    raise notice '0229: the return mirror is installed and unreachable from every API role';
  end if;
end
$server_only$;
