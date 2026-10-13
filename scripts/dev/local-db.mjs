#!/usr/bin/env node
/**
 * local-db.mjs — the local Development database: created, seeded, provisioned and checked.
 *
 * WHAT THIS IS FOR
 *   Local Development runs on the Supabase CLI stack (docker): Postgres 17 + PostgREST + GoTrue +
 *   Realtime + Storage + the edge runtime. That stack gives every Supabase behaviour the app uses,
 *   with no third hosted project and nothing shared with QA or production.
 *
 * WHY THE SCHEMA IS NOT REBUILT FROM supabase/migrations
 *   The directory is a patch set, not a baseline: replaying it against an EMPTY database fails at
 *   0009 (`relation "users" does not exist`) and cascades (SCHEMA_STRATEGY.md §1). This repository's
 *   decided strategy is a frozen baseline per environment plus forward-only files, and local
 *   Development follows it:
 *
 *     0. the platform's own default privileges for `public` are reproduced (see
 *        PLATFORM_DEFAULTS_SQL — the artifact carries no GRANT at all, and without them the API
 *        roles reach nothing); then
 *     1. the accepted STAGING baseline artifact is restored into it — its public schema AND its
 *        rows (`--schema-only` skips the rows if you want a clean database); then
 *     2. the forward files that the baseline does not contain (0188 → 0197, the same selection
 *        `npm run verify:baseline -- --baseline staging --since 0188` proves PASS) are applied.
 *
 *   THE ROWS ARE LOADED ON PURPOSE, and that is not laziness. `authorize_business_action()` — the
 *   gate in front of every business RPC — requires an active `memberships` row and
 *   `has_effective_permission()`, which resolves from `permissions` / `roles` / `role_permissions`.
 *   Those are TENANT-SCOPED reference rows, not business data: they cannot be invented for a new
 *   tenant without re-deriving the whole RBAC mapping, and a local database without them answers
 *   every sale with `NOT_AUTHORIZED`. So the baseline's rows are restored as the starting state
 *   (QA's own fixture rows, per `tests/setup/fixtures.ts`).
 *
 *   WHAT THE ARTIFACT ACTUALLY CARRIES — measured, not assumed. It is a `public`-schema dump, but
 *   not only `public`: it carries `auth` rows too (13 `insert into auth.…` statements), including
 *   the fixture logins in `auth.users` and their password hashes. That is why `seed` reports
 *   "5 already valid, 0 created" even on a database created from nothing — the app's own derived
 *   password (`src/lib/auth.ts`) already matches the restored row. Earlier revisions of this
 *   comment claimed every AUTH row is created fresh by `seed`; that is false, and the difference
 *   matters, because the local database therefore holds identities that originated in QA. It stays
 *   local: the artifact lives in gitignored `backups/`, and no hosted target is reachable from this
 *   file. `seed` still provisions any login that is missing, so `--schema-only` ends up usable too.
 *
 * WHAT IT REFUSES
 *   * Anything that is not the local stack. Every step identifies the target by CONTAINER NAME and
 *     refuses unless it is a `supabase_db_*` container on this machine. No hosted URL, host or
 *     project ref is reachable from this file: it never reads QA_* or PROD_*, and it never calls
 *     `supabase link`/`db push`. Seeding or resetting QA/production from here is not a guarded
 *     option — it is an operation that does not exist.
 *   * A baseline artifact whose sha256 does not match its record (the same rule the verification
 *     tools apply), because a mismatch means the schema seeded is not the schema recorded.
 *   * A restore that leaves the authorization reference rows empty, because that database cannot
 *     authorize anything: `verify` fails and says which count is missing.
 *   * A file that fails while applying forward: `init` stops and reports the statement.
 *
 * Usage:
 *   node scripts/dev/local-db.mjs status
 *   node scripts/dev/local-db.mjs up | down
 *   node scripts/dev/local-db.mjs init    [--since 0188]
 *   node scripts/dev/local-db.mjs seed
 *   node scripts/dev/local-db.mjs verify
 *   node scripts/dev/local-db.mjs reset   [--yes]      # drop and re-create the local database
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { ROOT } from '../lib/environments.mjs';
import { isDataStatement } from '../lib/baseline.mjs';
import { splitStatementsWithOffsets } from '../lib/sql-statements.mjs';

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith('--')) ?? 'status';
const flag = (name, fallback = null) => {
  const index = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index === -1) return fallback;
  const token = args[index];
  return token.includes('=') ? token.slice(token.indexOf('=') + 1) : args[index + 1] ?? fallback;
};
const has = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

const BASELINE_RECORD = path.join(ROOT, 'supabase/baseline/staging-baseline.json');
const SEED_FILE = path.join(ROOT, 'supabase/seed.sql');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase/migrations');
const LOCAL_DEFAULT_SINCE = '0188';

/** `docker` on Windows can be a shell shim with no extension; prefer the real executable. */
const DOCKER = process.platform === 'win32' ? 'docker.exe' : 'docker';

