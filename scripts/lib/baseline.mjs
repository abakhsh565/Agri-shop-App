/**
 * baseline.mjs — the parts of the schema-baseline strategy that can be tested without a database.
 *
 * THE STRATEGY (SCHEMA_STRATEGY.md)
 *   `supabase/migrations` is a patch set, not a baseline: nothing in it creates the base tables, and
 *   measured on 2026-10-01 it does not apply cleanly onto ANY real database either — 30 files with
 *   failures onto the captured production schema, 24 onto the captured staging schema, 26 onto
 *   COMPLETE_DATABASE_SETUP.sql. The old choice "replay history" is therefore not available on any
 *   environment; the only safe direction is FORWARD.
 *
 *   Every environment therefore has a frozen BASELINE: a schema-only logical dump of the schema it
 *   actually runs (captured read-only by scripts/backup-database.mjs), recorded in
 *   `supabase/baseline/<env>-baseline.json` with its sha256. New changes are new files (0178+),
 *   and each file is verified by replaying it onto the baseline in PGlite —
 *   `scripts/verify-forward-on-baseline.mjs` — before it is applied anywhere through the ledger.
 *   Production stays read-only: its baseline exists to CHECK migrations against, never to receive a
 *   replay of history.
 *
 * This module holds the decisions that must be identical in the tool and in its guard:
 *   * what makes a baseline record valid,
 *   * which replay failures are PGlite environment gaps (unverifiable here) and which are real SQL
 *     failures (must be zero),
 *   * which files a `--since/--upto` selection names.
 *
 * Pure functions only: no fs, no database, no clock. `tests/unit/schemaBaseline.test.ts` is the
 * guard; each classification was falsified by feeding it a real message from the replay logs.
 */

export const BASELINE_ENVIRONMENTS = ['production', 'staging'];

