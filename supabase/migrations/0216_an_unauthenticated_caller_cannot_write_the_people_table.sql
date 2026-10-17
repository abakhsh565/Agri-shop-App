-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- AN UNAUTHENTICATED CALLER CANNOT WRITE THE PEOPLE TABLE
--
-- MEASURED 2026-10-17 on production, read only (`device-evidence/production-acls-measured-2026-10-17.md`):
--
--   anon           INSERT, UPDATE, DELETE on public.users     ← and on audit_events,
--                                                              customer_payments, stock_adjustments
--   authenticated  INSERT, UPDATE, DELETE on public.users     ← expected; the app edits profile rows
--
-- WHY THE BATCH DOES NOT ALREADY CLOSE THIS
--   The three other tables are closed by grants or policies the batch carries: `0212` re-applies
--   `0195`'s `REVOKE INSERT, UPDATE, DELETE, TRUNCATE` on the money tables, `0213` drops the legacy
--   always-true `audit_events` policy and installs `audit_events_no_client_writes … with check (false)`.
--   `users` is named by neither, and production's grants were made **out of band** — no tracked
--   migration ever granted `anon` a write on `users`, which is why hosted QA measures `false` for all
--   three (read 2026-10-17, `has_table_privilege`) while production measures `true`. A migration cannot
--   close a privilege it never granted unless it names it, so this file names it.
--
-- WHY IT IS SAFE, AND WHY IT IS NOT MORE
--   * `anon` is a request with no session. The application performs every `users` read and write as
--     `authenticated` (`src/lib/auth.ts`, the settings screens, `stores/employeesStore.ts`); no client
--     path writes `users` before sign-in. Removing the grant therefore removes only the path that has
--     no product meaning: an anonymous request editing a person.
--   * `authenticated` KEEPS INSERT, UPDATE and DELETE. Profile editing is a direct table write in this
--     app, so narrowing that role is a product change, not a hardening — and it is not what the
--     measurement shows is wrong here. What `authenticated` may do to *which rows* is a policy
--   question (`users` is one of production's fourteen always-true policies), recorded as an open
--   risk in `docs/PRODUCTION_MIGRATION_PLAN.md` §9.9 rather than silently changed here.
--   * It is idempotent, additive-negative only (grants removed, nothing created, no row touched), and it
--     asserts both halves: `anon` holds no write privilege afterwards, and `authenticated` still holds
--     UPDATE, so a cluster where the app's own editing path depended on the removed grant fails here
--     instead of in production.
-- ─────────────────────────────────────────────────────────────────────────────────────────────

do $acl$
declare
  v_anon_before  text[];
  v_anon_after   text[];
  v_editor_before boolean;
  v_editor_after  boolean;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'users' and c.relkind = 'r'
  ) then
    raise exception '0216: public.users does not exist, so this file cannot do what it says';
  end if;

  -- What the roles held BEFORE, so the file can say what it changed instead of assuming. On a schema
  -- built without hosted's grants (both frozen baselines) `anon` holds nothing and this is empty —
  -- which is why the assertion below is "nothing afterwards", not "something was removed".
  select coalesce(array_agg(p order by p), '{}') into v_anon_before
    from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
   where has_table_privilege('anon', 'public.users', p);
  v_editor_before := has_table_privilege('authenticated', 'public.users', 'UPDATE');

  execute 'revoke insert, update, delete, truncate on public.users from anon';

  select coalesce(array_agg(p order by p), '{}') into v_anon_after
    from unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) p
   where has_table_privilege('anon', 'public.users', p);
  v_editor_after := has_table_privilege('authenticated', 'public.users', 'UPDATE');

  if array_length(v_anon_after, 1) is not null then
    raise exception '0216: anon still holds % on public.users after the revoke', array_to_string(v_anon_after, ', ');
  end if;

  -- The app edits profile rows as `authenticated`, so this file must not take that away. Compared with
  -- the BEFORE reading rather than asserting "true": a schema that holds no grants at all is a legitimate
  -- environment, and the property that matters there is "unchanged", not "granted".
  if v_editor_after is distinct from v_editor_before then
    raise exception '0216: the revoke changed authenticated''s UPDATE on public.users (% → %)',
      v_editor_before, v_editor_after;
  end if;

  raise notice '0216: anon write privileges on public.users: [%] → []; authenticated UPDATE unchanged (%)',
    array_to_string(v_anon_before, ', '), v_editor_after;
end
$acl$;
