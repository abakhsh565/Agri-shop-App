/**
 * Local Development database — the ordering rule, and the revokes it must not undo.
 *
 * WHY THIS GUARD EXISTS
 *   The local stack's database is built from the accepted baseline artifact, and that artifact is an
 *   ACL-free dump of the migration statements: it contains no GRANT at all. Hosted Supabase supplies
 *   object privileges itself (a table in `public` arrives with `anon`, `authenticated` and
 *   `service_role` holding `arwdDxtm`), and the migrations are written against that fact — 0195
 *   REVOKEs INSERT/UPDATE/DELETE/TRUNCATE on `sales`, `sale_items`, `purchases`, … from
 *   `authenticated` so money can only move through the atomic RPCs, then GRANTs back
 *   `UPDATE(notes)`; 0189 closes `audit_events` the same way.
 *
 *   Both failure modes are silent, which is why they need a test rather than care:
 *
 *   * no platform defaults → every PostgREST read answers 403 (the whole app is unusable, and the
 *     build and the schema counts still look perfect);
 *   * defaults applied AFTER the objects exist → 0195's and 0189's revokes have already run against
 *     privileges that did not exist yet, so they revoke nothing and the tables the schema means to
 *     close are directly writable.
 *
 *   `scripts/dev/local-db.mjs` reconciles both by applying the defaults first, and its `verify`
 *   asserts the resulting privileges at runtime against the live database. This file guards the
 *   source-level half: the order, the shape of the grant, and the revokes still being there to win.
 *   The runtime half cannot be a unit test — it needs the running local database — so it is asserted
 *   by `node scripts/dev/local-db.mjs verify`, which fails loudly with the reason.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const LOCAL_DB = fs.readFileSync(path.join(ROOT, 'scripts/dev/local-db.mjs'), 'utf8');

/** The body of `cmdInit`, which is where the ordering lives. */
const initBody = LOCAL_DB.slice(
  LOCAL_DB.indexOf('async function cmdInit()'),
  LOCAL_DB.indexOf('async function cmdSeed()'),
);

/** The `PLATFORM_DEFAULTS_SQL` template literal. */
const defaultsSql = LOCAL_DB.slice(
  LOCAL_DB.indexOf('const PLATFORM_DEFAULTS_SQL'),
  LOCAL_DB.indexOf('`;', LOCAL_DB.indexOf('const PLATFORM_DEFAULTS_SQL')),
);

describe('the local database gets hosted privileges before its objects exist', () => {
  it('has a cmdInit to inspect at all', () => {
    expect(initBody.length).toBeGreaterThan(200);
    expect(defaultsSql).toContain('alter default privileges');
  });

  it('applies the platform defaults before the baseline is restored', () => {
    const defaults = initBody.indexOf('applyPlatformDefaults()');
    const restore = initBody.indexOf("label: 'baseline restore'");
    expect(defaults).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(-1);
    expect(defaults).toBeLessThan(restore);
  });

  it('applies them before the forward files, so a newer migration can also rely on them', () => {
    const defaults = initBody.indexOf('applyPlatformDefaults()');
    const forward = initBody.indexOf('forwardFiles(since)');
    expect(forward).toBeGreaterThan(-1);
    expect(defaults).toBeLessThan(forward);
  });

  it('grants through DEFAULT privileges, never a blanket grant over existing objects', () => {
    // A blanket `grant ... on all tables` applied after the forward files is exactly how 0195 gets
    // undone. Only the default-privilege form is allowed to appear.
    expect(defaultsSql).toContain('alter default privileges in schema public');
    expect(defaultsSql).toContain('grant all on tables to anon, authenticated, service_role');
    expect(defaultsSql).toContain(
      'grant select, update, usage on sequences to anon, authenticated, service_role',
    );
    expect(defaultsSql).not.toMatch(/grant\s+all\s+on\s+all\s+tables/i);
    expect(defaultsSql).not.toMatch(/grant\s+[a-z, ]*on\s+all\s+/i);
  });

  it('fails if the default ACL did not actually take, instead of reporting success', () => {
    // The ALTER is a no-op when it runs as a role that is not the one creating the objects, so the
    // tool reads the result back rather than trusting the statement.
    expect(LOCAL_DB).toMatch(/pg_default_acl/);
    expect(LOCAL_DB).toMatch(/defaclrole = 'postgres'::regrole/);
    expect(LOCAL_DB).toMatch(/arwdDxtm/);
  });

  it('gives the migrating role the authority over storage.objects that hosted has', () => {
    // 0022 and 0199 both DECLARE a policy on storage.objects, which is owned by
    // supabase_storage_admin. Hosted's `postgres` is the project's privileged role; the local one is
    // neither superuser nor owner, so `CREATE POLICY … ON storage.objects` there fails outright
    // unless the tool grants it first — which is a step about the local stack, not about the rule.
    const ownership = initBody.indexOf('applyStorageOwnership()');
    const defaults = initBody.indexOf('applyPlatformDefaults()');
    const restore = initBody.indexOf("label: 'baseline restore'");
    const forward = initBody.indexOf('forwardFiles(since)');
    expect(ownership).toBeGreaterThan(-1);
    expect(defaults).toBeLessThan(ownership);
    expect(ownership).toBeLessThan(restore);
    expect(ownership).toBeLessThan(forward);
    expect(LOCAL_DB).toMatch(/grant supabase_storage_admin to postgres/);
    expect(LOCAL_DB).toMatch(/pg_has_role\('postgres', 'supabase_storage_admin', 'USAGE'\)/);
  });

  it('checks the resulting privileges at runtime, in both directions', () => {
    // Readable where the app needs it …
    expect(LOCAL_DB).toMatch(/has_table_privilege\('authenticated','public\.sales','SELECT'\)/);
    expect(LOCAL_DB).toMatch(/has_table_privilege\('authenticated','public\.customers','INSERT'\)/);
    expect(LOCAL_DB).toMatch(/has_column_privilege\('authenticated','public\.sales','notes','UPDATE'\)/);
    // … and still closed where the migrations insist.
    expect(LOCAL_DB).toMatch(/has_table_privilege\('authenticated','public\.sales','INSERT'\)/);
    expect(LOCAL_DB).toMatch(/has_table_privilege\('authenticated','public\.audit_events','INSERT'\)/);
  });
});

