-- ═══════════════════════════════════════════════════════════════════════════════
-- 0221 — The tables 0208 created are not open to a client
--
-- FOUND BY THE RESTORE CHECK, not by reading the file. `restore-verify` compared the restored backup
-- with production and reported six tables whose RLS flag differs:
--
--   product_barcodes · barcode_registry · barcode_history · incidents ·
--   incident_rate_limits · incident_signatures
--
-- They were created by `0208` (the batch's function/tables half) from the ledger's shapes. Their RLS
-- and policies lived in `0072`, `0158` and `0160` — history production never received, and the
-- re-issue never carried, because none of those files was in the batch. Measured on production
-- 2026-10-17 after the apply:
--
--   relrowsecurity = false, 0 policies, and `anon` + `authenticated` hold SELECT and INSERT
--
-- i.e. the public anon key could read and insert barcodes and incident records.
--
-- WHY NO POLICIES. The client never reads these tables directly — it calls `product_barcodes_for`
-- and `record_incident`, both SECURITY DEFINER. RLS with no policy is a deny-by-default boundary for
-- `anon` and `authenticated`, and leaves the definer functions working exactly as they do now. This
-- file therefore narrows only: it grants nothing and creates no policy.
-- ═══════════════════════════════════════════════════════════════════════════════

do $rls$
declare
  t text;
  v_missing text[] := '{}';
  v_open text[] := '{}';
begin
  foreach t in array array[
    'product_barcodes', 'barcode_registry', 'barcode_history',
    'incidents', 'incident_rate_limits', 'incident_signatures'
  ] loop
    if exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = t and c.relkind = 'r'
    ) then
      execute format('alter table public.%I enable row level security', t);
    else
      v_missing := v_missing || t;
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise notice '0221: not present here, nothing to close: %', array_to_string(v_missing, ', ');
  end if;

  select array_agg(c.relname order by c.relname) into v_open
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname in ('product_barcodes','barcode_registry','barcode_history',
                       'incidents','incident_rate_limits','incident_signatures')
     and c.relrowsecurity is false;

  if v_open is not null then
    raise exception '0221: RLS is still disabled on %', array_to_string(v_open, ', ');
  end if;

  raise notice '0221: the six tables 0208 created are closed to anon and authenticated';
end
$rls$;