/** Where the record for an environment lives, relative to the repo root. */
export function baselineMetadataPath(environment) {
  return `supabase/baseline/${environment}-baseline.json`;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
const VERSION = /^\d{4}$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate a baseline record. Returns a list of human-readable problems; empty means valid.
 *
 * The required fields are exactly the ones the tool refuses to run without, so a record that
 * validates here cannot surprise the tool:
 *   * `artifact` — the schema-only dump; it must not point into `supabase/migrations`, because a
 *     baseline is a captured product of an environment, not a patch set.
 *   * `artifactSha256` + `artifactBytes` — the tool re-hashes before replaying, so a misplaced or
 *     edited artifact is refused instead of silently verifying the wrong schema.
 *   * `contentType === 'logical-dump'` + the exact `dataStatements` count + `dataHandling ===
 *     'skipped-on-load'` — the captured dumps DO contain real rows (measured 2026-10-01: production
 *     268 data statements, staging 1769), so the record states that plainly, the artifact must live
 *     under the gitignored `backups/`, and the verification tool never executes a data statement.
 *     The tool re-measures the count and refuses a record that does not match the artifact.
 *   * `policy.forwardOnly === true`, `policy.replayHistory === 'never'` — the decision the whole
 *     file exists to record.
 *   * `policy.migrateTarget === false` for production — production is checked against, never written.
 */
export function validateBaselineMetadata(metadata) {
  const problems = [];
  if (!isObject(metadata)) return ['the baseline record is not an object.'];

  const env = metadata.environment;
  if (typeof env !== 'string' || !BASELINE_ENVIRONMENTS.includes(env)) {
    problems.push(`environment must be one of ${BASELINE_ENVIRONMENTS.join(', ')}; got ${JSON.stringify(env)}.`);
  }
  for (const field of ['projectRef', 'serverVersion']) {
    if (typeof metadata[field] !== 'string' || !metadata[field]) {
      problems.push(`${field} must be a non-empty string.`);
    }
  }
  if (typeof metadata.capturedAt !== 'string' || Number.isNaN(Date.parse(metadata.capturedAt))) {
    problems.push('capturedAt must be an ISO-8601 timestamp.');
  }
  if (typeof metadata.artifact !== 'string' || !metadata.artifact.endsWith('.sql')) {
    problems.push('artifact must be a path to the captured .sql dump.');
  } else if (metadata.artifact.includes('supabase/migrations')) {
    problems.push('artifact must not point into supabase/migrations — a baseline is captured from an environment.');
  } else if (!metadata.artifact.startsWith('backups/')) {
    problems.push(
      'artifact must live under gitignored backups/ — it contains real rows (personal data and password hashes) and must never be committed.',
    );
  }
  if (typeof metadata.artifactSha256 !== 'string' || !SHA256_HEX.test(metadata.artifactSha256)) {
    problems.push('artifactSha256 must be 64 lowercase hex characters.');
  }
  if (!Number.isInteger(metadata.artifactBytes) || metadata.artifactBytes <= 0) {
    problems.push('artifactBytes must be a positive integer.');
  }
  if (metadata.contentType !== 'logical-dump') {
    problems.push('contentType must be "logical-dump".');
  }
  if (!Number.isInteger(metadata.dataStatements) || metadata.dataStatements < 0) {
    problems.push('dataStatements must be the exact non-negative count of data statements in the artifact.');
  }
  if (metadata.dataHandling !== 'skipped-on-load') {
    problems.push('dataHandling must be "skipped-on-load" — verification must never execute real rows.');
  }

  const ledger = metadata.ledgerOnServer;
  if (!isObject(ledger) || !Number.isInteger(ledger.count) || ledger.count < 0) {
    problems.push('ledgerOnServer.count must be a non-negative integer.');
  } else if (!(ledger.latest === null || (typeof ledger.latest === 'string' && VERSION.test(ledger.latest)))) {
    problems.push('ledgerOnServer.latest must be null or a 4-digit version.');
  }

  const structure = metadata.structure;
  if (!isObject(structure)) {
    problems.push('structure (the captured object counts) must be an object.');
  } else {
    for (const field of ['tables', 'functions', 'indexes', 'policies', 'triggers']) {
      const value = structure[field];
      if (!Number.isInteger(value) || value < 0) {
        problems.push(`structure.${field} must be a non-negative integer.`);
      }
    }
    if (!Array.isArray(structure.views) || structure.views.some((v) => typeof v !== 'string')) {
      problems.push('structure.views must be an array of view names.');
    }
  }

  const policy = metadata.policy;
  if (!isObject(policy)) {
    problems.push('policy must be an object.');
  } else {
    if (policy.forwardOnly !== true) problems.push('policy.forwardOnly must be true.');
    if (policy.replayHistory !== 'never') problems.push('policy.replayHistory must be "never".');
    if (typeof policy.migrateTarget !== 'boolean') problems.push('policy.migrateTarget must be a boolean.');
    if (env === 'production' && policy.migrateTarget !== false) {
      problems.push('production.policy.migrateTarget must be false — production is checked against, never written by this tooling.');
    }
  }
  return problems;
}

/**
 * Statements the baseline loader skips instead of executing, because they re-create the PGlite
 * scaffolding the tool itself pre-creates, or target the stubbed storage tables whose real
 * columns PGlite cannot see. A skip is explicit, counted and reported — never silent — and it
 * covers ONLY these named shapes; everything else still executes and still fails closed.
 *
 * WHY EACH SHAPE IS SKIPPED (measured 2026-11-09 against the pg_dump production baseline):
 *   * `scaffold-schema` — the dump re-creates schemas the tool pre-creates (auth, extensions,
 *     storage, cron) with plain CREATE SCHEMA, which fails "already exists" against the stub.
 *   * `scaffold-function` — the dump re-creates the four auth helper stubs (uid/role/email/jwt)
 *     with plain CREATE FUNCTION, which fails "already exists with same argument types".
 *   * `scaffold-publication` — the dump re-creates `supabase_realtime`, which the tool
 *     pre-creates; the sibling `supabase_realtime_messages_publication` is NOT skipped (it
 *     does not exist yet and loads normally).
 *   * `stub-table` — any statement whose PRIMARY TARGET is storage.buckets or storage.objects.
 *     The tool stubs those two tables with a narrow column set (the canonical backup format has
 *     no storage schema at all), so the dump's real definitions, indexes and triggers on them
 *     fail against the stub: "already exists", "multiple primary keys", and "column
 *     archived_at / is_delete_marker / is_versioned / version / lifecycle_configuration /
 *     versioning_status does not exist". Statements that merely REFERENCE the stub tables —
 *     e.g. `ALTER TABLE ONLY storage.bucket_lifecycle_states ... REFERENCES storage.buckets(id)`
 *     or an index on storage.buckets_analytics — are NOT skipped: their target is another
 *     table and they load normally against the stub's `id` column. The `\b` after the table
 *     name is load-bearing here: `storage.buckets_analytics` must not match `storage.buckets`.
 *
 * Returns the reason string, or null when the statement must be executed.
 */
const SCAFFOLD_SCHEMAS = ['auth', 'extensions', 'storage', 'cron'];
const SCAFFOLD_FUNCTIONS = ['uid', 'role', 'email', 'jwt'];
const STUB_TABLES = ['storage\\.buckets', 'storage\\.objects'];
const STUB_TABLE = `(?:${STUB_TABLES.join('|')})`;

export function baselineSkipReason(statement) {
  const text = String(statement).replace(LEADING_COMMENTS, '');
  if (new RegExp(`^create\\s+schema\\s+(?:if\\s+not\\s+exists\\s+)?"?(${SCAFFOLD_SCHEMAS.join('|')})"?\\b`, 'i').test(text)) {
    return 'scaffold-schema';
  }
  if (
    new RegExp(`^create\\s+(?:or\\s+replace\\s+)?function\\s+auth\\.(${SCAFFOLD_FUNCTIONS.join('|')})\\s*\\(`, 'i').test(text)
  ) {
    return 'scaffold-function';
  }
  // `\b` after the name: supabase_realtime_messages_publication must not match.
  if (/^create\s+publication\s+supabase_realtime\b/i.test(text)) return 'scaffold-publication';
  // NOTE: no branch for the row-wiping verb, deliberately. pg_dump never emits it
  // (0 occurrences in the measured baseline, and no pg_dump flag produces it — it is a
  // data-loading statement, not a schema-dump one), so the branch would be dead coverage;
  // and the bare word trips the production-data-policy guard (scripts/lib/baseline.mjs
  // must stay non-destructive by the scanner's text rule). The DROP branch stays: a
  // --clean dump does emit it, so that branch is live insurance. Were the row-wiping
  // verb ever to appear, it would execute against the stub — not be skipped — which is
  // the correct fail-closed default.
  const stubTarget = new RegExp(
    `^(?:create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${STUB_TABLE}\\b` +
      `|alter\\s+table\\s+(?:only\\s+)?${STUB_TABLE}\\b` +
      `|create\\s+(?:unique\\s+)?index\\s+(?:if\\s+not\\s+exists\\s+)?\\S+\\s+on\\s+(?:only\\s+)?${STUB_TABLE}\\b` +
      `|create\\s+trigger\\s+\\S+\\s+[\\s\\S]*?\\bon\\s+${STUB_TABLE}\\b` +
      `|create\\s+policy\\s+(?:"[^"]+"|\\S+)\\s+on\\s+${STUB_TABLE}\\b` +
      `|comment\\s+on\\s+(?:table|column)\\s+${STUB_TABLE}\\b` +
      `|drop\\s+table\\s+(?:if\\s+exists\\s+)?${STUB_TABLE}\\b` +
      `|drop\\s+trigger\\s+(?:if\\s+exists\\s+)?\\S+\\s+on\\s+${STUB_TABLE}\\b)`,
    'i',
  );
  if (stubTarget.test(text)) return 'stub-table';
  return null;
}

/**
 * A `CREATE EXTENSION` statement. PGlite cannot host several platform extensions
 * (pg_stat_statements, pgcrypto, supabase_vault, uuid-ossp — "extension ... is not available"),
 * so the loader tries the statement and, only on exactly that message, records it as skipped
 * rather than a failure. Any other error is a real failure. Nothing in the dump uses those
 * extensions' functions at load time (uuid_generate_v4: 0 uses; vault.*: only the extension
 * line itself; pgcrypto calls sit inside function bodies, which the dump loads with
 * check_function_bodies off), so skipping the lines loses no verification.
 */
export function isExtensionStatement(statement) {
  return /^create\s+extension\b/i.test(String(statement).replace(LEADING_COMMENTS, ''));
}

/**
 * Supabase ships schemas and extensions that PGlite cannot host (cron, storage, auth helpers) and a
 * publication that only exists on a real project. A failure caused by one of those is an ENVIRONMENT
 * GAP: the statement cannot be exercised here at all. Anything else is a SQL failure and must be
 * zero for a verification to pass — that distinction is the difference between "we could not check
 * this part" and "this part is broken", and conflating them is how an UNKNOWN becomes a false PASS.
 */
const ENV_GAP_PATTERNS = [
  /extension "[^"]+" is not available/i,
  /schema "?(cron|storage|extensions|realtime)"? does not exist/i,
  /publication "supabase_realtime" does not exist/i,
  /function "?(auth|cron)\./i,
  /relation "?(storage|auth|cron)\./i,
  /column "?storage\.[^"]+?"? does not exist/i,
];