describe('the revokes the defaults must not undo are still in the forward set', () => {
  const migration = (name: string) =>
    fs.readFileSync(path.join(ROOT, 'supabase/migrations', name), 'utf8');

  it('0195 still closes the money tables to direct writes', () => {
    const sql = migration('0195_permissions_are_not_just_navigation.sql');
    expect(sql).toMatch(
      /REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON public\.sales,public\.sale_items,public\.purchases/,
    );
    expect(sql).toMatch(/FROM authenticated,anon/);
    expect(sql).toMatch(/GRANT UPDATE\(notes\) ON public\.sales TO authenticated/);
  });

  it('0189 still closes the audit trail', () => {
    const sql = migration('0189_access_changes_keep_the_person_and_history.sql');
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public\.audit_events/);
  });

  it('the forward set the local database applies includes both', () => {
    // The local default `--since` is 0188; if that ever moves past these files, the local database
    // would be built without the revokes while `verify` would still claim the tables are closed by
    // them. The selection is read from the tool so this fails rather than drifts.
    const sinceMatch = LOCAL_DB.match(/const LOCAL_DEFAULT_SINCE = '(\d{4})'/);
    expect(sinceMatch).not.toBeNull();
    expect(Number(sinceMatch![1])).toBeLessThanOrEqual(189);
  });
});

/**
 * The two facts a `public`-only artifact cannot carry, and the rule that makes restoring them safe:
 * 0199 re-asserts them from the SAME definitions the history used, not from a fresh paraphrase.
 */
