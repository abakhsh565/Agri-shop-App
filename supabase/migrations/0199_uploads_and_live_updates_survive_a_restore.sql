-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- UPLOADS AND LIVE UPDATES SURVIVE A RESTORE
--
-- FOUND by measurement on the local stack (2026-10-12), both silent:
--
--   storage.objects — RLS ENABLED, ZERO POLICIES
--     select policyname from pg_policies where schemaname='storage'  → (none)
--     With RLS on and no policy, every write by an API role is denied. The four image buckets exist
--     and are public, so an object that is already stored still READS — which is why the failure
--     looks like "uploading is broken" rather than "Storage is unconfigured". The table itself is
--     closed, so nothing can be written into a bucket.
--
--   supabase_realtime — ZERO TABLES
--     select tablename from pg_publication_tables where pubname='supabase_realtime'  → (none)
--     Postgres emits logical-replication changes only for tables that belong to a publication, so
--     every `.on('postgres_changes')` callback in the app was dead: totals and lists changed only
--     when the screen was reloaded. This is the defect 0144 was written for, and it had come back.
--
-- WHY THEY COME BACK. This repository's decided strategy is a frozen baseline per environment plus
-- forward files, and the baseline artifact is a **`public`-schema dump**. Two kinds of fact cannot
-- survive that round trip:
--
--   * a POLICY on a table outside `public` (storage.objects), and
--   * membership in a PUBLICATION, which is a cluster-level object, not a schema object at all.
--
-- Both were correct in the migration history and absent from the restored database. So the schema
-- counts matched the record, `create_sale` was present, the app signed in and sold — and the only
-- two things that did not work were image uploads and anything that had to arrive on its own.
--
-- WHAT THIS DOES. Re-asserts both, idempotently, from the same definitions the history established:
-- the four buckets and the four `public_all_storage_*` policies exactly as 0022 defines them
-- (bucket-restricted and deliberately not owner-restricted — that boundary is the app's own, stated
-- in the same place), and the seven subscribed tables exactly as 0144 published them. Where the
-- facts are already true this migration is a no-op, so it is safe on an environment that never lost
-- them, and it is what makes a database built by RESTORING an artifact whole again.
--
-- WHY IT CHECKS PERMISSION INSTEAD OF JUST RUNNING. `storage.objects` is owned by
-- `supabase_storage_admin`, not by `postgres`, so DECLARING the policy is a question about the role
-- the file runs as. Hosted Supabase's `postgres` is the project's privileged role and is how 0022
-- created these policies; on the local Docker stack `postgres` is neither a superuser nor the owner,
-- and a plain `CREATE POLICY` there dies with `must be owner of table objects` — which would make
-- this file unreplayable on the very environment the defect was found on. So each half states what
-- it requires, does the work when it has it, and RAISES A WARNING NAMING THE ROLE when it does not.
-- The local tool grants that authority before the forward files run (scripts/dev/local-db.mjs,
-- `applyStorageOwnership`), and `verify` asserts the four policies and the seven subscriptions, so a
-- skip cannot pass for a fix.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

-- The buckets the app uploads into. `uploadImage()` builds the object path inside one of these four
-- names, so the bucket IS the contract. ON CONFLICT keeps an existing bucket's settings.
INSERT INTO storage.buckets (id, name, public) VALUES
  ('product-images',  'product-images',  true),
  ('employee-photos', 'employee-photos', true),
  ('company-logos',   'company-logos',   true),
  ('customer-images', 'customer-images', true)
ON CONFLICT (id) DO NOTHING;

-- The four policies, named as 0022 named them, each with the clause its own command uses — INSERT
-- is checked with WITH CHECK, UPDATE needs both, SELECT and DELETE take USING. Created only when
-- absent: a restored project may carry policies of its own, and re-creating an existing one would
-- either fail or silently replace a decision this file did not make.
DO $$
DECLARE
  v_owner   text;
  v_name    text;
  v_command text;
  v_clauses text;
  v_buckets text := '(''product-images'', ''employee-photos'', ''company-logos'', ''customer-images'')';