export function classifyBaselineFailure(message) {
  return ENV_GAP_PATTERNS.some((pattern) => pattern.test(message)) ? 'env-gap' : 'sql';
}

/**
 * The dump's own convention, read by `scripts/restore-verify.mjs`: `-- @phase: functions-pre-tables`
 * marks a best-effort pass whose failures are expected BY CONSTRUCTION — a function whose return
 * type is a table's row type cannot be created before that table exists, so it is re-applied after
 * the data and that second copy is authoritative. A failure in this phase is therefore not evidence
 * that the baseline is broken, provided the same statement succeeds in the authoritative pass.
 */
export const EXPECTED_PHASE = 'functions-pre-tables';

/**
 * Map a statement's start offset to the `-- @phase:` marker that governs it. Comments are stripped
 * from statement text, so position is the only link between the two; this is the same rule
 * restore-verify applies, kept as a pure function here so both can be tested against one corpus.
 */
export function phaseReader(text) {
  const markers = [...text.matchAll(/^-- @phase: ([a-z-]+)/gm)].map((match) => ({
    offset: match.index,
    phase: match[1],
  }));
  if (!markers.length) return () => 'unspecified';
  return (offset) => {
    let phase = markers[0].phase;
    for (const marker of markers) {
      if (marker.offset <= offset) phase = marker.phase;
    }
    return phase;
  };
}