/**
 * The hosted platform's default privileges for `public`, reproduced locally.
 *
 * WHY THIS EXISTS — the one thing the baseline artifact cannot carry
 *   The artifact is the ledger's statement set, captured without ACLs: 3,316 statements and not one
 *   GRANT. Hosted Supabase supplies object privileges itself — a table created in `public` arrives
 *   with `anon`, `authenticated` and `service_role` holding `arwdDxtm` — and the migrations are
 *   written against that fact. 0195 is the proof: it REVOKEs INSERT/UPDATE/DELETE/TRUNCATE on
 *   `sales`, `sale_items`, `purchases`, … from `authenticated` so that money can only move through
 *   the atomic RPCs, then GRANTs back `UPDATE(notes)`. A REVOKE of something nothing granted is a
 *   no-op, so a local database without the platform's defaults is not "the same schema with fewer
 *   grants": it answers every PostgREST read with 403 (the dashboard included, which is how this
 *   was found) and it leaves the tables those migrations mean to close still reachable.
 *
 * WHY IT RUNS BEFORE THE OBJECTS EXIST
 *   These are DEFAULT privileges for role `postgres`, the role this tool restores and migrates as,
 *   so they apply to every table, sequence and view created afterwards — the whole baseline and
 *   every forward file — and each migration's own REVOKE then runs later and wins. That is the
 *   order hosted has, too: the platform's defaults predate the first migration. Granting after the
 *   forward files instead would undo 0189's and 0195's revokes, so `verify` asserts both halves:
 *   readable where the app needs it, still closed where the schema insists.
 *
 *   Locally `postgres` is not a superuser and its own defaults are narrower than hosted's
 *   (`anon=Dxtm`: no SELECT/INSERT/UPDATE/DELETE), so hosted's mapping is written out here —
 *   `arwdDxtm` on tables, `rwU` on sequences, `X` on functions. This is applied to the LOCAL
 *   database only; this file can reach no other target (see WHAT IT REFUSES above).
 */
const PLATFORM_DEFAULTS_SQL = `
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant select, update, usage on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
`;

/**
 * The second thing hosted has and the artifact cannot carry: authority over the objects OUTSIDE
 * `public` that the migration history manages.
 *
 * WHY THIS EXISTS
 *   0022 created the four `public_all_storage_*` policies on `storage.objects`, and 0199 re-asserts
 *   them, because a `public`-schema dump cannot carry a policy on a table in the `storage` schema —
 *   the same reason the artifact carries no GRANT. What both files ASSUME is the authority to
 *   declare it: `storage.objects` is owned by `supabase_storage_admin`, and hosted Supabase's
 *   `postgres` is the project's privileged role, which is how those policies exist in staging and
 *   production at all.
 *
 *   On the local Docker stack `postgres` is NEITHER a superuser NOR the owner (measured:
 *   `select rolsuper … → f`, owner `supabase_storage_admin`), so `CREATE POLICY … ON
 *   storage.objects` there fails with `must be owner of table objects` — and `supabase_admin`, which
 *   can, is the only local role that holds the privilege. Granting the owning role to the local
 *   migrating role reproduces the hosted arrangement rather than special-casing the files: the
 *   forward set then runs exactly as it does on a hosted project, and 0199 needs no local branch.
 *
 *   It is a LOCAL ONLY statement. It grants a role membership inside the local container — nothing
 *   the app's API roles (`anon`, `authenticated`, `service_role`) can use, and no hosted target is
 *   reachable from this file (see WHAT IT REFUSES).
 */
const STORAGE_OWNERSHIP_SQL = `grant supabase_storage_admin to postgres;`;

/**
 * The Supabase CLI executable, resolved from the checkout rather than through `npx`.
 *
 * `npx` is a shell script (`.cmd`/shim) on Windows, and `spawnSync('npx', …)` fails with ENOENT
 * because there is no `npx.exe` to find — which is how this tool once reported "the local service
 * key is unavailable" on a stack that was running perfectly. The platform package that the
 * `supabase` npm dependency installs ships the real binary, so it is called directly.
 */
