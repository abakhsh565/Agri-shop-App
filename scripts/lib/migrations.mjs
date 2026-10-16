/**
 * migrations.mjs — read `supabase/migrations/` and compare it with a target database's ledger.
 *
 * WHY THIS EXISTS
 *   `supabase_migrations/schema_migrations` held three rows while the directory held 167 files:
 *   every deploy went through `run_sql` by hand, so the database could not tell anyone what had
 *   been applied to it. Two files also broke the sequence's naming grammar
 *   (`0042b_security_rls_fix.sql` and `20260903_credit_limit_requests__reminder_groups.sql`), and
 *   the latter sorted after the newest migration, so a naive replay applied it last.
 *   `scripts/migrate.mjs` is the runner that fixes both: it records every file it applies, and it
 *   refuses to run at all while the directory breaks its own grammar. This module is the part of
 *   that runner that is pure logic — no database, no process — so `tests/unit/migrationLedger.test.ts`
 *   can hold it to fixtures instead of to whatever a live database happens to contain today.
 *
 * THE GRAMMAR (enforced, not assumed)
 *   `<4 digits>_<lower_snake_name>.sql`
 *   Four zero-padded digits make lexicographic filename order equal version order, which is the
 *   only reason a directory listing can be applied in order at all. A suffixed version (`0042b`)
 *   or a timestamp version (`20260903`) breaks that equality — and `supabase db push` keys the
 *   ledger by version alone, so a duplicate version is a hard failure, not a style issue.
 *
 * ALIASES
 *   `LEGACY_VERSION_ALIASES` records the two retired names. A database that recorded `0042b` or
 *   `20260903` (an old preview branch, say) is not "one file behind": its ledger row is satisfied
 *   by the canonical file the body was merged into. The comparison reports that as `reconciled`,
 *   never as a mismatch, and the unit test proves both directions of that mapping.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { ROOT } from './environments.mjs';
import { normalizeSql } from './sql-statements.mjs';

export const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

/** Retired non-canonical versions and the canonical file that now carries their body. */
export const LEGACY_VERSION_ALIASES = Object.freeze({
  '0042b': '0042',
  '20260903': '0060',
});

/** The canonical filename grammar. The name may not be empty and may not start with a digit. */
const CANONICAL_FILENAME = /^(\d{4})_([a-z][a-z0-9]*(?:_+[a-z0-9]+)*)\.sql$/;

const ORDER_SAFE_VERSION = /^\d{4}$/;

export function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

/**
 * Parse a filename into { version, name, canonical }.
 * A non-canonical name still yields a best-effort version/name so reporting can name it.
 */
export function parseMigrationFilename(filename) {
  const canonical = filename.match(CANONICAL_FILENAME);
  if (canonical) return { version: canonical[1], name: canonical[2], canonical: true };

  const base = filename.replace(/\.sql$/, '');
  const underscore = base.indexOf('_');
  return {
    version: underscore === -1 ? base : base.slice(0, underscore),
    name: underscore === -1 ? '' : base.slice(underscore + 1),
    canonical: false,
  };
}

/**
 * Read and hash every migration file, in canonical application order, collecting every grammar
 * problem found. Problems are returned rather than thrown, so `status` can show a broken directory
 * instead of dying on it, and `verify` can fail with the whole list at once.
 *
 * Alias checks describe THIS repository's history, so they apply when the directory being read is
 * this repository's own (or when a caller asks for them explicitly, which is how the unit test
 * exercises them). A scratch corpus or another project's directory is not expected to contain
 * version 0042 or 0060, and "alias target missing" there would be noise that stops the tool from
 * being usable at all.
 */