/**
 * Is this statement a row statement (`insert into …`, `copy …`)? A baseline is loaded for its
 * SCHEMA: executing the rows would put real personal data into the verification loop and make the
 * result depend on row contents, so the tool skips them and reports how many it skipped. The count
 * is also compared against the record, so the two can never drift apart silently.
 *
 * A function body containing the words `insert into` is one statement that starts with `create` —
 * the check is on the statement's own leading keyword, not on the text anywhere inside it.
 */
const LEADING_COMMENTS = /^\s*(?:(?:--[^\n]*\n)|(?:\/\*[\s\S]*?\*\/)|\s)*/;

/** The number of data statements in a list, for the record/artifact comparison. */
export function countDataStatements(statements) {
  return statements.filter(isDataStatement).length;
}

export function isDataStatement(statement) {
  return /^(insert|copy)\b/i.test(statement.replace(LEADING_COMMENTS, ''));
}

/**
 * Select files for `--since`/`--upto` from the entries `readMigrationDirectory` produced (canonical
 * 4-digit versions, so string comparison is order). Both bounds are inclusive; a bound that names no
 * file is an error, not an empty selection — an empty selection would verify nothing while exiting 0.
 */
export function selectForwardFiles(entries, { since = null, upto = null } = {}) {
  const versions = new Set(entries.map((entry) => entry.version));
  const problems = [];
  for (const [flagName, value] of [['--since', since], ['--upto', upto]]) {
    if (value !== null && !VERSION.test(value)) {
      problems.push(`${flagName} must be a 4-digit version; got ${JSON.stringify(value)}.`);
    } else if (value !== null && !versions.has(value)) {
      problems.push(`${flagName} ${value} names no file in the directory.`);
    }
  }
  if (problems.length) return { files: [], problems };
  if (since !== null && upto !== null && since > upto) {
    return { files: [], problems: [`--since ${since} is newer than --upto ${upto}; nothing can be selected.`] };
  }

  const files = entries
    .filter((entry) => (since === null || entry.version >= since) && (upto === null || entry.version <= upto))
    .sort((a, b) => a.version.localeCompare(b.version) || a.filename.localeCompare(b.filename))
    .map((entry) => entry.filename);
  return { files, problems: [] };
}