function resolveCli() {
  const base = path.join(ROOT, 'node_modules/@supabase');
  if (fs.existsSync(base)) {
    for (const dir of fs.readdirSync(base)) {
      if (!dir.startsWith('cli-')) continue;
      const binDir = path.join(base, dir, 'bin');
      if (!fs.existsSync(binDir)) continue;
      const file = fs.readdirSync(binDir).find((name) => /^supabase(\.exe)?$/.test(name));
      if (file) return path.join(binDir, file);
    }
  }
  const shim = path.join(ROOT, `node_modules/.bin/supabase${process.platform === 'win32' ? '.cmd' : ''}`);
  if (fs.existsSync(shim)) return shim;
  refuse('the Supabase CLI is not installed in this checkout — run `npm install` first.');
}

function run(bin, argv, { input, cwd = ROOT, inherit = false } = {}) {
  const result = spawnSync(bin, argv, {
    cwd,
    input,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: inherit ? 'inherit' : ['pipe', 'pipe', 'pipe'],
  });
  return {
    status: result.status ?? (result.error ? -1 : 0),
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error?.message ?? null,
  };
}

function refuse(message, code = 2) {
  console.error(`\n[LOCAL DB REFUSED] ${message}\n`);
  process.exit(code);
}

function fail(message) {
  console.error(`\n[LOCAL DB] FAIL — ${message}\n`);
  process.exit(1);
}

// ── Target identification: the local container, or nothing ──────────────────────────────────

function dbContainer() {
  const found = run(DOCKER, [
    'ps',
    '--filter',
    'name=supabase_db_',
    '--format',
    '{{.Names}}',
  ]);
  if (found.status !== 0) {
    refuse(
      `docker is not reachable (${found.stderr.trim() || found.error}). Start Docker Desktop and ` +
        `try again: this tool only ever operates on the local stack.`,
    );
  }
  const names = found.stdout.split('\n').map((n) => n.trim()).filter(Boolean);
  if (!names.length) {
    refuse(
      `no local Supabase database container is running. Start it with \`node scripts/dev/local-db.mjs up\`. ` +
        `Nothing else was touched.`,
    );
  }
  if (names.length > 1) {
    refuse(`more than one local database container is running (${names.join(', ')}); refusing to guess.`);
  }
  // The last gate: the thing we are about to write into must be a local Supabase container.
  if (!/^supabase_db_[A-Za-z0-9_\-]+$/.test(names[0])) {
    refuse(`"${names[0]}" does not look like a local Supabase database container. Refusing to write.`);
  }
  return names[0];
}

/** Run SQL in the local database. `stopOnError` decides whether psql aborts at the first failure. */
function psql(sql, { stopOnError = true, label = 'sql' } = {}) {
  const container = dbContainer();
  const result = run(
    DOCKER,
    [
      'exec', '-i', container,
      'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-q',
      '-v', stopOnError ? 'ON_ERROR_STOP=1' : 'ON_ERROR_STOP=0',
      '-f', '-',
    ],
    { input: sql },
  );
  const output = `${result.stdout}\n${result.stderr}`;
  if (stopOnError && result.status !== 0) {
    const firstError = output.split('\n').find((line) => /ERROR|FATAL/.test(line))?.trim() ?? '(no message)';
    fail(`${label} failed: ${firstError}\n  ${output.split('\n').filter((l) => /ERROR/.test(l)).slice(0, 3).join('\n  ')}`);
  }
  return output;
}

/** One scalar out of the local database. */
function scalar(sql) {
  const container = dbContainer();
  const result = run(DOCKER, [
    'exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-t', '-A', '-q', '-c', sql,
  ]);
  if (result.status !== 0) fail(`query failed: ${result.stderr.trim() || sql}`);
  return result.stdout.trim();
}

