-- ═══════════════════════════════════════════════════════════════════════════════
-- 0226 — The trigger function 0222 retires is named where retirements are counted
--
-- `0222` creates `stamp_operational_branch()` and revokes EXECUTE on it from `public, anon,
-- authenticated`: a trigger function is not an RPC, and no API role should be able to name it.
--
-- `tests/unit/writeRpcAnonGuard.test.ts` keeps the ledger's server-only set honest by comparing it
-- with the names declared inside migrations — a list that has to grow whenever a function is retired.
-- Until now that list lived only in `0217`, which is applied and cannot be edited. This file puts the
-- new name in the same shape; the guard reads every declaration in the directory and unions them, so
-- the comparison stays exact in both directions and a future retirement cannot ship unnamed.
--
-- Catalog-guarded: on the frozen 2026-10-01 baseline `0222`'s function does not exist yet, and a file
-- that fails there is a file that cannot be verified.
-- ═══════════════════════════════════════════════════════════════════════════════

do $server_only$
declare
  v_server_only constant text[] := array[
    'stamp_operational_branch'
  ];
  v_name text;
  v_sig text;
  v_bad text[] := '{}';
begin
  foreach v_name in array v_server_only loop
    for v_sig in
      select p.oid::regprocedure::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
    loop
      if has_function_privilege('anon', v_sig, 'EXECUTE')
         or has_function_privilege('authenticated', v_sig, 'EXECUTE')
         or has_function_privilege('public', v_sig, 'EXECUTE') then
        v_bad := v_bad || v_sig;
      end if;
    end loop;
  end loop;

  if cardinality(v_bad) > 0 then
    raise exception '0226: a retired function is still reachable by an API role: %',
      array_to_string(v_bad, ', ');
  end if;

  raise notice '0226: % retired function(s) are unreachable from every API role', cardinality(v_server_only);
end
$server_only$;