/**
 * Turn per-file replay results into the one status that is allowed to be reported. `sql > 0` is FAIL;
 * `sql === 0 && envGap > 0` is UNVERIFIABLE (real statements could not run here — never a PASS);
 * zero of both is PASS.
 *
 * `baselineSkipped` (third argument) lists baseline statements the loader deliberately did not
 * execute — scaffold re-creations, stub-table statements, unavailable extensions. A skip is not
 * a failure of any kind: it changes no status, but it is counted and reported so the gate's
 * reader can see exactly what was not exercised. A skip list that grows without a reason is
 * itself a smell; the reasons are a closed set (see baselineSkipReason).
 */
export function summarizeReplay(fileResults, baselineLoadFailures = [], baselineSkipped = []) {
  let statements = 0;
  let failedStatements = 0;
  let envGap = 0;
  let sql = 0;
  let expectedPhase = 0;
  for (const result of fileResults) {
    statements += result.statements;
    failedStatements += result.failures.length;
    for (const failure of result.failures) {
      if (failure.class === 'env-gap') envGap++;
      else if (failure.class === 'expected-phase') expectedPhase++;
      else sql++;
    }
  }
  const baselineSql = baselineLoadFailures.filter((f) => f.class === 'sql').length;
  const baselineEnvGap = baselineLoadFailures.filter((f) => f.class === 'env-gap').length;
  const baselineExpectedPhase = baselineLoadFailures.filter((f) => f.class === 'expected-phase').length;
  const baselineSkippedByReason = {};
  for (const skipped of baselineSkipped) {
    baselineSkippedByReason[skipped.reason] = (baselineSkippedByReason[skipped.reason] ?? 0) + 1;
  }
  const status =
    sql > 0 || baselineSql > 0
      ? 'FAIL'
      : envGap > 0 || baselineEnvGap > 0
        ? 'UNVERIFIABLE'
        : 'PASS';
  return {
    status,
    files: fileResults.length,
    statements,
    failedStatements,
    envGapFailures: envGap,
    sqlFailures: sql,
    expectedPhaseFailures: expectedPhase,
    baselineLoadFailures: baselineLoadFailures.length,
    baselineSqlFailures: baselineSql,
    baselineEnvGapFailures: baselineEnvGap,
    baselineExpectedPhaseFailures: baselineExpectedPhase,
    baselineSkippedStatements: baselineSkipped.length,
    baselineSkippedByReason,
  };
}