function supabaseStatusEnv() {
  const result = run(resolveCli(), ['status', '-o', 'env'], { cwd: ROOT });
  const values = {};
  for (const line of `${result.stdout}`.split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (match) values[match[1]] = match[2].replace(/"$/, '');
  }
  return values;
}

/**
 * Give the local database the object privileges a hosted project supplies by itself.
 * Runs first in `init` — see PLATFORM_DEFAULTS_SQL for why the order matters.
 */
function applyPlatformDefaults() {
  console.log('  platform defaults: public tables/sequences/functions → anon, authenticated, service_role…');
  psql(PLATFORM_DEFAULTS_SQL, { stopOnError: true, label: 'platform default privileges' });
  // Read back what the statement actually produced rather than trusting that it applied: the
  // ALTER is silently narrower if it runs as a role that is not the one creating the objects.
  const tables = scalar(
    `select coalesce(string_agg(coalesce(d.defaclacl::text, ''), ' '), '(none)')
       from pg_default_acl d
      where d.defaclrole = 'postgres'::regrole
        and d.defaclnamespace = 'public'::regnamespace
        and d.defaclobjtype = 'r'`,
  );
  for (const role of ['anon', 'authenticated', 'service_role']) {
    if (!tables.includes(`${role}=arwdDxtm`)) {
      fail(
        `the platform default privileges did not apply: \`${role}\` does not inherit the hosted ` +
          `table grants. Default ACL for postgres in public is ${tables}. Without this every ` +
          `PostgREST read is 403 and the migrations' own REVOKEs mean nothing.`,
      );
    }
  }
  console.log('    ✓ tables, sequences and views inherit the hosted privileges');
}

/**
 * Give the local migrating role the authority hosted's `postgres` has over `storage.objects`.
 * Runs beside `applyPlatformDefaults`, before the baseline and the forward files — 0199 needs it,
 * and so would any later migration that manages Storage. See STORAGE_OWNERSHIP_SQL for why.
 */
function applyStorageOwnership() {
  console.log('  storage ownership: the migrating role may manage storage.objects…');
  const container = dbContainer();
  const result = run(DOCKER, [
    'exec', '-i', container,
    'psql', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1',
    '-c', STORAGE_OWNERSHIP_SQL,
  ]);
  if (result.status !== 0) {
    fail(
      `the local stack would not grant supabase_storage_admin to postgres ` +
        `(${result.stderr.trim() || result.error}). Without it 0199 cannot create the upload ` +
        `policies, and image uploads are denied with the schema looking complete.`,
    );
  }
  // Read it back: a grant that did not take is indistinguishable from one that did, and the only
  // thing that would surface it is a failed upload later.
  if (scalar(`select pg_has_role('postgres', 'supabase_storage_admin', 'USAGE')`) !== 't') {
    fail('postgres still may not manage storage.objects; the upload policies cannot be installed.');
  }
  console.log('    ✓ postgres may create the upload policies 0022 and 0199 define');
}

// ── The baseline artifact ───────────────────────────────────────────────────────────────────

function loadBaselineRecord() {
  if (!fs.existsSync(BASELINE_RECORD)) refuse(`the baseline record is missing: ${BASELINE_RECORD}`);
  const record = JSON.parse(fs.readFileSync(BASELINE_RECORD, 'utf8'));
  const artifact = path.join(ROOT, record.artifact);
  if (!fs.existsSync(artifact)) {
    refuse(
      `the baseline artifact it names is not in the checkout: ${record.artifact}\n` +
        `  It lives in gitignored backups/ and contains real rows, so it is never committed. ` +
        `Local Development needs it once, to create the schema.`,
    );
  }
  const bytes = fs.readFileSync(artifact);
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha256 !== record.artifactSha256) {
    refuse(
      `the baseline artifact does not match its record.\n` +
        `  recorded ${record.artifactSha256}\n  on disk  ${sha256}`,
    );
  }
  const text = bytes.toString('utf8');
  const entries = splitStatementsWithOffsets(text);

  // Statements are KEPT AS WRITTEN, sliced out of the artifact by offset rather than rebuilt from
  // the splitter's output. The splitter returns statement text WITHOUT its terminating semicolon
  // and without its comments — correct for a ledger's `statements text[]`, and fatal for a replay:
  // re-joining those strings produced a file whose every statement ran into the next one
  // (`syntax error at or near "do"`), which is how this tool once "restored" a schema of zero
  // tables while reporting no errors at all. Slicing to the next statement's offset keeps the
  // terminator, the comments and the dump's own formatting exactly as captured.
  const spans = entries.map((entry, index) => ({
    text: entry.text,
    raw: text.slice(entry.offset, index + 1 < entries.length ? entries[index + 1].offset : text.length),
  }));
  const schemaSpans = spans.filter((span) => !isDataStatement(span.text));

  return {
    record,
    artifact,
    statements: entries.length,
    schemaStatements: schemaSpans.length,
    dataStatements: entries.length - schemaSpans.length,
    schemaSql: `${schemaSpans.map((span) => span.raw).join('')}\n`,
    // The whole artifact, untouched, for the full restore: it already interleaves its own phases
    // (functions-pre-tables → tables → rows → authoritative functions) in the order psql needs.
    fullSql: text,
  };
}

