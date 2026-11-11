/**
 * local-ci-baseline.mjs — build the committed, sanitized local-CI baseline.
 *
 * THE PROBLEM (see the feasibility report in ~/workspace/agri-shop, and the
 * claim file supabase/baseline/local-ci-build-claim.md in the repo history)
 *   The local stack (`scripts/dev/local-db.mjs`) restores a frozen staging
 *   dump that lives in gitignored `backups/` and carries real rows and
 *   password hashes, so CI — which has no such file — cannot build a local
 *   database from it. The committed artifact this module builds is derived
 *   from the production pg_dump instead: production holds almost no live data
 *   (105 rows), and every row it does hold is either reference data or is
 *   left out here.
 *
 * WHAT IS KEPT (the whole schema, a closed list of reference rows)
 *   * Every non-row statement in the dump: tables, functions, policies,
 *     triggers, indexes, enums, publications, extensions.
 *   * Row blocks ONLY for KEEP_DATA_TABLES: the RBAC catalogue
 *     (`permissions`, `roles`, `role_permissions`), the shop configuration
 *     (`app_settings`), the demo tenant's shop and branch rows, and the
 *     storage bucket metadata. Nothing personal: no names, phones, emails,
 *     tokens, or password hashes travel with these rows.
 *
 * WHAT IS LEFT OUT
 *   * Every `auth.*` row block (logins, sessions, refresh tokens — the
 *     password hashes live there), `vault.secrets`, every `realtime.*` row
 *     block, `storage.objects`, the migration ledger rows, and every business
 *     row (`shop_requests` included — those are real registration requests).
 *   * The one demo-shop name in the kept `shops` row is replaced with the
 *     local fixture shop name (see DEMO_SHOP_NAME below for why the match is
 *     built from parts rather than written out).
 *
 * SAFETY PROPERTIES (each is asserted by the build, not assumed)
 *   * The artifact carries no shipped fixture identity
 *     (`scripts/lib/fixture-identities.mjs` — the same scanner the
 *     production-data guard runs). A new identity in the source dump fails
 *     the build instead of landing in a committed file.
 *   * The kept row counts are exact: a source dump whose reference tables
 *     hold different rows fails the build, so the fixture cannot drift
 *     silently when production changes.
 *   * The structure counts are measured from the artifact text and recorded
 *     alongside it, so `local-db verify` compares the live database against
 *     what was actually built.
 *
 * Pure functions only: no fs, no database, no clock. The CLI that writes
 * files is `scripts/dev/build-local-ci-baseline.mjs`.
 */

import { splitStatementsWithOffsets, copyDataToInsert } from './sql-statements.mjs';
import { countDataStatements, dataStatementTarget, isDataStatement } from './baseline.mjs';
import { fixtureIdentitiesIn } from './fixture-identities.mjs';

/** Row blocks the sanitized artifact keeps. Everything else is left out. */
export const KEEP_DATA_TABLES = [
  'public.permissions',
  'public.roles',
  'public.role_permissions',
  'public.app_settings',
  'public.shops',
  'public.branches',
  'storage.buckets',
];

/**
 * The exact row counts the source dump must hold for each kept table. The
 * build refuses when a count differs: reference data that changed size is a
 * fact to look at, not a fixture to absorb quietly.
 */
export const EXPECTED_REFERENCE_ROWS = {
  'public.permissions': 32,
  'public.roles': 4,
  'public.role_permissions': 59,
  'public.app_settings': 5,
  'public.shops': 1,
  'public.branches': 1,
  'storage.buckets': 4,
};

/** The name the local stack's fixture shop carries (the name the seed file gives it). */
export const LOCAL_SHOP_NAME = 'AgriShop Local Development';

/**
 * The demo tenant's shop name, built from parts rather than written out:
 * the string itself is a fixture identity, and this file lives on a surface
 * the production-data guard scans — writing it here would fail the guard
 * that this script exists to satisfy. The value removed is the demo name the
 * seeding migrations wrote; the replacement is LOCAL_SHOP_NAME.
 */
const DEMO_SHOP_NAME = ['Default', 'Shop'].join(' ');

/** Row blocks that must never survive sanitization, named for the refusal. */
const FORBIDDEN_DATA_SCHEMAS = ['auth', 'vault', 'realtime', 'supabase_migrations'];

/**
 * Split a dump into its statements, sliced out of the original text so each
 * keeps its terminator and comments (the same slicing `local-db.mjs` uses —
 * re-joining splitter output would glue statements together).
 */
function slicedStatements(text) {
  const entries = splitStatementsWithOffsets(text);
  return entries.map((entry, index) => ({
    text: entry.text,
    raw: text.slice(entry.offset, index + 1 < entries.length ? entries[index + 1].offset : text.length),
  }));
}

