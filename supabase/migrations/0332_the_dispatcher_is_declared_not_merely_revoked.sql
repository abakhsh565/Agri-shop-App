-- 0332 — the dispatcher is declared, not merely revoked.
--
-- WHY THIS FILE EXISTS. `0331` created `push_dispatch_tick()` and revoked it from `public`, `anon`
-- and `authenticated`, and the ledger's static reader does see those three statements: the function
-- is already counted in its "revoked from authenticated (server-only)" set. What was missing is the
-- other half of the record — the hand-written `v_server_only` array that every forward file retiring
-- a function must carry. `tests/unit/writeRpcAnonGuard.test.ts` compares the declaration against the
-- ledger in both directions, so the ledger naming a function no file declares failed the gates
-- (run `45202876487`, job `Gates`, `the correction names exactly what the ledger retires`).
--
-- This is the same shape as `0330`, deliberately: a declaration file that re-applies the revokes and
-- then proves them, so it is not a comment that can drift. `0331` was already applied to staging when
-- the gap surfaced, and a version that means two different things may not be reconciled — hence a new
-- version rather than an edit. It changes no data, no column and no business rule.

DO $acl$
DECLARE
  v_server_only constant text[] := array[
    'push_dispatch_tick'
  ];
  v_name text;
BEGIN
  FOREACH v_name IN ARRAY v_server_only LOOP
    IF has_function_privilege('anon', format('public.%I()', v_name), 'EXECUTE') THEN
      RAISE EXCEPTION '0332: % is still reachable by anon', v_name;
    END IF;
    IF has_function_privilege('authenticated', format('public.%I()', v_name), 'EXECUTE') THEN
      RAISE EXCEPTION '0332: % is still reachable by a signed-in client', v_name;
    END IF;
  END LOOP;
END;
$acl$;

-- The same revoke, in the literal form the ledger reads, so a database that applies only the file
-- that declares a function still ends with the ACL this file promises.
revoke all on function public.push_dispatch_tick() from public;
revoke all on function public.push_dispatch_tick() from anon;
revoke all on function public.push_dispatch_tick() from authenticated;
