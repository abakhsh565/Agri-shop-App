-- 0316_the_login_bridge_carries_row_level_security.sql
--
-- WHY THIS EXISTS (measured 2026-11-16, CI run 43786025437 on staging):
--
-- `securityAudit` asserts that every table in `public` has row level security enabled, because a
-- table without it is readable by any role that holds a grant. `0315` created `public.login_bridge`
-- — the one-row switch that lets a demo-OTP database mint the login identity an SMS sign-in would
-- have created — and revoked every grant on it, but it never enabled RLS. So on every database
-- that applied 0315 (development, staging/QA) the audit failed with "expected false to be true",
-- and the failure was reported as if it belonged to whichever branch happened to run next: two
-- runs on staging and PR #69 both carried it while touching nothing near login.
--
-- RLS here is defence in depth, not the only lock: `0315` already revokes ALL from `public`, `anon`
-- and `authenticated`, so no client role has a grant to read the switch in the first place. With RLS
-- on and no policy, the table is additionally closed to any future grant added by mistake, and the
-- only readers are the functions that need it (`dev_login_identity`, SECURITY DEFINER, executed as
-- the owner) and `service_role` (BYPASSRLS). There is deliberately no policy: the switch is
-- server-side state, and a policy would be a second way to read it.
--
-- NO DATA AND NO API CHANGES. The table keeps its single row, its grants and its shape; this file
-- only flips `rowsecurity` and asserts it, so a database where the flag fails to take refuses the
-- migration instead of shipping a table the audit would fail on again.

alter table public.login_bridge enable row level security;

-- Restate the revokes from 0315 so a replay on a database that somehow re-granted the table closes
-- it again. Idempotent by nature: revoking a privilege that is already revoked is a no-op.
revoke all on table public.login_bridge from public, anon, authenticated;

comment on table public.login_bridge is
  'Whether this database creates the login identity a real SMS sign-in would have created. Off unless development switches it on. RLS on, no policies: server-side state only (0316).';

-- ─── Self-check ───────────────────────────────────────────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_tables
     where schemaname = 'public'
       and tablename = 'login_bridge'
       and rowsecurity
  ) then
    raise exception '0316: login_bridge still has no row level security, so securityAudit would fail again';
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'login_bridge'
  ) then
    raise exception '0316: login_bridge grew a policy — it is server-side state and must stay policy-free';
  end if;
end $$;
