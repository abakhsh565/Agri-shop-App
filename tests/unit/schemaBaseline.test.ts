import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { copyDataToInsert, splitStatements, splitStatementsWithOffsets } from '../../scripts/lib/sql-statements.mjs';
import {
  EXPECTED_PHASE,
  REFERENCE_DATA_ROW_CAP,
  REFERENCE_DATA_TABLES,
  baselineMetadataPath,
  baselineProvidesStorageSchema,
  baselineSkipReason,
  checkReferenceDataCap,
  classifyBaselineFailure,
  countDataStatements,
  dataStatementTarget,
  isDataStatement,
  isExtensionStatement,
  isReferenceDataStatement,
  phaseReader,
  selectForwardFiles,
  summarizeReplay,
  validateBaselineMetadata,
} from '../../scripts/lib/baseline.mjs';

/**
 * The schema strategy is a decision, and decisions decay into folklore unless they are executable.
 *
 * Measured on 2026-10-01 (PGlite; logs in the strategy report): `supabase/migrations` does NOT
 * replay cleanly onto any real environment — 30/169 files fail on the captured production schema,
 * 24/169 on the captured staging schema, 26 on COMPLETE_DATABASE_SETUP.sql, and
 * ALL_MIGRATIONS_TO_RUN.sql fails 78 statements in its own base. So "replay history" is not a
 * strategy that was rejected by preference; it is unavailable by evidence.
 *
 * The strategy that replaced it is: frozen environment baselines + forward-only files, each new
 * file verified by `scripts/verify-forward-on-baseline.mjs` before it is applied anywhere. This
 * test guards the parts of that decision a future edit could silently break:
 *
 *   * a baseline record that is missing its hash, points at a directory instead of a captured
 *     environment, or understates the data its artifact carries — each of which would let the tool
 *     verify (or execute) the wrong thing;
 *   * the classification that separates "PGlite cannot host this" from "this SQL is broken" —
 *     conflating them is how a broken migration would be reported as "unverifiable" or, worse, an
 *     unverifiable one as PASS;
 *   * the data/schema split when loading a dump: rows are counted and skipped, never executed;
 *   * a `--since` selection that silently names nothing, because a verification of nothing exits 0;
 *   * a report status that rounds "some statements could not run" up to PASS.
 *
 * Each classification case below is a real message copied from the replay logs, and the validator is
 * exercised against deliberately broken records (non-vacuous: each broken record fails for its own
 * reason, asserted by message).
 */