export function readMigrationDirectory(dir = MIGRATIONS_DIR, options = {}) {
  const enforceAliases =
    options.enforceAliases ?? path.resolve(dir) === path.resolve(MIGRATIONS_DIR);
  if (!fs.existsSync(dir)) {
    return { dir, entries: [], problems: [{ kind: 'missing_directory', detail: `${dir} does not exist` }] };
  }

  const entries = fs
    .readdirSync(dir)
    .filter((filename) => filename.endsWith('.sql'))
    .map((filename) => {
      const body = fs.readFileSync(path.join(dir, filename), 'utf8');
      const parsed = parseMigrationFilename(filename);
      return {
        filename,
        version: parsed.version,
        name: parsed.name,
        canonical: parsed.canonical,
        bytes: Buffer.byteLength(body, 'utf8'),
        sha256: sha256(body),
        body,
      };
    });

  const problems = [];

  for (const entry of entries.filter((e) => !e.canonical)) {
    problems.push({
      kind: 'non_canonical_name',
      detail:
        `${entry.filename} is not "<4 digits>_<lower_snake_name>.sql". Its version parses as ` +
        `"${entry.version}", which cannot be ordered, compared or recorded as a version.`,
    });
  }

  const byVersion = new Map();
  for (const entry of entries) {
    if (!byVersion.has(entry.version)) byVersion.set(entry.version, []);
    byVersion.get(entry.version).push(entry.filename);
  }
  for (const [version, filenames] of [...byVersion.entries()].sort()) {
    if (filenames.length > 1) {
      problems.push({
        kind: 'duplicate_version',
        detail: `version ${version} is claimed by ${filenames.sort().join(', ')}`,
      });
    }
  }

  const byFilename = entries.map((e) => e.filename).sort();
  const byVersionOrder = [...entries]
    .sort((a, b) => a.version.localeCompare(b.version) || a.filename.localeCompare(b.filename))
    .map((e) => e.filename);
  if (JSON.stringify(byFilename) !== JSON.stringify(byVersionOrder)) {
    const firstDivergence = byFilename.findIndex((f, i) => f !== byVersionOrder[i]);
    problems.push({
      kind: 'order_conflict',
      detail:
        `listing the directory and applying it in version order disagree from index ${firstDivergence}: ` +
        `listing gives ${byFilename[firstDivergence]}, version order gives ${byVersionOrder[firstDivergence]}`,
    });
  }

  for (const [alias, target] of Object.entries(enforceAliases ? LEGACY_VERSION_ALIASES : {})) {
    if (byVersion.has(alias)) {
      problems.push({
        kind: 'retired_version_present',
        detail: `version ${alias} is retired (merged into ${target}) but a file still carries it`,
      });
    }
    if (!byVersion.has(target)) {
      problems.push({
        kind: 'alias_target_missing',
        detail: `alias ${alias} points at version ${target}, which no file carries`,
      });
    }
  }

  const sorted = [...entries].sort(
    (a, b) => a.version.localeCompare(b.version) || a.filename.localeCompare(b.filename),
  );

  return { dir, entries: sorted, problems };
}

/**
 * Compare the directory with a target ledger and classify every difference.
 *
 * @param {{entries: Array}} directory  result of readMigrationDirectory
 * @param {Array<{version: string, name?: string, sha256?: string|null, source?: string|null}>} ledgerRows
 * @returns {{pending: Array, ledgerOnly: Array, changed: Array, reconciled: Array}}
 *   pending    files with no ledger row          — the database is behind the directory
 *   ledgerOnly rows with no file                 — the database is ahead, or a file was deleted
 *   changed    recorded sha256 differs           — a file was edited after it was applied
 *   reconciled a retired version satisfied by its canonical target
 */
export function compareWithLedger(directory, ledgerRows) {
  const fileByVersion = new Map(directory.entries.map((entry) => [entry.version, entry]));
  const rowByVersion = new Map(ledgerRows.map((row) => [String(row.version), row]));

  const pending = [];
  const ledgerOnly = [];
  const changed = [];
  const reconciled = [];

  for (const entry of directory.entries) {
    const row = rowByVersion.get(entry.version);
    if (!row) {
      pending.push(entry);
      continue;
    }
    if (row.sha256 && row.sha256 !== entry.sha256) {
      changed.push({
        version: entry.version,
        filename: entry.filename,
        recorded: row.sha256,
        current: entry.sha256,
        source: row.source ?? null,
      });
    }
  }

  for (const row of ledgerRows) {
    const version = String(row.version);
    if (fileByVersion.has(version)) continue;
    const target = LEGACY_VERSION_ALIASES[version];
    if (target && fileByVersion.has(target)) {
      reconciled.push({ recorded: version, satisfiedBy: fileByVersion.get(target).filename });
    } else {
      ledgerOnly.push(row);
    }
  }

  return { pending, ledgerOnly, changed, reconciled };
}