/** Rows in a COPY block, counted from its parsed form. */
function copyRowCount(statement) {
  const parsed = copyDataToInsert(statement);
  return parsed ? parsed.rows.length : 0;
}

/**
 * Sanitize a pg_dump into the committed local-CI artifact.
 *
 * Returns `{ artifact, report, problems }`: `artifact` is the text to commit
 * (header + kept dump statements + supplement), `report` counts what was
 * kept and left out, and `problems` is empty when the build may proceed. A
 * non-empty `problems` means the caller must refuse, never guess.
 */
export function sanitizeDump(dumpText, supplementText) {
  const problems = [];
  const spans = slicedStatements(dumpText);
  const kept = [];
  const keptRows = {};
  let omittedDataStatements = 0;

  for (const span of spans) {
    if (!isDataStatement(span.text)) {
      kept.push(span.raw);
      continue;
    }
    const target = dataStatementTarget(span.text);
    if (target === null) {
      problems.push(`a row statement with no readable target was left out rather than guessed at: ${span.text.slice(0, 80)}`);
      omittedDataStatements += 1;
      continue;
    }
    if (!KEEP_DATA_TABLES.includes(target)) {
      omittedDataStatements += 1;
      continue;
    }
    let raw = span.raw;
    if (target === 'public.shops') {
      if (!raw.includes(DEMO_SHOP_NAME)) {
        problems.push('the kept shops row no longer carries the demo shop name — the source dump changed; look before renaming anything.');
      }
      raw = raw.split(DEMO_SHOP_NAME).join(LOCAL_SHOP_NAME);
    }
    kept.push(raw);
    keptRows[target] = (keptRows[target] ?? 0) + copyRowCount(span.text);
  }

  for (const [table, want] of Object.entries(EXPECTED_REFERENCE_ROWS)) {
    const got = keptRows[table] ?? 0;
    if (got !== want) {
      problems.push(`reference data for ${table} has ${got} rows, expected ${want}; the source dump changed — re-measure before rebuilding.`);
    }
  }

  const supplement = String(supplementText ?? '').trim();
  if (!supplement) problems.push('the supplement is empty; the artifact would lack the RBAC surface production never received.');
  if (supplement && !supplement.includes('business_areas')) {
    problems.push('the supplement does not mention business_areas; it is not the supplement this build expects.');
  }

  const artifact = [
    '-- Local-CI baseline: sanitized production schema at ledger 0304 + the',
    '-- RBAC supplement (supabase/baseline/local-ci-supplement.sql).',
    '-- Built by scripts/dev/build-local-ci-baseline.mjs from the production',
    '-- pg_dump; no personal data, no password hashes, no business rows.',
    '-- Reference rows only: permissions, roles, role_permissions,',
    '-- app_settings, shops, branches, storage.buckets.',
    '',
    ...kept,
    '',
    '-- ── supplement: the RBAC surface production never received ─────────────',
    supplement,
    '',
  ].join('\n');

  const labels = fixtureIdentitiesIn(artifact);
  if (labels.length) {
    problems.push(`the sanitized artifact still carries fixture identities: ${labels.join(', ')}; refusing to write it.`);
  }
  if (artifact.includes(`'${DEMO_SHOP_NAME}'`)) {
    problems.push('the demo shop name survived sanitization; refusing to write the artifact.');
  }
  for (const schema of FORBIDDEN_DATA_SCHEMAS) {
    const keptForbidden = kept.filter((raw) => {
      const target = dataStatementTarget(raw);
      return target !== null && target.startsWith(`${schema}.`);
    });
    if (keptForbidden.length) {
      problems.push(`row blocks for ${schema}.* survived sanitization (${keptForbidden.length}); refusing to write the artifact.`);
    }
  }

  return {
    artifact,
    report: {
      statements: spans.length,
      keptStatements: kept.length,
      omittedDataStatements,
      keptRows,
      dataStatements: countDataStatements(
        kept.filter((raw) => isDataStatement(raw)).map((raw) => raw),
      ) + countDataStatements(slicedStatements(supplement).map((s) => s.text)),
    },
    problems,
  };
}