describe('schema baseline strategy', () => {
  const root = process.cwd();

  describe('recorded baselines', () => {
    for (const environment of ['production', 'staging'] as const) {
      it(`${environment}: the record is valid and describes its artifact exactly`, () => {
        const metaPath = path.resolve(root, baselineMetadataPath(environment));
        expect(fs.existsSync(metaPath), `${baselineMetadataPath(environment)} must exist`).toBe(true);

        const record = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        expect(validateBaselineMetadata(record)).toEqual([]);
        expect(record.environment).toBe(environment);
        expect(record.policy.forwardOnly).toBe(true);
        expect(record.policy.replayHistory).toBe('never');
        expect(record.dataHandling, 'bulk rows are skipped; only allowlisted reference rows load').toBe('skipped-on-load');
        if (environment === 'production') {
          expect(record.policy.migrateTarget, 'production is checked against, never written').toBe(false);
        }

        // The artifact itself is an environment snapshot in gitignored backups/; when it is present
        // (developer machine) the record must describe it exactly — including how much real data it
        // carries, because the tool refuses to run when those numbers disagree.
        const artifactPath = path.resolve(root, record.artifact);
        if (!fs.existsSync(artifactPath)) return;
        const text = fs.readFileSync(artifactPath, 'utf8');
        expect(Buffer.byteLength(text, 'utf8')).toBe(record.artifactBytes);
        expect(crypto.createHash('sha256').update(text).digest('hex')).toBe(record.artifactSha256);
        expect(countDataStatements(splitStatements(text))).toBe(record.dataStatements);
      });
    }

    it('the validator refuses a record that would make the tool verify the wrong schema', () => {
      const record = {
        environment: 'production',
        projectRef: 'gkswcfljxlutkfdvvqng',
        capturedAt: '2026-10-01T11:21:48.712Z',
        serverVersion: '17.6',
        artifact: 'backups/backup-production.sql',
        artifactSha256: 'a'.repeat(64),
        artifactBytes: 100,
        contentType: 'logical-dump',
        dataStatements: 3,
        dataHandling: 'skipped-on-load',
        ledgerOnServer: { count: 8, latest: '0016' },
        structure: { tables: 1, functions: 1, views: [], indexes: 1, policies: 1, triggers: 1 },
        policy: { forwardOnly: true, replayHistory: 'never', migrateTarget: false },
      };
      expect(validateBaselineMetadata(record)).toEqual([]);

      const cases: Array<[string, (r: typeof record) => void, string]> = [
        ['missing hash', (r) => (r.artifactSha256 = ''), 'artifactSha256'],
        ['hash not hex', (r) => (r.artifactSha256 = 'zz'.repeat(32)), 'artifactSha256'],
        ['artifact inside the patch set', (r) => (r.artifact = 'supabase/migrations/0177_x.sql'), 'supabase/migrations'],
        ['artifact outside gitignored backups/', (r) => (r.artifact = 'tmp/production.sql'), 'backups/'],
        ['data count invalid', (r) => (r.dataStatements = -1), 'dataStatements'],
        ['rows would be executed', (r) => (r.dataHandling = 'executed'), 'skipped-on-load'],
        ['contentType wrong', (r) => (r.contentType = 'schema-only'), 'logical-dump'],
        ['production writable', (r) => (r.policy = { ...r.policy, migrateTarget: true }), 'migrateTarget'],
        ['history replayable', (r) => (r.policy = { ...r.policy, replayHistory: 'sometimes' }), 'replayHistory'],
        ['zero bytes', (r) => (r.artifactBytes = 0), 'artifactBytes'],
      ];
      for (const [label, mutate, expected] of cases) {
        const broken = JSON.parse(JSON.stringify(record));
        mutate(broken);
        const problems = validateBaselineMetadata(broken);
        expect(problems.length, `${label} must be refused`).toBeGreaterThan(0);
        expect(problems.join(' '), `${label} must fail for its own reason`).toContain(expected);
      }
    });
  });

  describe('data statements are counted, never executed', () => {
    it('recognises row statements by their leading keyword only', () => {
      expect(isDataStatement(`insert into public.users (id) values (1)`)).toBe(true);
      expect(isDataStatement(`INSERT INTO auth.users ("id") values ('x')`)).toBe(true);
      expect(isDataStatement(`copy public.sales (id) from stdin`)).toBe(true);
      expect(isDataStatement(`-- a comment\n  insert into public.t values (1)`)).toBe(true);
      // A function body that mentions insert is one statement that starts with `create`.
      expect(
        isDataStatement(
          `create or replace function f() returns void language plpgsql as $$ begin insert into public.t values (1); end $$`,
        ),
      ).toBe(false);
      expect(isDataStatement(`do $$ begin insert into public.t select 1; end $$`)).toBe(false);
      expect(isDataStatement(`create table insert_test (id int)`)).toBe(false);
      expect(countDataStatements([`select 1`, `insert into t values (1)`, `create table x (id int)`])).toBe(1);
    });

    it('statements carry the offset that links them to the dump\'s @phase markers', () => {
      const text = `-- @phase: functions-pre-tables
-- ─── Functions ───
set check_function_bodies = off;
-- membership_in_active_shop
CREATE OR REPLACE FUNCTION public.membership_in_active_shop() RETURNS memberships AS $$ select 1 $$;

-- @phase: functions-post-data
create table public.memberships (id uuid);
`;
      const phaseAt = phaseReader(text);
      const entries = splitStatementsWithOffsets(text);
      expect(entries.map((entry) => entry.text.split('\n')[0].slice(0, 30))).toEqual([
        'set check_function_bodies = of',
        'CREATE OR REPLACE FUNCTION pub',
        'create table public.membership',
      ]);
      for (const entry of entries) {
        expect(text.slice(entry.offset, entry.offset + 10)).toBe(entry.text.slice(0, 10));
      }
      expect(phaseAt(entries[0].offset)).toBe(EXPECTED_PHASE);
      expect(phaseAt(entries[2].offset)).toBe('functions-post-data');
      // splitStatements is the same split without the offsets — one implementation, two views.
      expect(splitStatements(text)).toEqual(entries.map((entry) => entry.text));
    });
  });

  describe('failure classification', () => {
    it('PGlite environment gaps are separated from real SQL failures', () => {
      const envGaps = [
        `extension "pgcrypto" is not available`,
        `extension "pg_cron" is not available`,
        `schema cron does not exist`,
        `schema "storage" does not exist`,
        `publication "supabase_realtime" does not exist`,
        `function auth.uid() does not exist`,
        `relation "storage.buckets" does not exist`,
      ];
      const sqlFailures = [
        `relation "payments" does not exist`,
        `cannot change name of input parameter "p_payload"`,
        `cannot change return type of existing function`,
        `column "shop_id" does not exist`,
        `invalid input value for enum user_role: "co_admin"`,
        `"idx_customers_phone_unique" is a partial index`,
      ];
      for (const message of envGaps) expect(classifyBaselineFailure(message), message).toBe('env-gap');
      for (const message of sqlFailures) expect(classifyBaselineFailure(message), message).toBe('sql');
    });
  });

  describe('pg_dump baselines load (Option A)', () => {
    it('a COPY ... FROM stdin block is one data statement, rows included', () => {
      const text = [
        `COPY public.t (id, note, payload) FROM stdin;`,
        `1\tfirst; with semicolon\t{"a": "it's", "b": "$$"}`,
        `2\tback\\slash\tplain`,
        `\\.`,
        `CREATE TABLE public.u (id int);`,
        ``,
      ].join('\n');
      const statements = splitStatements(text);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain('COPY public.t');
      expect(statements[0]).toContain(`first; with semicolon`);
      expect(statements[0]).toContain('\\.'); // the terminator belongs to the unit
      expect(statements[1]).toBe('CREATE TABLE public.u (id int)');
      expect(isDataStatement(statements[0])).toBe(true);
      expect(countDataStatements(statements)).toBe(1);
    });

    it('an escaped backslash-dot data line does not end a COPY block', () => {
      const text = [
        `COPY public.t (id, note) FROM stdin;`,
        `1\t\\\\. not the terminator`,
        `2\tstill data`,
        `\\.`,
        `SELECT 1;`,
        ``,
      ].join('\n');
      const statements = splitStatements(text);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain('still data');
      expect(statements[1]).toBe('SELECT 1');
    });

    it('an empty COPY block and COPY forms without stdin split normally', () => {
      const text = [
        `COPY public.empty (id) FROM stdin;`,
        `\\.`,
        `COPY public.t (id) TO stdout;`,
        `COPY public.u (id) FROM PROGRAM 'cat';`,
        `SELECT 1;`,
        ``,
      ].join('\n');
      const statements = splitStatements(text);
      // Each COPY form is its own statement — the stdin block did not swallow the rest.
      expect(statements).toHaveLength(4);
      expect(statements[1]).toBe('COPY public.t (id) TO stdout');
      expect(statements[2]).toBe(`COPY public.u (id) FROM PROGRAM 'cat'`);
      expect(statements[3]).toBe('SELECT 1');
      expect(isDataStatement(statements[0])).toBe(true);
      // The pre-existing leading-keyword rule counts every `copy`-led statement as data;
      // the split above is what this fix owns, the classification is unchanged.
      expect(countDataStatements(statements)).toBe(3);
    });

    it('COPY inside a dollar-quoted body does not start a data block', () => {
      const statements = splitStatements(`
        CREATE FUNCTION f() RETURNS void AS $$
        BEGIN
          COPY public.t FROM stdin;
          RAISE NOTICE 'done';
        END;
        $$ LANGUAGE plpgsql;
        SELECT 1;
      `);
      expect(statements).toHaveLength(2);
      expect(statements[0]).toContain('COPY public.t FROM stdin;');
      expect(statements[1]).toBe('SELECT 1');
    });

    it('psql meta-command lines are dropped between statements, kept inside one', () => {
      const statements = splitStatements(
        `\\restrict abc123\n\nSET statement_timeout = 0;\nSELECT 1;\n\\unrestrict abc123\n`,
      );
      expect(statements).toEqual(['SET statement_timeout = 0', 'SELECT 1']);
      // A backslash inside an accumulated statement is left alone: the statement still
      // reaches the database and fails there, instead of being silently repaired.
      const kept = splitStatements(`SELECT 1 \\restrict 2;`);
      expect(kept).toHaveLength(1);
      expect(kept[0]).toContain('\\restrict');
    });

    it('scaffold re-creations are skipped, and only those', () => {
      const skipped: Array<[string, string]> = [
        ['CREATE SCHEMA auth', 'scaffold-schema'],
        ['CREATE SCHEMA IF NOT EXISTS storage', 'scaffold-schema'],
        ['CREATE SCHEMA "cron"', 'scaffold-schema'],
        ['CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ select 1 $$', 'scaffold-function'],
        ['CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql AS $$ select 1 $$', 'scaffold-function'],
        ['CREATE PUBLICATION supabase_realtime', 'scaffold-publication'],
        ['CREATE TABLE storage.buckets (id text primary key)', 'stub-table'],
        ['ALTER TABLE ONLY storage.buckets ADD CONSTRAINT buckets_pkey PRIMARY KEY (id)', 'stub-table'],
        ['CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name)', 'stub-table'],
        [
          'CREATE INDEX idx_objects_current_version ON storage.objects USING btree (bucket_id, name) WHERE (archived_at IS NULL)',
          'stub-table',
        ],
        [
          'CREATE TRIGGER wake_lifecycle AFTER UPDATE OF versioning_status ON storage.buckets FOR EACH ROW WHEN ((new.lifecycle_configuration IS NOT NULL)) EXECUTE FUNCTION storage.wake_lifecycle_state()',
          'stub-table',
        ],
        ['CREATE POLICY "images auth write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (true)', 'stub-table'],
        ['ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY', 'stub-table'],
      ];
      for (const [statement, reason] of skipped) {
        expect(baselineSkipReason(statement), statement).toBe(reason);
      }
      // Negative cases: these must EXECUTE, not be skipped. Each is a real statement whose
      // failure would be a genuine defect — widening the skip would mask it, and this test
      // is the tripwire.
      const executed = [
        'CREATE SCHEMA graphql',
        'CREATE FUNCTION auth.custom_claims() RETURNS jsonb LANGUAGE sql AS $$ select 1 $$',
        'CREATE PUBLICATION supabase_realtime_messages_publication WITH (publish = \'insert\')',
        'CREATE TABLE storage.buckets_analytics (id uuid)',
        'CREATE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name)',
        'ALTER TABLE ONLY storage.bucket_lifecycle_states ADD CONSTRAINT bucket_lifecycle_states_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id) ON DELETE CASCADE',
        'ALTER TABLE ONLY public.products ADD CONSTRAINT products_bucket_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id)',
        'CREATE TABLE public.broken (id int PRIMARY KEY, id int)',
        'SELECT * FROM public.payments',
        // Deliberate boundary: pg_dump never emits TRUNCATE, so there is no skip branch
        // for it — a TRUNCATE executes (fail-closed default), it is never silently skipped.
        'TRUNCATE storage.buckets',
      ];
      for (const statement of executed) {
        expect(baselineSkipReason(statement), statement).toBeNull();
      }
    });

    it('CREATE EXTENSION is recognised, and only that shape', () => {
      expect(isExtensionStatement(`CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions`)).toBe(true);
      expect(isExtensionStatement(`CREATE EXTENSION "uuid-ossp" WITH SCHEMA extensions`)).toBe(true);
      expect(isExtensionStatement(`CREATE TABLE public.t (id int)`)).toBe(false);
      expect(isExtensionStatement(`-- comment\nCREATE EXTENSION pg_stat_statements`)).toBe(true);
    });

    it('skipped baseline statements change no status, but are counted', () => {
      const clean = [{ filename: '0303_x.sql', statements: 2, failures: [] }];
      const withSkips = summarizeReplay(clean, [], [
        { reason: 'scaffold-schema', statement: 'CREATE SCHEMA auth' },
        { reason: 'stub-table', statement: 'CREATE TABLE storage.buckets' },
        { reason: 'extension-unavailable', statement: 'CREATE EXTENSION pgcrypto' },
      ]);
      expect(withSkips.status).toBe('PASS');
      expect(withSkips.baselineSkippedStatements).toBe(3);
      expect(withSkips.baselineSkippedByReason).toEqual({
        'scaffold-schema': 1,
        'stub-table': 1,
        'extension-unavailable': 1,
      });
      // Skips never rescue a real failure.
      const broken = [
        {
          filename: '0303_x.sql',
          statements: 2,
          failures: [{ class: 'sql', message: `relation "payments" does not exist` }],
        },
      ];
      expect(summarizeReplay(broken, [], [{ reason: 'stub-table', statement: 'x' }]).status).toBe('FAIL');
    });
  });

  describe('selection and status', () => {
    const entries = ['0175', '0176', '0177'].map((version) => ({
      version,
      filename: `${version}_x.sql`,
    }));

    it('a selection that names nothing is an error, never an empty pass', () => {
      expect(selectForwardFiles(entries, { since: '0178' }).problems.length).toBeGreaterThan(0);
      expect(selectForwardFiles(entries, { since: '76' }).problems.length).toBeGreaterThan(0);
      expect(selectForwardFiles(entries, { since: '0177', upto: '0176' }).problems.length).toBeGreaterThan(0);
      expect(selectForwardFiles(entries, { since: '0176' }).files).toEqual(['0176_x.sql', '0177_x.sql']);
      expect(selectForwardFiles(entries, { since: '0176', upto: '0176' }).files).toEqual(['0176_x.sql']);
    });

    it('only zero failures of every kind is PASS', () => {
      const clean = [{ filename: '0176_x.sql', statements: 2, failures: [] }];
      expect(summarizeReplay(clean, []).status).toBe('PASS');

      const gap = [
        {
          filename: '0176_x.sql',
          statements: 2,
          failures: [{ class: 'env-gap', message: `schema cron does not exist` }],
        },
      ];
      expect(summarizeReplay(gap, []).status).toBe('UNVERIFIABLE');

      const broken = [
        {
          filename: '0176_x.sql',
          statements: 2,
          failures: [{ class: 'sql', message: `relation "payments" does not exist` }],
        },
      ];
      expect(summarizeReplay(broken, []).status).toBe('FAIL');

      // A baseline that itself fails to load with SQL errors can never yield a PASS downstream.
      expect(summarizeReplay(clean, [{ class: 'sql', message: 'x y z' }]).status).toBe('FAIL');
      expect(summarizeReplay(clean, [{ class: 'env-gap', message: 'x y z' }]).status).toBe('UNVERIFIABLE');

      // A failure in the dump's best-effort pre-table pass is expected by construction: the same
      // statement is re-applied after the data, and a genuine defect would surface there as `sql`.
      const expected = [
        {
          filename: '0176_x.sql',
          statements: 2,
          failures: [{ class: 'expected-phase', message: `type "memberships" does not exist` }],
        },
      ];
      const expectedSummary = summarizeReplay(expected, [{ class: 'expected-phase', message: 'x y z' }]);
      expect(expectedSummary.status).toBe('PASS');
      expect(expectedSummary.expectedPhaseFailures + expectedSummary.baselineExpectedPhaseFailures).toBe(2);
      expect(expectedSummary.sqlFailures).toBe(0);
    });
  });

  describe('reference data for FK validation (Option B)', () => {
    /**
     * Batch 1 (0233-0276) failed verify:baseline on 7 statements, all PGlite artifacts:
     * 0250/0261 INSERT into storage.buckets (the tool's stub lacks file_size_limit) and
     * 0265/0266 INSERTs whose foreign keys point at public.permissions(code) — a table the
     * loader left empty because it skipped every data statement. The fix loads exactly the
     * reference rows the FKs point at (bounded, reported), and uses the dump's own storage
     * schema when the baseline provides it. These tests pin that decision: each case is a
     * real shape from the pg_dump production baseline (permissions COPY block, buckets COPY
     * block) or a boundary the fix must not cross (personal-data tables stay unloaded).
     */
    it('converts a permissions COPY block to one INSERT, NULLs and quotes exact', () => {
      const block = [
        `COPY public.permissions (id, code, module, action, label_en, label_ur, created_at) FROM stdin;`,
        `4d02a069-fd6e-41d8-ac8e-e00618dbcd48\tcustomers.view\tcustomers\tview\tView Customers\tصارفین دیکھیں\t2026-10-17 15:00:49.425821+00`,
        `736c2960-d6c4-4f43-a9c8-a323f9bd10f0\tcustomers.create\tcustomers\tcreate\tCreate Customers\tصارفین بنائیں\t2026-10-17 15:00:49.425821+00`,
        `a72ca83e-57af-4ad8-a805-95f6190f3b1d\tcustomers.edit\tcustomers\tedit\tIt's fine\tصارفین میں ترمیم کریں\t2026-10-17 15:00:49.425821+00`,
        `\\.`,
        ``,
      ].join('\n');
      const converted = copyDataToInsert(block);
      expect(converted).not.toBeNull();
      expect(converted!.table).toBe('public.permissions');
      expect(converted!.columns).toEqual(['id', 'code', 'module', 'action', 'label_en', 'label_ur', 'created_at']);
      expect(converted!.rows).toHaveLength(3);
      expect(converted!.rows[0][1]).toBe('customers.view');
      expect(converted!.rows[0][5]).toBe('صارفین دیکھیں');
      expect(converted!.insert).toContain('INSERT INTO "public"."permissions"');
      expect(converted!.insert).toContain(`'customers.view'`);
      expect(converted!.insert).toContain(`'صارفین دیکھیں'`);
      // A single quote inside a value is doubled, never dropped or backslashed.
      expect(converted!.insert).toContain(`'It''s fine'`);
      expect(converted!.insert).not.toContain(`It\\'s`);
      expect(converted!.insert).toContain('2026-10-17 15:00:49.425821+00');
    });

    it('converts a buckets COPY block: \\N becomes NULL, enums and booleans stay literal', () => {
      const block = [
        `COPY storage.buckets (id, name, owner, created_at, updated_at, public, avif_autodetection, file_size_limit, allowed_mime_types, owner_id, type, versioning_status, lifecycle_configuration, lifecycle_configuration_generation) FROM stdin;`,
        `product-images\tproduct-images\t\\N\t2026-08-24 21:37:09.170551+00\t2026-08-24 21:37:09.170551+00\tt\tf\t\\N\t\\N\t\\N\tSTANDARD\tDISABLED\t\\N\t\\N`,
        `\\.`,
        ``,
      ].join('\n');
      const converted = copyDataToInsert(block);
      expect(converted).not.toBeNull();
      expect(converted!.table).toBe('storage.buckets');
      expect(converted!.rows).toHaveLength(1);
      expect(converted!.rows[0][2]).toBeNull(); // owner \N
      expect(converted!.rows[0][7]).toBeNull(); // file_size_limit \N
      expect(converted!.rows[0][8]).toBeNull(); // allowed_mime_types \N
      expect(converted!.rows[0][10]).toBe('STANDARD');
      expect(converted!.rows[0][11]).toBe('DISABLED');
      expect(converted!.insert).toContain('INSERT INTO "storage"."buckets"');
      expect(converted!.insert).toContain(`'product-images'`);
      expect(converted!.insert).toContain('NULL');
      expect(converted!.insert).not.toContain(`\\N`);
    });

    it('COPY escapes round-trip: backslash, tab and newline inside values', () => {
      const block = [
        `COPY public.t (id, note) FROM stdin;`,
        `1\tback\\slash`,
        `2\ta\\tb`,
        `3\tline\\nbreak`,
        `4\t\\\\. not the terminator`,
        `\\.`,
        `SELECT 1;`,
        ``,
      ].join('\n');
      const statements = splitStatements(block);
      expect(statements).toHaveLength(2); // the COPY block did not swallow SELECT 1
      const converted = copyDataToInsert(statements[0]);
      expect(converted).not.toBeNull();
      expect(converted!.rows).toHaveLength(4);
      expect(converted!.rows[0][1]).toBe('back\\slash');
      expect(converted!.rows[1][1]).toBe('a\tb');
      expect(converted!.rows[2][1]).toBe('line\nbreak');
      expect(converted!.rows[3][1]).toBe('\\. not the terminator');
    });

    it('an empty COPY block converts to no INSERT, and non-COPY input is not converted', () => {
      const empty = [`COPY public.permissions (id, code) FROM stdin;`, `\\.`, ``].join('\n');
      const converted = copyDataToInsert(empty);
      expect(converted).not.toBeNull();
      expect(converted!.rows).toHaveLength(0);
      expect(converted!.insert).toBeNull();
      expect(copyDataToInsert(`COPY public.t (id) TO stdout;`)).toBeNull();
      expect(copyDataToInsert(`INSERT INTO public.permissions (id) VALUES (1)`)).toBeNull();
      expect(copyDataToInsert(`SELECT 1`)).toBeNull();
    });

    it('a malformed COPY block for a reference table throws instead of silently loading partial data', () => {
      // Wrong arity: 2 values for 3 columns — the loader must refuse, never guess.
      const bad = [
        `COPY public.permissions (id, code, module) FROM stdin;`,
        `only-two\tfields`,
        `\\.`,
        ``,
      ].join('\n');
      expect(() => copyDataToInsert(bad)).toThrow(/permissions/);
      // Unterminated block: no `\.` line at all.
      const unterminated = [
        `COPY public.permissions (id, code) FROM stdin;`,
        `1\tx`,
        ``,
      ].join('\n');
      expect(() => copyDataToInsert(unterminated)).toThrow(/terminator/);
    });

    it('reference data is recognised by target table only, never by shape alone', () => {
      expect(isReferenceDataStatement(`COPY public.permissions (id, code) FROM stdin;`)).toBe(true);
      expect(isReferenceDataStatement(`INSERT INTO public.permissions (id, code) VALUES ('x', 'y')`)).toBe(true);
      expect(isReferenceDataStatement(`INSERT INTO "public"."permissions" (id) VALUES (1)`)).toBe(true);
      expect(isReferenceDataStatement(`COPY storage.buckets (id, name) FROM stdin;`)).toBe(true);
      // Personal-data and operational tables are never reference data, whatever the shape.
      expect(isReferenceDataStatement(`COPY public.customers (id, name) FROM stdin;`)).toBe(false);
      expect(isReferenceDataStatement(`COPY public.sales (id) FROM stdin;`)).toBe(false);
      expect(isReferenceDataStatement(`COPY storage.objects (id, bucket_id) FROM stdin;`)).toBe(false);
      expect(isReferenceDataStatement(`COPY auth.users (id) FROM stdin;`)).toBe(false);
      expect(isReferenceDataStatement(`SELECT * FROM public.permissions`)).toBe(false);
      expect(dataStatementTarget(`COPY public.permissions (id) FROM stdin;`)).toBe('public.permissions');
      expect(dataStatementTarget(`INSERT INTO permissions (id) VALUES (1)`)).toBe('public.permissions');
      expect(dataStatementTarget(`INSERT INTO "public"."permissions" (id) VALUES (1)`)).toBe('public.permissions');
      expect(dataStatementTarget(`SELECT 1`)).toBeNull();
      expect(dataStatementTarget(`CREATE TABLE public.permissions (id uuid)`)).toBeNull();
    });

    it('the reference-data allowlist is exactly the two lookup tables, with a bounded cap', () => {
      expect([...REFERENCE_DATA_TABLES].sort()).toEqual(['public.permissions', 'storage.buckets']);
      expect(REFERENCE_DATA_ROW_CAP).toBe(1000);
      expect(checkReferenceDataCap({ 'public.permissions': 32, 'storage.buckets': 4 })).toEqual([]);
      expect(checkReferenceDataCap({ 'public.permissions': 1000 })).toEqual([]);
      const over = checkReferenceDataCap({ 'public.permissions': 1001 });
      expect(over.length).toBeGreaterThan(0);
      expect(over.join(' ')).toContain('public.permissions');
      expect(over.join(' ')).toContain('1001');
    });

    it('the baseline provides its storage schema only when the dump defines both tables', () => {
      const both = [
        `CREATE TABLE storage.buckets (id text NOT NULL, file_size_limit bigint);`,
        `CREATE TABLE storage.objects (id uuid, bucket_id text);`,
        ``,
      ].join('\n');
      expect(baselineProvidesStorageSchema(both)).toBe(true);
      const bucketsOnly = `CREATE TABLE storage.buckets (id text NOT NULL);`;
      expect(baselineProvidesStorageSchema(bucketsOnly)).toBe(false);
      const neither = `CREATE TABLE public.permissions (id uuid, code text);`;
      expect(baselineProvidesStorageSchema(neither)).toBe(false);
      // The old backup-database.mjs format has no storage schema at all.
      expect(baselineProvidesStorageSchema(`create table if not exists public.shops (id uuid);`)).toBe(false);
    });

    it('when the baseline provides the storage schema, its statements execute instead of being skipped', () => {
      const withSchema = { storageSchemaInBaseline: true };
      expect(baselineSkipReason('CREATE TABLE storage.buckets (id text primary key)', withSchema)).toBeNull();
      expect(
        baselineSkipReason(
          'ALTER TABLE ONLY storage.buckets ADD CONSTRAINT buckets_pkey PRIMARY KEY (id)',
          withSchema,
        ),
      ).toBeNull();
      expect(
        baselineSkipReason('CREATE POLICY "images auth write" ON storage.objects FOR INSERT TO authenticated WITH CHECK (true)', withSchema),
      ).toBeNull();
      // The other scaffold skips are untouched by this flag.
      expect(baselineSkipReason('CREATE SCHEMA auth', withSchema)).toBe('scaffold-schema');
      expect(baselineSkipReason('CREATE PUBLICATION supabase_realtime', withSchema)).toBe('scaffold-publication');
      // And the default (no flag) is exactly today's behaviour: stub tables are skipped.
      expect(baselineSkipReason('CREATE TABLE storage.buckets (id text primary key)')).toBe('stub-table');
    });
  });
});