/**
 * Which pending files would be applied out of order, given what the target already recorded.
 * This is the hazard the retired filenames created: `20260903` recorded as applied, then every
 * pending `0NNN` file sorts before it, so replaying them "in order" would rewrite history.
 */
export function orderHazards(directory, ledgerRows, pendingVersions) {
  const recordedVersions = ledgerRows
    .map((row) => String(row.version))
    .filter((version) => ORDER_SAFE_VERSION.test(version))
    .sort();
  const highestRecorded = recordedVersions.length ? recordedVersions[recordedVersions.length - 1] : null;
  const hazards = highestRecorded
    ? pendingVersions.filter((version) => ORDER_SAFE_VERSION.test(version) && version < highestRecorded)
    : [];
  return { highestRecorded, hazards };
}

/**
 * The objects a migration file claims to create. Used as adoption evidence: a file whose objects
 * cannot be found on the target is adopted with an explicit "unconfirmed" note rather than
 * silently recorded as applied.
 *
 * Deliberately shallow — names only, no signatures, no column types. It is evidence that the file's
 * subject exists, not a proof that its exact body ran, and it must never be reported as more.
 */
export function declaredObjects(sql) {
  const tables = new Set();
  const functions = new Set();
  const views = new Set();
  const columns = new Set();

  for (const match of sql.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][\w.]*)/gi,
  )) {
    if (match[1].toLowerCase() !== 'if') tables.add(stripSchema(match[1]));
  }
  for (const match of sql.matchAll(
    /CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][\w.]*)/gi,
  )) {
    views.add(stripSchema(match[1]));
  }
  for (const match of sql.matchAll(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+([a-z_][\w.]*)\s*\(/gi)) {
    functions.add(stripSchema(match[1]));
  }
  for (const match of sql.matchAll(
    /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([a-z_][\w.]*)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-z_][\w]*)/gi,
  )) {
    columns.add(`${stripSchema(match[1])}.${match[2]}`);
  }

  return {
    tables: [...tables],
    functions: [...functions],
    views: [...views],
    columns: [...columns],
  };
}

function stripSchema(name) {
  return name.toLowerCase().replace(/^public\./, '');
}

/**
 * Decide whether a file that already has a ledger row was edited cosmetically or substantively.
 *
 * `verify` reports `changed after it was applied` when the hash differs. That message is a question,
 * not an answer: a comment added for review is a cosmetic edit, while a changed predicate is a new
 * migration that reuses a version. This is the only place the two are told apart, and the refusal is
 * the default — anything that does not normalise away must be written as a new migration.
 */
export function classifyReconciliation({ recordedStatements, fileBody }) {
  // Statement separators are compared as separators, not as text: the ledger stores a file as an
  // ARRAY of statements, so joining them back must compare equal to the file's own `;` layout. A
  // trailing `;` is likewise not SQL. (Found the hard way: without this, a purely comment-only edit
  // was reported as DIFFERENT because of the space after a semicolon.)
  const canonical = (text) =>
    normalizeSql(text)
      .replace(/\s*;\s*/g, ';')
      .replace(/;+$/, '');
  const recorded = canonical(Array.isArray(recordedStatements) ? recordedStatements.join(';') : String(recordedStatements ?? ''));
  const current = canonical(String(fileBody ?? ''));
  return {
    cosmetic: Boolean(recorded) && recorded === current,
    recordedLength: recorded.length,
    currentLength: current.length,
  };
}

/** One line per difference class, for the human report. */
export function describeComparisons(comparison) {
  return [
    ['pending', comparison.pending.map((e) => `${e.version} ${e.filename}`)],
    ['ledger-only', comparison.ledgerOnly.map((r) => `${r.version} ${r.name ?? ''}`.trim())],
    ['changed-after-apply', comparison.changed.map((c) => `${c.version} ${c.filename}`)],
    ['reconciled-alias', comparison.reconciled.map((r) => `${r.recorded} -> ${r.satisfiedBy}`)],
  ];
}
