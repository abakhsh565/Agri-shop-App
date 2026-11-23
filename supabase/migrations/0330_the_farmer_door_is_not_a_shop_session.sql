-- 0330 — the farmer surface is not a shop session.
--
-- WHY THIS FILE EXISTS. `0325`–`0329` added the farmer app's doors (`farmer_api_*`) and three
-- internal helpers. Their ACL contract is unusual and must stay unusual: the farmer app calls
-- them with a credential, not a login, so they are executable by `anon` and must **not** be
-- executable by `authenticated` — a signed-in shop session has no farmer token and must never be
-- able to mint a message as somebody else's farmer.
--
-- The repository's `writeRpcAnonGuard` keeps two records of that set: the ledger's own reading of
-- the migrations, and a hand-written `v_server_only` array that every forward file carrying a
-- retirement declares. The ledger already reads these twelve as server-only; the declaration was
-- missing, so the two records disagreed and the guard failed. This file is the declaration, and it
-- is not decoration: it re-applies the revokes and then proves the result, so a later migration
-- that quietly grants one of these to `authenticated` fails here instead of shipping.
--
-- It changes no data, no column and no business rule. The farmer app's own `anon` grants are
-- preserved — a file that closed the farmer's door while closing the shop's would be worse than
-- the defect it fixes.

DO $acl$
DECLARE
  v_server_only constant text[] := array[
    'farmer_api_answer_offer',
    'farmer_api_create_credit_request',
    'farmer_api_join_shop',
    'farmer_api_me',
    'farmer_api_notifications',
    'farmer_api_register_device',
    'farmer_api_request_visit',
    'farmer_api_send_message',
    'farmer_api_thread',
    'farmer_by_token',
    'farmer_shop_scope',
    'owner_membership_for_farmers'
  ];
  v_fn  record;
  v_sig text;
BEGIN
  FOR v_fn IN
    SELECT p.oid, p.proname, n.nspname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (v_server_only)
  LOOP
    v_sig := format('%I.%I(%s)', v_fn.nspname, v_fn.proname,
                    pg_get_function_identity_arguments(v_fn.oid));

    -- A signed-in shop session is not a farmer and never gets these.
    EXECUTE format('revoke all on function %s from public, authenticated', v_sig);

    -- The three helpers are internal: nobody calls them over HTTP, not even the farmer app.
    IF v_fn.proname NOT LIKE 'farmer_api_%' THEN
      EXECUTE format('revoke all on function %s from anon', v_sig);
    END IF;

    IF has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '0330: % is still executable by authenticated', v_sig;
    END IF;

    IF v_fn.proname LIKE 'farmer_api_%'
       AND NOT has_function_privilege('anon', v_fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '0330: % is the farmer app''s door and anon can no longer execute it', v_sig;
    END IF;
  END LOOP;
END;
$acl$;
