-- 0333 — the sender can read its own queue.
--
-- WHAT WAS WRONG. `0329` revoked the push tables from `PUBLIC`, `anon` and `authenticated`, which is
-- correct, and its comment promised they are "read only by the send-push function with the service
-- role". Nothing ever granted that. Measured on staging 2026-11-23, after the function was deployed
-- and its secrets set:
--
--   select has_table_privilege('service_role','public.push_deliveries','SELECT');  -- false
--   information_schema.role_table_grants → postgres only
--
-- so the first real call answered `500 {"error":"queue read failed: permission denied for table
-- push_deliveries"}`. A service-role key bypasses RLS but not table privileges. The pipeline would
-- have queued every event forever and never sent one — the sort of hole that only shows up when the
-- function is actually deployed, which is why it is fixed here rather than assumed away.
--
-- WHAT THIS FILE DOES. Grants exactly what the sender uses and nothing else: read the queue, stamp
-- it (`sent_at`, `attempts`, `last_error`), read the devices, and revoke a token FCM rejected
-- (`revoked_at`). No DELETE, no TRUNCATE, no REFERENCES. `anon` and `authenticated` are re-checked
-- and must still be refused, so this cannot become a way to open the tables to clients.

grant select, update on table public.push_deliveries to service_role;
grant select, update on table public.push_devices to service_role;

-- ── The proof ───────────────────────────────────────────────────────────────────────────────
do $proof$
begin
  if not has_table_privilege('service_role', 'public.push_deliveries', 'SELECT') then
    raise exception '0333: the send-push function still cannot read the queue';
  end if;
  if not has_table_privilege('service_role', 'public.push_deliveries', 'UPDATE') then
    raise exception '0333: the send-push function cannot stamp what it sent';
  end if;
  if not has_table_privilege('service_role', 'public.push_devices', 'SELECT') then
    raise exception '0333: the send-push function cannot resolve a recipient''s devices';
  end if;
  if not has_table_privilege('service_role', 'public.push_devices', 'UPDATE') then
    raise exception '0333: the send-push function cannot revoke a dead token';
  end if;

  if has_table_privilege('anon', 'public.push_deliveries', 'SELECT')
     OR has_table_privilege('authenticated', 'public.push_deliveries', 'SELECT')
     OR has_table_privilege('anon', 'public.push_devices', 'SELECT')
     OR has_table_privilege('authenticated', 'public.push_devices', 'SELECT') then
    raise exception '0333: a client role can read the push tables';
  end if;
end;
$proof$;
