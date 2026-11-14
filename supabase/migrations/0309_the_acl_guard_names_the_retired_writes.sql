-- 0309: the ACL guard names the retired writes the ledger keeps server-only
--
-- `tests/unit/writeRpcAnonGuard.test.ts` unions every `v_server_only` declaration in this directory
-- and compares it IN BOTH DIRECTIONS with the set `scripts/lib/rpc-contract.mjs` derives from the
-- ledger's own revokes. On this branch the ledger retires 30 functions while the migrations declare
-- 21: nine retired functions were never named, so the guard could not see the intent and their client
-- privileges were decided by whatever the default ACL happened to be. (Main names some of these in
-- later files; the development branch's copies predate that.)
--
-- This file states the intent in a NEW forward file rather than editing a recorded migration — a
-- migration QA and production have already applied must never be rewritten.
--
-- It revokes EXECUTE from PUBLIC and `authenticated` only. `anon` is left exactly as the ledger has
-- it: `request_employee_access` is deliberately callable before sign-in (that is the whole point of
-- an access request), and this file must not close a door the ledger opened.
--
-- Idempotent and guarded: a function that does not exist yet (a replay before its own migration) is
-- skipped, and the self-check only asserts what exists.

do $server_only$
declare
  v_server_only constant text[] := array[
    'audit_credit_limit_request_created',
    'create_employee_core',
    'create_sale_unchecked',
    'create_shop_internal',
    'customers_due_date_not_past',
    'delete_branch',
    'ensure_shop_default_roles',
    'grant_customer_defaults_to_role',
    'guard_co_owner_branch_lifecycle',
    'guard_co_owner_branch_management',
    'guard_employee_access_edit',
    'guard_operational_request',
    'marketplace_distance_km',
    'membership_in_active_shop',
    'mint_barcode',
    'notify_owner_of_customer_payment',
    'notify_owner_of_scheduled_money',
    'process_reminders',
    'prune_client_error_events',
    'purge_branch_data',
    'purge_shop_data',
    'request_employee_access',
    'resolve_active_shop',
    'resolve_product_classification',
    'return_items_mirror_qty',
    'stamp_customer_payment_actor',
    'stamp_operational_branch',
    'void_sale_v1'
  ];
  v_name text;
  v_sig text;
begin
  foreach v_name in array v_server_only loop
    for v_sig in
      select p.oid::regprocedure::text
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = v_name
    loop
      execute format('revoke all on function %s from public, authenticated', v_sig);
    end loop;
  end loop;
end $server_only$;

-- Self-check: wherever one of these functions exists, `authenticated` cannot execute it.
--
-- The privilege is asked of the function's OWN oid, not of a name with an empty argument list: most
-- of these take a `payload jsonb`, and `has_function_privilege('authenticated', 'public.f()', …)`
-- raises "function public.f() does not exist" before it can answer about privileges.
do $do$
declare
  v_retired constant text[] := array[
    'audit_credit_limit_request_created','create_employee_core','create_sale_unchecked',
    'create_shop_internal','customers_due_date_not_past','delete_branch','ensure_shop_default_roles',
    'grant_customer_defaults_to_role','guard_co_owner_branch_lifecycle','guard_co_owner_branch_management',
    'guard_employee_access_edit','guard_operational_request','marketplace_distance_km','membership_in_active_shop',
    'mint_barcode','notify_owner_of_customer_payment','notify_owner_of_scheduled_money','process_reminders',
    'prune_client_error_events','purge_branch_data','purge_shop_data','request_employee_access',
    'resolve_active_shop','resolve_product_classification','return_items_mirror_qty',
    'stamp_customer_payment_actor','stamp_operational_branch','void_sale_v1'
  ];
  r record;
begin
  for r in
    select p.oid, p.oid::regprocedure::text as signature,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as open_to_client
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any (v_retired)
  loop
    if r.open_to_client then
      raise exception '0309: % is still executable by authenticated', r.signature;
    end if;
  end loop;
end $do$;