describe('the objects outside `public` are restored from the definitions that established them', () => {
  const migration = (name: string) =>
    fs.readFileSync(path.join(ROOT, 'supabase/migrations', name), 'utf8');
  const restore = migration('0199_uploads_and_live_updates_survive_a_restore.sql');

  /** The names 0199 asserts, read out of it rather than restated here. */
  const policyNames = [...restore.matchAll(/'(public_all_storage_[a-z]+)'/g)].map((m) => m[1]);
  const publishedTables = [
    ...restore
      .slice(restore.indexOf('v_tables  text[] := ARRAY['), restore.indexOf('];', restore.indexOf('v_tables  text[] := ARRAY[')))
      .matchAll(/'([a-z_]+)'/g),
  ].map((m) => m[1]);

  it('restores exactly the four policies 0022 created, under those names', () => {
    const original = migration('0022_fix_all_rls_for_demo.sql');
    for (const name of new Set(policyNames)) {
      expect(original, `0022 does not define ${name}`).toContain(`CREATE POLICY "${name}" ON storage.objects`);
    }
    expect(new Set(policyNames).size).toBe(4);
  });

  it('restores exactly the seven tables 0144 published', () => {
    const published = migration('0144_enable_realtime_publication.sql');
    for (const table of publishedTables) {
      expect(published, `0144 does not publish ${table}`).toMatch(new RegExp(`'${table}'`));
    }
    expect(new Set(publishedTables).size).toBe(7);
  });

  it('creates each policy only when it is absent, so a project of its own is not overwritten', () => {
    expect(restore).toMatch(/IF NOT EXISTS \(\s*SELECT 1 FROM pg_policies/);
    expect(restore).not.toMatch(/DROP POLICY/i);
  });

  it('says what it needs instead of dying where the role cannot do it', () => {
    // A file that fails on the local stack is unreplayable exactly where the defect was found; a
    // file that skips in silence reads as a fix. It does neither: it warns with the role's name.
    expect(restore).toMatch(/RAISE WARNING/);
    expect(restore).toMatch(/may not create policies on it/);
    expect(restore).toMatch(/pg_has_role\(current_user, v_owner, 'USAGE'\)/);
  });

  it('is asserted at runtime by the tool that builds the local database', () => {
    // 0230 replaced the four demo-mode policies 0199 restores with public read + authenticated
    // upload, so the runtime check asserts that final state — and still names the write policies
    // 0199 brings back, so one of them surviving fails the check instead of passing quietly.
    expect(LOCAL_DB).toContain('images public read');
    expect(LOCAL_DB).toContain('images auth write');
    for (const name of ['public_all_storage_delete', 'public_all_storage_insert', 'public_all_storage_update']) {
      expect(LOCAL_DB).toContain(name);
    }
    for (const table of publishedTables) expect(LOCAL_DB).toMatch(new RegExp(`'${table}'`));
    expect(LOCAL_DB).toMatch(/0230/);
    expect(LOCAL_DB).toMatch(/not in the state the migrations decide/);
  });
});

/**
 * The rehearsal engine needs the same base, and for the same reason.
 *
 * `scripts/dev/rehearse-on-local-engine.mjs` creates a scratch database, loads an environment's baseline
 * and applies a selection to it. The baseline artifact carries no GRANT, so a scratch database arrives
 * with no privileges at all — and the first intent probe of the production-baseline rehearsal reported
 * `authenticated` unable to read `sales`, `products`, `customers` and `companies`. That was a statement
 * about an empty database, not about the batch, and it would have been the same false negative for every
 * future run. The rehearsal therefore installs hosted's defaults before the objects exist.
 *
 * The two literals have to stay identical: a rehearsal whose platform base drifts from the one the app is
 * built against rehearses a different schema. That is asserted here rather than left to review.
 */
describe('the rehearsal engine installs the same platform defaults, in the same order', () => {
  const REHEARSAL = fs.readFileSync(path.join(ROOT, 'scripts/dev/rehearse-on-local-engine.mjs'), 'utf8');

  /** Every `alter default privileges … ;` statement in a source file, whitespace-normalised. */
  const defaultStatements = (source: string) =>
    (source.match(/alter default privileges in schema public[\s\S]*?;/gi) ?? []).map((s) =>
      s.replace(/\s+/g, ' ').trim().toLowerCase(),
    );

  it('grants exactly what the local development database grants', () => {
    const expected = defaultStatements(defaultsSql);
    expect(expected.length).toBe(3);
    expect(defaultStatements(REHEARSAL)).toEqual(expected);
  });

  it('applies them to the SCRATCH database, before the baseline loads', () => {
    // Not the maintenance database: the first version passed the defaults to the helper that connects to
    // `postgres`, so they took effect where no object is ever created and the check below refused the run.
    // A rehearsal database is the one the baseline and the selection are written into.
    const applied = REHEARSAL.slice(
      REHEARSAL.indexOf('const PLATFORM_DEFAULTS_SQL'),
      REHEARSAL.indexOf('the platform default privileges did not take'),
    );
    expect(applied).toMatch(/'-d', DB_NAME/);

    const defaults = REHEARSAL.indexOf('PLATFORM_DEFAULTS_SQL]');
    const baseline = REHEARSAL.indexOf('applyStatements(schemaStatements)');
    expect(defaults).toBeGreaterThan(-1);
    expect(baseline).toBeGreaterThan(-1);
    expect(defaults).toBeLessThan(baseline);
  });

  it('reads the default ACL back instead of trusting the ALTER', () => {
    // The ALTER is a no-op for a role that is not the one creating the objects; a rehearsal that lost
    // its platform base silently would answer every privilege question with "denied".
    expect(REHEARSAL).toMatch(/pg_default_acl/);
    expect(REHEARSAL).toMatch(/authenticated=arwdDxtm/);
    expect(REHEARSAL).toMatch(/the platform default privileges did not take/);
  });

  it('the probe refuses a database that has no platform base, rather than blaming the batch', () => {
    const probe = fs.readFileSync(path.join(ROOT, 'scripts/dev/probe-rehearsal-intent.mjs'), 'utf8');
    expect(probe).toMatch(/pg_default_acl/);
    expect(probe).toMatch(/authenticated=arwdDxtm/);
    expect(probe).toMatch(/was created without hosted's default privileges/);
  });
});

describe('the local tool cannot reach a hosted environment', () => {
  it('never reads QA or production credentials', () => {
    expect(LOCAL_DB).not.toMatch(/QA_(DB|ANON|SERVICE|PROJECT)/);
    expect(LOCAL_DB).not.toMatch(/PROD_(DB|ANON|SERVICE|PROJECT)/);
    expect(LOCAL_DB).not.toMatch(/migrate\.mjs/);
  });

  it('refuses anything that is not a local Supabase container', () => {
    expect(LOCAL_DB).toMatch(/refuse\(`more than one local database container/);
    expect(LOCAL_DB).toMatch(/does not look like a local Supabase database container/);
  });
});