function forwardFiles(since) {
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort();
  const selected = files.filter((name) => name.slice(0, 4) >= since);
  if (!selected.length) refuse(`no migration file is at or after ${since}.`);
  return selected;
}

// ── Commands ────────────────────────────────────────────────────────────────────────────────

function version4(version) {
  return String(version).replace(/^0+/, '').padStart(4, '0');
}

async function cmdInit() {
  const since = version4(flag('since', LOCAL_DEFAULT_SINCE));
  const schemaOnly = has('schema-only');
  const baseline = loadBaselineRecord();

  console.log('Local database — from the frozen baseline, then forward');
  console.log(`  artifact   : ${path.relative(ROOT, baseline.artifact)}`);
  console.log(`  sha256     : ${baseline.record.artifactSha256.slice(0, 16)}… (matches the record)`);
  console.log(
    `  statements : ${baseline.statements} (${baseline.schemaStatements} schema, ` +
      `${baseline.dataStatements} rows${schemaOnly ? ' — SKIPPED by --schema-only' : ''})`,
  );
  console.log(`  baseline at: ${baseline.record.ledgerOnServer.latest} → forward files from ${since}`);
  console.log('');

  applyPlatformDefaults();
  applyStorageOwnership();
  console.log('');
  console.log(
    schemaOnly
      ? '  loading the baseline SCHEMA only (no rows are executed)…'
      : '  restoring the baseline schema and its rows…',
  );
  const loadOutput = psql(schemaOnly ? baseline.schemaSql : baseline.fullSql, {
    stopOnError: false,
    label: 'baseline restore',
  });
  // Count EVERY error line, wherever it appears. Matching only lines that start with "ERROR"
  // missed psql's own prefix (`psql:<stdin>:22008: ERROR: …`) and reported a database full of
  // syntax errors as "0 statement error(s)" — a filter that made failure invisible is worse than
  // no filter, so the pattern is anchored on the message, not on the line's beginning.
  const loadErrors = loadOutput.split('\n').filter((line) => /\b(ERROR|FATAL):/.test(line));
  console.log(`    done — ${loadErrors.length} error line(s) from the artifact replay`);
  for (const line of loadErrors.slice(0, 10)) console.log(`      ${line.trim().slice(0, 160)}`);
  if (loadErrors.length > 10) console.log(`      … and ${loadErrors.length - 10} more`);
  if (loadErrors.length) {
    console.log(
      "    (the dump's own `functions-pre-tables` pass is expected to fail where a function returns\n" +
        "     a table's row type; the authoritative pass later in the same artifact re-creates it.)",
    );
  }

  const files = forwardFiles(since);
  console.log(`\n  applying ${files.length} forward file(s), stopping at the first real failure…`);
  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    psql(`begin;\n${sql}\ncommit;\n`, { stopOnError: true, label: file });
    console.log(`    ✓ ${file}`);
  }

  await cmdVerify({ expectCatalog: !schemaOnly });
}

async function cmdSeed() {
  if (!fs.existsSync(SEED_FILE)) refuse(`no seed file at ${SEED_FILE}.`);
  console.log('Local seed — fixture rows, then local auth users');
  psql(fs.readFileSync(SEED_FILE, 'utf8'), { stopOnError: true, label: 'seed' });
  const counts = scalar(
    `select json_build_object(
       'shops', (select count(*) from shops),
       'branches', (select count(*) from branches),
       'users', (select count(*) from users),
       'customers', (select count(*) from customers),
       'products', (select count(*) from products),
       'variants', (select count(*) from product_variants))::text`,
  );
  console.log(`  rows: ${counts}`);

  const env = supabaseStatusEnv();
  const url = env.API_URL ?? '';
  const serviceRole = env.SERVICE_ROLE_KEY ?? '';
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(url)) {
    refuse(
      `refusing to provision auth users against "${url || '(no API_URL)'}": this step only ever ` +
        `writes to the local stack.`,
    );
  }
  if (!serviceRole) refuse('the local service_role key is unavailable; is the stack running? Run `up`.');

  const users = JSON.parse(
    scalar(`select coalesce(json_agg(json_build_object('id', id, 'name', name, 'phone', phone)), '[]')::text from users where phone is not null`),
  );

  const { createClient } = await import('@supabase/supabase-js');
  const admin = createClient(url, serviceRole, { auth: { persistSession: false, autoRefreshToken: false } });
  const probe = createClient(url, env.ANON_KEY ?? '', { auth: { persistSession: false, autoRefreshToken: false } });

  let created = 0;
  let repaired = 0;
  let ok = 0;

  for (const user of users) {
    // Exactly the app's own derivation (src/lib/auth.ts phoneToAuthCredentials).
    const e164 = /^0/.test(user.phone) ? `92${user.phone.slice(1)}` : user.phone.startsWith('92') ? user.phone : `92${user.phone}`;
    const email = `user-${e164}@agrishop.auth.local`;
    const password = `AgriShop-${e164}-2026!`;

    const attempt = await probe.auth.signInWithPassword({ email, password });
    if (!attempt.error) {
      await probe.auth.signOut();
      ok += 1;
      console.log(`  OK       ${user.name} (${e164})`);
      continue;
    }

    const existing = await admin.auth.admin.getUserById(user.id);
    const { error } = existing.data?.user
      ? await admin.auth.admin.updateUserById(user.id, { email, password, email_confirm: true, phone: e164 })
      : await admin.auth.admin.createUser({ id: user.id, email, password, email_confirm: true, phone: e164 });
    if (error) fail(`could not provision ${user.name} (${e164}): ${error.message}`);

    existing.data?.user ? (repaired += 1) : (created += 1);
    console.log(`  ${existing.data?.user ? 'REPAIRED' : 'CREATED '} ${user.name} (${e164})`);
  }

  console.log(`\n  auth users: ${ok} already valid, ${created} created, ${repaired} repaired`);
  console.log(`  sign in with any of the seeded phones (e.g. 923009999999) and the app's demo code.`);
}

