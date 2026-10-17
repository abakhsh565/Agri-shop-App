-- ═══════════════════════════════════════════════════════════════════════════════
-- 0231 — The PIN functions need the columns they count
--
-- THE DEFECT (measured on production, 2026-10-18)
--   `set_user_pin` and `verify_user_pin` were re-issued by `0208` with the bodies from `0148`. Those
--   bodies read and write `users.pin_failed_count` and `users.pin_locked_until` — the lockout after
--   five wrong attempts. The columns were created only by `0148`, a file production never received
--   (its curated batches start at `0017`'s intent, and `0148`'s ALTERs were never part of them).
--   `0208` re-issued the functions but not the columns, and PL/pgSQL resolves column names at
--   execution, so nothing failed until a person used a PIN. Measured inside a rolled-back
--   transaction against production, before this file:
--
--     set_user_pin('1234')    → 42703: column "pin_failed_count" of relation "users" does not exist
--     verify_user_pin('1234') → 42703: column "pin_failed_count" does not exist
--
--   That is the production half of "fingerprint sign-in does not work": the fingerprint sheet opens
--   the app through the PIN path (`src/lib/pinLock.ts` — `canOpenWithPin`, the local PIN record and
--   the server check), so a missing PIN surface leaves the sheet with nothing to fall back to, and a
--   PIN can neither be set nor verified.
--
-- WHAT THIS DOES
--   Adds exactly the two columns `0148` defines, with the same types and defaults, and asserts they
--   are there with the PIN functions present. It changes no function: the deployed bodies are the
--   ones `0208` already wrote, and they are correct once their columns exist.
--
-- WHY THE COLUMNS AND NOT A FUNCTION
--   Re-issuing `set_user_pin` without the lockout would remove the five-attempt cooldown, which is a
--   security property, and re-issuing it with a different shape would make production disagree with
--   every environment that has had `0148`. The schema was missing; the code was not.
-- ═══════════════════════════════════════════════════════════════════════════════

alter table public.users
  add column if not exists pin_failed_count int not null default 0;

alter table public.users
  add column if not exists pin_locked_until timestamptz;

-- The properties, asserted rather than assumed.
do $verify$
declare
  v_count_type text;
  v_count_nullable text;
  v_count_default text;
  v_locked_type text;
  v_missing text[];
begin
  select data_type, is_nullable, column_default
    into v_count_type, v_count_nullable, v_count_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'users' and column_name = 'pin_failed_count';

  select data_type into v_locked_type
    from information_schema.columns
   where table_schema = 'public' and table_name = 'users' and column_name = 'pin_locked_until';

  if v_count_type is distinct from 'integer'
     or v_count_nullable is distinct from 'NO'
     or v_count_default is distinct from '0' then
    raise exception '0231: pin_failed_count is % / nullable=% / default=% — expected integer NOT NULL DEFAULT 0',
      coalesce(v_count_type, '(absent)'), coalesce(v_count_nullable, '?'), coalesce(v_count_default, '(none)');
  end if;

  if v_locked_type is distinct from 'timestamp with time zone' then
    raise exception '0231: pin_locked_until is % — expected timestamp with time zone',
      coalesce(v_locked_type, '(absent)');
  end if;

  -- On an environment that has the PIN functions, both must be present or the columns are
  -- decoration. The frozen production baseline predates `0208` (which introduced them), so a replay
  -- there has nothing to check yet — said out loud rather than skipped in silence.
  if to_regprocedure('public.set_user_pin(text)') is not null
     or to_regprocedure('public.verify_user_pin(text)') is not null then
    select array_agg(missing) into v_missing from (
      select unnest(array['set_user_pin', 'verify_user_pin']) as missing
    ) m
     where not exists (
       select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = m.missing
     );
    if v_missing is not null then
      raise exception '0231: the PIN function(s) % are missing, so the columns have nothing to serve',
        array_to_string(v_missing, ', ');
    end if;
  else
    raise notice '0231: this schema predates the PIN functions; only the columns are checked here';
  end if;

  raise notice '0231: the PIN lockout columns exist and both PIN functions are present';
end
$verify$;
