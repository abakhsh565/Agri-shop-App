-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- THE FUNCTIONS THE LEDGER RETIRED ARE NOT FOR THE CLIENT
--
-- MEASURED 2026-10-17, hosted QA, by the repository's own integration suite — two of its guards, not a
-- failure count:
--
--   FAIL tests/integration/saleIdempotency.test.ts
--        4. the unchecked implementation is not reachable from an authenticated client
--        AssertionError: naming the inner function must not be a way around the guard
--   FAIL tests/integration/tenantResolverReplay.test.ts > the chain is internal
--        anon and authenticated cannot execute the resolvers → [ 'create_shop_internal' ]
--
-- WHERE IT CAME FROM. `0215` closes the write surface to `anon` — measured, and it does: 0 of 51
-- write-surface functions are reachable by `anon` on QA. But it also GRANTED `authenticated` EXECUTE on
-- every one of them, unconditionally, and that is a widening the batch is not allowed to make
-- (`docs/PRODUCTION_MIGRATION_PLAN.md` §6, "access is never widened"). The ledger deliberately retires
-- fifteen functions from the client — `create_sale_unchecked` exists so that `create_sale` can validate
-- before calling it, `create_shop_internal` and `create_employee_core` are the inner halves of RPCs the
-- app calls by their public names, `delete_branch`, `purge_shop_data`, `purge_branch_data`,
-- `process_reminders`, `void_sale_v1`, `prune_client_error_events`, `guard_operational_request`,
-- `guard_employee_access_edit`, `resolve_active_shop`, `membership_in_active_shop`, `mint_barcode`,
-- `marketplace_distance_km` — and `0215` handed seven of them back to any signed-in caller. A client
-- that names the inner function is exactly the bypass `saleIdempotency` asserts against.
--
-- WHY A NEW FILE AND NOT AN EDIT. `0215` is applied and recorded, with its hash; rewriting an applied
-- file would make the ledger say something about a database that is not true of it
-- (`PHASE_2_MIGRATION_LEDGER.md` §13). The plan's own rule is the fix: an applied change is corrected by
-- a new file. `0217` therefore revokes `authenticated` — and `anon`, and `PUBLIC` — from the ledger's
-- server-only set, and asserts that none of them is reachable when it finishes. Applied in the same
-- batch, the net effect is what §6 requires: the widening `0215` introduced exists for the seconds
-- between two files of one owner-run batch, and never on a schema that has only the batch's end state.
--
-- WHAT IT DOES NOT DO. It does not touch any function the ledger grants to the client, so nothing the
-- app calls changes. It does not name a function that does not exist on the target: each revoke is
-- inside an existence test, because production never had `create_sale_unchecked`, `purge_shop_data`,
-- `create_employee_core` or `marketplace_distance_km`, and a forward file has to apply wherever the
-- batch applies. And it is idempotent: revoking an absent privilege is a no-op.
--
-- THE LIST IS NOT HAND-MAINTAINED. `tests/unit/writeRpcAnonGuard.test.ts` reads the ledger's own
-- server-only set (`scripts/lib/rpc-contract.mjs`) and fails if this file stops naming exactly it, so a
-- future migration that retires another function cannot leave this file silently out of date.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

do $acl$
declare
  v_server_only constant text[] := array[
    'void_sale_v1',
    'process_reminders',
    'create_sale_unchecked',
    'create_employee_core',
    'purge_shop_data',
    'resolve_active_shop',
    'membership_in_active_shop',
    'create_shop_internal',
    'mint_barcode',
    'purge_branch_data',
    'delete_branch',
    'marketplace_distance_km',
    'guard_operational_request',
    'guard_employee_access_edit',
    'prune_client_error_events'
  ];
  r record;
  v_retired text[] := '{}';
  v_left text[];
begin
  for r in
    select p.oid as oid, p.oid::regprocedure as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname = any (v_server_only)
     order by p.proname loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    v_retired := v_retired || r.proname::text;
  end loop;

  select array_agg(p.proname order by p.proname) into v_left
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.proname = any (v_server_only)
     and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_left is not null then
    raise exception '0217: a retired function is still reachable by an API role: %', array_to_string(v_left, ', ');
  end if;

  raise notice '0217: % of the ledger''s % server-only function(s) exist here and are now closed to both API roles: %',
    coalesce(array_length(v_retired, 1), 0), array_length(v_server_only, 1),
    coalesce(array_to_string(v_retired, ', '), '(none present)');
end
$acl$;