/** The acceptance check: does the local schema actually match the baseline that was loaded? */
async function cmdVerify({ expectCatalog = false } = {}) {
  const baseline = loadBaselineRecord();
  const expected = baseline.record.structure;

  const actual = JSON.parse(
    scalar(
      `select json_build_object(
         'tables',   (select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'),
         'views',    (select count(*) from information_schema.views where table_schema='public'),
         'functions',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'),
         'indexes',  (select count(*) from pg_indexes where schemaname='public'),
         'triggers', (select count(*) from information_schema.triggers where trigger_schema='public'),
         'policies', (select count(*) from pg_policies where schemaname='public'),
         'rls_tables', (select count(*) from pg_tables where schemaname='public' and rowsecurity),
         'auth_users', (select count(*) from auth.users),
         'permissions', (select count(*) from permissions),
         'role_permissions', (select count(*) from role_permissions),
         'memberships', (select count(*) from memberships where status = 'active'),
         'business_areas', (select count(*) from business_areas),
         'rpc_create_sale', (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='create_sale'))::text`,
    ),
  );

  console.log('\n  Local schema vs the baseline record');
  const rows = [
    ['tables', expected.tables, actual.tables],
    ['functions', expected.functions, actual.functions],
    ['views', expected.views.length, actual.views],
    ['indexes', expected.indexes, actual.indexes],
    ['triggers', expected.triggers, actual.triggers],
    ['policies', expected.policies, actual.policies],
  ];
  let problems = 0;
  for (const [name, want, got] of rows) {
    const mark = got >= want ? '✓' : '✗';
    if (got < want) problems += 1;
    console.log(`    ${mark} ${name.padEnd(10)} local ${String(got).padStart(4)}   baseline ${String(want).padStart(4)}`);
  }
  console.log(`    · tables with RLS: ${actual.rls_tables}`);
  console.log(`    · public.create_sale present: ${actual.rpc_create_sale === 1 ? 'yes' : 'NO'}`);
  console.log(`    · authorization reference rows: ${actual.permissions} permissions, ${actual.role_permissions} role grants, ${actual.memberships} active membership(s), ${actual.business_areas} business area(s)`);
  console.log(`    · auth.users rows: ${actual.auth_users}`);

  // The privileges, not just the objects. A schema that is complete and unreachable is exactly what
  // a missing platform default looks like from the app — every read 403, which is how this was
  // found. Both halves are asserted: hostedly-readable tables must be readable, and the tables the
  // forward migrations deliberately closed must still be closed (a later blanket grant would show up
  // here as a widened table, not as a broken one).
  const acl = JSON.parse(
    scalar(
      `select json_build_object(
         'read_sales',        has_table_privilege('authenticated','public.sales','SELECT'),
         'read_customers',    has_table_privilege('authenticated','public.customers','SELECT'),
         'read_products',     has_table_privilege('authenticated','public.products','SELECT'),
         'write_customers',   has_table_privilege('authenticated','public.customers','INSERT'),
         'notes_sales',       has_column_privilege('authenticated','public.sales','notes','UPDATE'),
         'service_read',      has_table_privilege('service_role','public.sales','SELECT'),
         'insert_sales',      has_table_privilege('authenticated','public.sales','INSERT'),
         'update_sales',      has_table_privilege('authenticated','public.sales','UPDATE'),
         'delete_sales',      has_table_privilege('authenticated','public.sales','DELETE'),
         'insert_audit',      has_table_privilege('authenticated','public.audit_events','INSERT'))::text`,
    ),
  );

  // [what the app reads or writes directly, expected, the file that decides it]
  const privileges = [
    ['authenticated SELECT sales', acl.read_sales, true, 'the platform default'],
    ['authenticated SELECT customers', acl.read_customers, true, 'the platform default'],
    ['authenticated SELECT products', acl.read_products, true, 'the platform default'],
    ['authenticated INSERT customers', acl.write_customers, true, 'the platform default'],
    ['authenticated UPDATE sales.notes', acl.notes_sales, true, '0195'],
    ['service_role SELECT sales', acl.service_read, true, 'the platform default'],
    ['authenticated INSERT sales', acl.insert_sales, false, '0195'],
    ['authenticated UPDATE sales', acl.update_sales, false, '0195'],
    ['authenticated DELETE sales', acl.delete_sales, false, '0195'],
    ['authenticated INSERT audit_events', acl.insert_audit, false, '0189'],
  ];
  console.log('    · API-role privileges:');
  let privilegeProblems = 0;
  let missingDefaults = 0;
  for (const [what, got, want, owner] of privileges) {
    const ok = got === want;
    if (!ok) {
      privilegeProblems += 1;
      if (want) missingDefaults += 1;
    }
    console.log(
      `      ${ok ? '✓' : '✗'} ${what.padEnd(34)} ${got ? 'yes' : 'no'}` +
        (ok ? `   (${owner})` : `   — expected ${want ? 'yes' : 'no'} (${owner})`),
    );
  }

  if (actual.rpc_create_sale !== 1) fail('public.create_sale is missing — the schema did not load completely.');
  if (problems) fail(`${problems} object count(s) are below the baseline; the schema is incomplete.`);
  if (privilegeProblems) {
    fail(
      missingDefaults === privilegeProblems
        ? `the API roles cannot reach the tables they must (${privilegeProblems} privilege(s) missing). ` +
          `The hosted platform's default privileges were not applied to this database: drop it and ` +
          `load it again — \`reset --yes\`, \`up\`, \`init\` — so the objects are created after the ` +
          `defaults instead of before them.`
        : `${privilegeProblems} privilege(s) do not match what the migrations decide. A migration's ` +
          `REVOKE is not in force (or was undone by a grant applied after it), so a table the app ` +
          `must write only through an RPC is directly writable. Fix the ordering in \`init\`, do not ` +
          `relax this check.`,
    );
  }
  // The two facts a `public`-only artifact cannot carry, asserted so a missing restoration fails
  // here instead of on the screen as "uploading does nothing" and "the total did not change".
  // 0199 restores both; this asks the database whether it did.
  const platformObjects = JSON.parse(
    scalar(
      `select json_build_object(
         'storage_policies', (select coalesce(json_agg(policyname order by policyname), '[]')
                                from pg_policies where schemaname = 'storage' and tablename = 'objects'),
         'published', (select coalesce(json_agg(tablename order by tablename), '[]')
                         from pg_publication_tables where pubname = 'supabase_realtime'))::text`,
    ),
  );
  const wantPolicies = [
    'public_all_storage_delete',
    'public_all_storage_insert',
    'public_all_storage_select',
    'public_all_storage_update',
  ];
  const wantPublished = [
    'companies', 'customers', 'notifications', 'product_variants', 'products', 'sales', 'users',
  ];
  const missingPolicies = wantPolicies.filter((n) => !platformObjects.storage_policies.includes(n));
  const missingPublished = wantPublished.filter((n) => !platformObjects.published.includes(n));
  console.log('    · objects outside `public` (what the artifact cannot carry):');
  console.log(
    `      ${missingPolicies.length ? '✗' : '✓'} storage.objects policies  ` +
      `${platformObjects.storage_policies.length}  (0022 / 0199 define 4)`,
  );
  console.log(
    `      ${missingPublished.length ? '✗' : '✓'} supabase_realtime tables ` +
      `${platformObjects.published.length}  (0144 / 0199 publish 7)`,
  );
  if (missingPolicies.length || missingPublished.length) {
    fail(
      `the objects outside \`public\` are not restored` +
        (missingPolicies.length ? `; missing upload policy(ies): ${missingPolicies.join(', ')}` : '') +
        (missingPublished.length ? `; missing from supabase_realtime: ${missingPublished.join(', ')}` : '') +
        `. Image uploads are denied and every Realtime subscription delivers nothing, while the ` +
        `schema counts still match. Fix the forward set (0199) or the ownership step in \`init\` — ` +
        `do not relax this check.`,
    );
  }

  if (expectCatalog) {
    // Without these, `authorize_business_action()` answers every business RPC with NOT_AUTHORIZED:
    // the database would be complete and unable to do any work.
    const missing = [
      ['permissions', actual.permissions],
      ['role_permissions', actual.role_permissions],
      ['active memberships', actual.memberships],
    ].filter(([, count]) => count === 0).map(([name]) => name);
    if (missing.length) {
      fail(
        `the authorization reference rows are missing (${missing.join(', ')}). Every business RPC ` +
          `would answer NOT_AUTHORIZED. Load the baseline rows (drop --schema-only) or seed a tenant.`,
      );
    }
  }
  console.log('\n  VERIFY PASS — the local schema matches the frozen baseline.');
}