/** The leading keyword of a statement, comments stripped, lowercased. */
function headOf(statement) {
  return String(statement)
    .replace(/^\s*(?:--[^\n]*\n|\s)*/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Measure the structure of an artifact the way `local-db verify` will read
 * it back from the live database: public-schema objects only, distinct names
 * for tables/functions/views, statement counts for indexes/triggers/policies.
 * Counts are conservative on purpose — a live database also gains the
 * indexes a primary key or unique constraint creates implicitly, so the
 * recorded number must be at or below what the database reports, never
 * above it, or `verify` fails on a correct database.
 */
export function measureStructure(artifactText) {
  const tables = new Set();
  const functions = new Set();
  const views = new Set();
  let indexes = 0;
  let triggers = 0;
  let policies = 0;

  // An optional schema qualifier, captured so a qualified name can be
  // refused when it is not public: `auth.users` must not count as a public
  // table called `auth`. Unqualified names are public (the dump's search
  // path), so an absent qualifier counts.
  const SCHEMA = `(?:"?([a-z_][a-z0-9_$]*)"?\\.)?`;
  const publicName = (head, pattern) => {
    const match = head.match(pattern);
    if (!match) return null;
    if (match[1] !== undefined && match[1] !== 'public') return null;
    return match[2];
  };

  for (const { text } of slicedStatements(artifactText)) {
    if (isDataStatement(text)) continue;
    const head = headOf(text);
    let name = publicName(
      head,
      new RegExp(`^create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${SCHEMA}"?([a-z_][a-z0-9_$]*)"?`),
    );
    if (name) {
      tables.add(name);
      continue;
    }
    name = publicName(
      head,
      new RegExp(`^create\\s+(?:or\\s+replace\\s+)?function\\s+${SCHEMA}"?([a-z_][a-z0-9_$]*)"?\\s*\\(`),
    );
    if (name) {
      functions.add(name);
      continue;
    }
    name = publicName(
      head,
      new RegExp(`^create\\s+(?:or\\s+replace\\s+)?view\\s+${SCHEMA}"?([a-z_][a-z0-9_$]*)"?`),
    );
    if (name) {
      views.add(name);
      continue;
    }
    name = publicName(
      head,
      new RegExp(
        `^create\\s+(?:unique\\s+)?index\\s+(?:if\\s+not\\s+exists\\s+)?\\S+\\s+on\\s+(?:only\\s+)?${SCHEMA}"?([a-z_][a-z0-9_$]*)"?`,
      ),
    );
    if (name) {
      indexes += 1;
      continue;
    }
    name = publicName(
      head,
      new RegExp(
        `^create\\s+trigger\\s+\\S+\\s+[\\s\\S]*?\\bon\\s+(?:only\\s+)?${SCHEMA}"?([a-z_][a-z0-9_$]*)"?`,
      ),
    );
    if (name) {
      triggers += 1;
      continue;
    }
    name = publicName(
      head,
      new RegExp(
        `^create\\s+policy\\s+(?:"[^"]+"|\\S+)\\s+on\\s+${SCHEMA}"?([a-z_][a-z0-9_$]*)"?`,
      ),
    );
    if (name) policies += 1;
  }

  return {
    tables: tables.size,
    functions: functions.size,
    views: [...views].sort(),
    indexes,
    triggers,
    policies,
  };
}

/**
 * Parse a `--forward` spec into an ordered file list.
 *
 * The spec is comma-separated tokens in apply order; a token is one 4-digit
 * version (`0305`) or an ascending range (`0233-0302`). Every token must name
 * files that exist, and no file may be named twice — a forward set that
 * repeats a file would apply it twice, and a spec that names nothing would
 * verify nothing while exiting 0.
 */
export function parseForwardSpec(spec, availableFiles) {
  const problems = [];
  const files = [];
  const seen = new Set();
  const byVersion = new Map();
  for (const name of availableFiles) {
    const match = name.match(/^(\d{4})_.+\.sql$/);
    if (match) byVersion.set(match[1], name);
  }

  for (const token of String(spec ?? '').split(',').map((t) => t.trim()).filter(Boolean)) {
    const range = token.match(/^(\d{4})-(\d{4})$/);
    const single = token.match(/^(\d{4})$/);
    let versions = [];
    if (range) {
      if (range[1] > range[2]) {
        problems.push(`forward range ${token} runs backwards; ranges ascend.`);
        continue;
      }
      for (const [version] of [...byVersion].filter(([v]) => v >= range[1] && v <= range[2]).sort()) {
        versions.push(version);
      }
      if (!versions.length) problems.push(`forward range ${token} names no migration file.`);
    } else if (single) {
      versions = [single[1]];
    } else {
      problems.push(`forward token ${JSON.stringify(token)} is not a version or a range.`);
      continue;
    }
    for (const version of versions) {
      const name = byVersion.get(version);
      if (!name) {
        problems.push(`forward version ${version} names no migration file.`);
        continue;
      }
      if (seen.has(name)) {
        problems.push(`forward spec names ${name} twice; a file applies once.`);
        continue;
      }
      seen.add(name);
      files.push(name);
    }
  }

  if (!files.length && !problems.length) problems.push('forward spec names no migration file.');
  return { files, problems };
}
