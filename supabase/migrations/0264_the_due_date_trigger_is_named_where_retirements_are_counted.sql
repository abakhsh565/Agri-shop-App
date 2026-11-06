-- ═══════════════════════════════════════════════════════════════════════════════
-- 0264 — The due-date trigger 0260 retires is named where retirements are counted
--
-- `0260` creates `customers_due_date_not_past()` and revokes EXECUTE on it from
-- `public, anon, authenticated`: a trigger function is not an RPC, and no API role should be able
-- to name it. But the file did not add the name to the declaration list that
-- `tests/unit/writeRpcAnonGuard.test.ts` reads, so the ledger's server-only set and the migrations'
-- declared set disagreed by exactly this one function.
--
-- Same shape as `0226`: the guard reads every declaration in the directory and unions them, so the
-- comparison stays exact in both directions and a future retirement cannot ship unnamed. `0260`
-- stays untouched — it is applied, and an applied change is corrected by a new file.
--
-- Catalog-guarded: the baseline predates the function, so a target without it simply has nothing to
-- assert rather than failing.
-- ═══════════════════════════════════════════════════════════════════════════════

do $server_only$
declare
  v_server_only constant text[] := array[
    'customers_due_date_not_past'
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
    raise exception '0264: a retired function is still reachable by an API role: %',
      array_to_string(v_bad, ', ');
  end if;

  raise notice '0264: % retired function(s) are unreachable from every API role', cardinality(v_server_only);
end
$server_only$;
