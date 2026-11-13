-- 0308: the daily cash count keeps its write path
--
-- `0011` created `record_cash_reconciliation_v1`, and `0025` dropped it while renaming the RPC
-- parameters to `payload` — but it never re-created this one, so the write path disappeared from
-- the ledger entirely. `src/pages/admin/payments/CashPositionPage.tsx` still called the dropped
-- name, which `tests/unit/rpcContractGuard.test.ts` reports as a client call `authenticated`
-- cannot execute: on QA the save would fail with "function not found" and the owner's counted
-- cash would never be recorded.
--
-- This file restores the function under the name and signature the ledger's own convention uses
-- (`payload jsonb`, no `_v1` suffix), with the body `0011` wrote, unchanged: admin-only, upsert on
-- (shop, day), an audit event on every save. The retired name is NOT brought back — a new call
-- site must use the ledger's current name.
--
-- Additive and idempotent: CREATE OR REPLACE on a function that does not exist today, plus the
-- ACL the rest of the write surface has (authenticated only, PUBLIC/anon revoked).

create or replace function public.record_cash_reconciliation(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid := app_current_user_id();
  v_actor_name text;
  v_shop_id uuid := current_shop_id();
  v_date date := (payload->>'date')::date;
  v_expected numeric(14,2) := (payload->>'expectedCash')::numeric;
  v_counted numeric(14,2) := (payload->>'countedCash')::numeric;
  v_notes text := payload->>'notes';
  v_recon_id uuid;
begin
  if not app_is_admin() then raise exception 'NOT_AUTHORIZED'; end if;
  select name into v_actor_name from users where id = v_actor_id;
  insert into cash_reconciliations(shop_id,reconciliation_date,expected_cash,counted_cash,variance,notes,reconciled_by,reconciled_by_name)
  values (v_shop_id,v_date,v_expected,v_counted,v_counted-v_expected,v_notes,v_actor_id,v_actor_name)
  on conflict(shop_id,reconciliation_date) do update set expected_cash=excluded.expected_cash,counted_cash=excluded.counted_cash,variance=excluded.variance,notes=excluded.notes,reconciled_by=excluded.reconciled_by,reconciled_by_name=excluded.reconciled_by_name
  returning id into v_recon_id;
  insert into audit_events(user_id,action,entity_type,entity_id,details) values (v_actor_id,'cash_reconciled','cash_reconciliation',v_recon_id,jsonb_build_object('date',v_date,'variance',v_counted-v_expected));
  return jsonb_build_object('id',v_recon_id,'variance',v_counted-v_expected);
end;
$$;

revoke all on function public.record_cash_reconciliation(jsonb) from public, anon;
grant execute on function public.record_cash_reconciliation(jsonb) to authenticated;

-- Self-check: the client path exists and a signed-in caller may use it, an anonymous one may not.
do $do$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'record_cash_reconciliation'
  ) then
    raise exception '0308: record_cash_reconciliation was not created';
  end if;
  if not has_function_privilege('authenticated', 'public.record_cash_reconciliation(jsonb)', 'EXECUTE') then
    raise exception '0308: authenticated cannot execute record_cash_reconciliation';
  end if;
  if has_function_privilege('anon', 'public.record_cash_reconciliation(jsonb)', 'EXECUTE') then
    raise exception '0308: anon must not execute record_cash_reconciliation';
  end if;
end $do$;