function cmdStatus() {
  const env = supabaseStatusEnv();
  const container = run(DOCKER, ['ps', '--filter', 'name=supabase_db_', '--format', '{{.Names}}\t{{.Status}}']);
  console.log('Local stack');
  console.log(`  database container : ${container.stdout.trim() || '(not running)'}`);
  for (const key of ['API_URL', 'GRAPHQL_URL', 'STUDIO_URL', 'DB_URL', 'INBUCKET_URL']) {
    if (env[key]) console.log(`  ${key.padEnd(19)}: ${env[key]}`);
  }
  if (!container.stdout.trim()) console.log('\n  Start it with: node scripts/dev/local-db.mjs up');
}

function cmdUp() {
  console.log('Starting the local Supabase stack (docker)…');
  const result = run(resolveCli(), ['start', '--yes'], { cwd: ROOT, inherit: true });
  if (result.status !== 0) fail('`supabase start` did not succeed; see the output above.');
  cmdStatus();
}

function cmdDown() {
  console.log('Stopping the local Supabase stack (the database volume is kept)…');
  const result = run(resolveCli(), ['stop'], { cwd: ROOT, inherit: true });
  if (result.status !== 0) fail('`supabase stop` did not succeed.');
}

function cmdReset() {
  if (!has('yes')) {
    refuse(
      'reset drops the LOCAL database volume (all local rows). Re-run with --yes. Nothing hosted is ' +
        'ever reachable from this tool, but the confirmation is still required.',
    );
  }
  console.log('Stopping and discarding the local database volume…');
  run(resolveCli(), ['stop', '--no-backup'], { cwd: ROOT, inherit: true });
  const volumes = run(DOCKER, ['volume', 'ls', '--filter', 'name=supabase_db_', '--format', '{{.Name}}']);
  const names = volumes.stdout.split('\n').map((n) => n.trim()).filter(Boolean);
  if (!names.length) console.log('  no local database volume was found (already clean).');
  for (const name of names) {
    if (!/^supabase_db_[A-Za-z0-9_\-]+$/.test(name)) refuse(`refusing to remove "${name}": not a local Supabase volume.`);
    run(DOCKER, ['volume', 'rm', '--force', name], { inherit: true });
  }
  console.log('Start again with `up`, then `init` and `seed`.');
}

switch (command) {
  case 'status':
    cmdStatus();
    break;
  case 'up':
    cmdUp();
    break;
  case 'down':
    cmdDown();
    break;
  case 'init':
    await cmdInit();
    break;
  case 'seed':
    await cmdSeed();
    break;
  case 'verify':
    await cmdVerify();
    break;
  case 'reset':
    cmdReset();
    break;
  case 'help':
  default:
    console.log(
      [
        'Usage: node scripts/dev/local-db.mjs <status|up|down|init|seed|verify|reset>',
        '',
        '  status   what the local stack is and where it listens (no writes)',
        '  up       start the local Supabase stack (docker)',
        '  down     stop it, keeping the local database volume',
        '  init     load the frozen staging baseline schema, then the forward files',
        '  seed     apply supabase/seed.sql and provision the local auth users',
        '  verify   compare the local schema and its API privileges against the baseline record',
        '  reset    discard the local database volume and start over (--yes required)',
      ].join('\n'),
    );
}
