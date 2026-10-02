-- ============================================================
-- 0176 — the anon key cannot write, and cannot create
-- ============================================================
-- FINDING (PRODUCTION_READINESS_AUDIT.md §C item 5, measured against QA on 2026-10-01):
--   34 of the 54 tables in `public` granted the `anon` role INSERT, UPDATE and DELETE, and `anon`
--   held CREATE on the schema itself. `anon` is the key that ships inside the app bundle, so every
--   one of those grants is a write path that rests on RLS being correct — one widened or missing
--   policy away from a public write endpoint. Privilege and policy should both have to say yes:
--   this revokes the privilege so RLS is the second gate instead of the only one.
--
-- SELECT is deliberately NOT revoked. The app reads with the anon key before sign-in (0042b exists
-- precisely because that read was once blocked by an over-eager policy), and no read path is
-- touched here.
--
-- The pre-login WRITE path is unaffected. Shop registration goes through insert_shop_request(),
-- an SECURITY DEFINER function owned by postgres, which writes with its owner's privileges — so
-- revoking the caller's table privileges cannot reach it. Verified after applying, as anon, on QA
-- (evidence: PHASE_2_MIGRATION_LEDGER.md §13): an anon INSERT is refused while the RPC still
-- succeeds.
--
-- Idempotent, and forward-looking: REVOKE is a no-op where the privilege is already absent, and the
-- table list is read from the catalog at apply time, so re-running this file covers any table added
-- afterwards.
do $$
declare
  rel record;
  touched int := 0;
begin
  for rel in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
       and has_table_privilege('anon', c.oid, 'INSERT, UPDATE, DELETE')
     order by c.relname
  -- The trailing comment is load-bearing: tests/unit/migrationReplayability.test.ts flags a line
  -- that is nothing but one to four lower-case letters followed by a lower-case line, because that
  -- is how 0012 split an identifier across a line break. A bare `loop` line is the same shape and a
  -- false positive, so the line carries a comment instead of being "tidied" into one.
  loop -- for each table that still lets anon write
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on public.%I from anon',
      rel.relname
    );
    touched := touched + 1;
  end loop;
  raise notice '0176: revoked anon write privileges on % table(s)', touched;
end $$;

-- Sequences are a write capability too (nextval is how an INSERT gets an id).
revoke all on all sequences in schema public from anon;

-- Creating objects in the schema is how a grant-based fix gets undone from the outside.
revoke create on schema public from anon;