BEGIN
  IF to_regclass('storage.objects') IS NULL THEN
    -- A database with no Storage API at all (PGlite, plain Postgres, a `--schema-only` build with
    -- no platform services). There is nothing to open, and failing here would make this file
    -- unreplayable in exactly the environments that need the rest of it.
    RAISE WARNING 'storage.objects is absent — no upload policy can be created in this environment';
    RETURN;
  END IF;

  SELECT c.relowner::regrole::text INTO v_owner
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'storage' AND c.relname = 'objects';

  IF NOT (COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false)
          OR pg_has_role(current_user, v_owner, 'USAGE')) THEN
    RAISE WARNING
      'storage.objects is owned by % and % may not create policies on it — uploads stay denied. '
      'Run this restoration as the owning role (the local stack grants postgres that role first).',
      v_owner, current_user;
    RETURN;
  END IF;

  -- RLS is the reason a policy is needed; assert it rather than assume it, because a table with RLS
  -- off would hand every API role the same access the policies were written to bound.
  EXECUTE 'ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY';

  FOR v_name, v_command IN
    SELECT * FROM (VALUES
      ('public_all_storage_insert', 'INSERT'),
      ('public_all_storage_select', 'SELECT'),
      ('public_all_storage_update', 'UPDATE'),
      ('public_all_storage_delete', 'DELETE')
    ) AS t(name, command)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
       WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = v_name
    ) THEN
      v_clauses := CASE v_command
        WHEN 'INSERT' THEN format('WITH CHECK (bucket_id IN %s)', v_buckets)
        WHEN 'UPDATE' THEN format('USING (bucket_id IN %s) WITH CHECK (bucket_id IN %s)', v_buckets, v_buckets)
        ELSE               format('USING (bucket_id IN %s)', v_buckets)
      END;
      EXECUTE format('CREATE POLICY %I ON storage.objects FOR %s %s', v_name, v_command, v_clauses);
    END IF;
  END LOOP;
END $$;

-- The seven tables the app subscribes to, as 0144 published them. `CREATE PUBLICATION` and
-- `ALTER PUBLICATION` both run through EXECUTE because utility statements are not allowed inline in
-- a DO block's body, and both need authority this role may not have: creating a publication needs
-- superuser (or CREATE on the database), adding a table needs ownership of that table.
DO $$
DECLARE
  v_table   text;
  v_blocked text;
  v_tables  text[] := ARRAY[
    'products', 'product_variants', 'customers', 'sales',
    'companies', 'notifications', 'users'
  ];
BEGIN
  IF COALESCE((SELECT rolsuper FROM pg_roles WHERE rolname = current_user), false) THEN
    v_blocked := NULL;
  ELSE
    SELECT string_agg(c.relname, ', ') INTO v_blocked
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = ANY(v_tables)
       AND NOT pg_has_role(current_user, c.relowner, 'USAGE');
  END IF;

  IF v_blocked IS NOT NULL THEN
    RAISE WARNING
      '% may not publish % — those tables would stay silent to every subscriber. Run this as the '
      'role that owns them.', current_user, v_blocked;
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    EXECUTE 'CREATE PUBLICATION supabase_realtime';
  END IF;

  FOREACH v_table IN ARRAY v_tables LOOP
    IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE c.relname = v_table AND n.nspname = 'public' AND c.relkind = 'r')
      AND NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
         WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = v_table
      )
    THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END $$;

-- Realtime applies the subscriber's own RLS. A published table with RLS enabled and no policy
-- delivers nothing to anyone, which is the same silence this file exists to end — say so instead of
-- leaving it to be rediscovered from the screen.
DO $$
DECLARE
  v_gap text;
BEGIN
  SELECT string_agg(p.tablename, ', ')
    INTO v_gap
    FROM pg_publication_tables p
    JOIN pg_class c ON c.relname = p.tablename
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
   WHERE p.pubname = 'supabase_realtime'
     AND c.relrowsecurity = true
     AND NOT EXISTS (
       SELECT 1 FROM pg_policies pol
        WHERE pol.schemaname = p.schemaname AND pol.tablename = p.tablename
     );

  IF v_gap IS NOT NULL THEN
    RAISE WARNING 'published but with no RLS policy (subscribers receive nothing): %', v_gap;
  END IF;
END $$;
