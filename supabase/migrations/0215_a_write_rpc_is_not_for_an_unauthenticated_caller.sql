-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- A WRITE RPC IS NOT FOR AN UNAUTHENTICATED CALLER
--
-- MEASURED 2026-10-17, hosted QA, by the repository's own live-schema guard
-- (`tests/integration/rbacInvariants.test.ts`, Invariant B). Nine write RPCs were executable by
-- `anon` after batch 2 and the re-issue of 0177–0198 had been applied:
--
--   approve_credit_limit_request_v2   archive_company        create_company
--   create_role                       delete_my_account      delete_product_barcode
--   delete_role                       reject_credit_limit_request_v2
--   update_role
--
-- WHERE IT CAME FROM, AND WHY A FRESH REPLAY REPRODUCES IT
--   0208 carries, per function, the EXECUTE contract "from the ledger" — i.e. the state staging's own
--   catalog holds — and for these nine that state is `anon` MAY EXECUTE. 0214's ACL pass then
--   re-applies every ledger ACL statement after the last create, so the grant is not an accident of
--   ordering: it is what the batch is written to produce. Any environment built from those files ends
--   in the same place, which is what the guard caught on QA.
--
-- WHY IT IS A DEFECT EVEN THOUGH EVERY BODY REFUSES
--   Each of the nine is guarded internally (Invariant E proves it), so an anonymous call is answered
--   `NOT_AUTHENTICATED` rather than performing the write. The grant is still wrong twice over:
--
--     * LEAST PRIVILEGE. An unauthenticated role is allowed to reach code that creates roles, edits
--       roles, deletes roles, archives suppliers and closes accounts. That is not a permission anyone
--       decided; it is PostgreSQL's PUBLIC default surviving a batch that meant to reproduce a
--       contract.
--     * DEFENCE IN DEPTH. The only thing between `anon` and a write is the correctness of each
--       body's first IF. A body whose guard is removed later becomes an unauthenticated write RPC,
--       and the guard that would notice (Invariant E) runs after the schema has been applied.
--
--   Production is in the same shape, measured read-only the same day
--   (`device-evidence/production-acls-measured-2026-10-17.md`): all 37 of its public functions are
--   executable by `anon`, including `create_sale`, `void_sale`, `process_return`, `adjust_stock` and
--   `record_customer_payment`. That document says 0208 “is where anon loses the RPCs it currently
--   holds”. For the nine above that claim is false, and this file is the correction — including the
--   legacy production RPCs, which are closed here too.
--
-- WHAT THIS FILE DOES
--   * It NARROWS access and nothing else: no object is created, dropped or renamed, no column
--     changes, no row is read or written. `revoke execute … from public, anon` plus an explicit
--     `grant execute … to authenticated, service_role` — the two roles that are supposed to reach
--     these functions.
--   * It is idempotent: the loop runs whether or not a function was open, and `pg_proc` decides
--     which functions exist.
--   * The write surface is the SAME regular expression and the SAME allow-list the live guard uses
--     (`ANON_ALLOWED_WRITES`), so the file and the guard cannot drift into disagreeing quietly. The
--     allow-list is the genuinely pre-session writes only: public registration and the platform's
--     own incident/memory recorders.
--   * Trigger functions are closed to every API role as well. A trigger does not check EXECUTE when
--     it fires, so this costs nothing; it removes five production functions (`prevent_role_escalation`,
--     `protect_customer_financials`, `protect_product_stock`, `protect_sale_financials`,
--     `update_updated_at_column`) that nobody chose to expose.
--   * It ENDS WITH AN ASSERTION, asked of the same role PostgreSQL would ask: after the loop, any
--     function on the surface that `anon` can still execute fails the file. An environment where the
--     revocation silently did not apply cannot report success.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

do $acl$
declare
  -- The write surface: the prefix set tests/integration/rbacInvariants.test.ts calls a write RPC.
  v_surface constant text :=
    '^(create_|update_|delete_|record_|process_|void_|adjust_|archive_|restore_|deactivate_|activate_|approve_|reject_|upsert_|insert_)';
  -- The writes that legitimately happen before a session exists, verbatim from ANON_ALLOWED_WRITES.
  v_preauth constant text[] := array[
    'insert_shop_request',
    'record_attempt', 'record_incident', 'record_memory', 'record_resolution'
  ];
  r record;
  v_closed text[] := '{}';
  v_left text[];
  v_roles text[];
begin
  -- A missing role would make the assertion below vacuous, so it is a refusal, not a skip.
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    raise exception '0215: role "anon" does not exist, so this file cannot prove what it just did';
  end if;

  -- The roles these functions are FOR, resolved from the cluster rather than assumed, so the file
  -- applies on a database that carries only one of them instead of failing on a missing grantee.
  v_roles := array(
    select rolname from pg_roles
     where rolname in ('authenticated', 'service_role')
     order by rolname
  );

  for r in
    select p.oid as oid, p.oid::regprocedure as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.proname ~ v_surface
       and not (p.proname = any (v_preauth))
     order by p.proname loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    if array_length(v_roles, 1) is not null then
      execute format('grant execute on function %s to %s', r.sig, array_to_string(v_roles, ', '));
    end if;
    v_closed := v_closed || r.proname::text;
  end loop;

  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and p.prorettype = 'trigger'::regtype
     order by p.proname loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);
    v_closed := v_closed || (r.proname::text || '(trigger)');
  end loop;

  -- The pre-auth writes keep their grant; assert that too, so a future widening of the surface
  -- cannot quietly close registration instead of the thing it was aiming at.
  select array_agg(p.proname order by p.proname) into v_left
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and p.proname = any (v_preauth)
     and p.proname ~ v_surface
     and not has_function_privilege('anon', p.oid, 'EXECUTE');
  if v_left is not null then
    raise exception '0215: a pre-session write lost its anon grant: %', array_to_string(v_left, ', ');
  end if;

  select array_agg(p.proname order by p.proname) into v_left
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prokind = 'f'
     and (
       (p.proname ~ v_surface and not (p.proname = any (v_preauth))
        and has_function_privilege('anon', p.oid, 'EXECUTE'))
       or (p.prorettype = 'trigger'::regtype
        and (has_function_privilege('anon', p.oid, 'EXECUTE')
          or has_function_privilege('authenticated', p.oid, 'EXECUTE')))
     );
  if v_left is not null then
    raise exception '0215: still executable by an API role after the revocation: %', array_to_string(v_left, ', ');
  end if;

  raise notice '0215: closed % function(s) to anon: %',
    coalesce(array_length(v_closed, 1), 0),
    coalesce(array_to_string(v_closed, ', '), '(none present)');
end
$acl$;
