/**
 * credentials-file.mjs — where a LOCAL production run gets its credentials, and why it is a file
 * outside the repository rather than an export, a `.env` in the checkout, or a GitHub secret.
 *
 * The problem this solves
 *   `PROD_DB_PASS` is the one input Phase 2A cannot produce by itself. GitHub Actions cannot run
 *   (account billing), production has no managed backups on the Free plan, and no authorised API
 *   returns the password — so the value has to be put somewhere by the operator, once, by hand.
 *   The question is only: where, such that it cannot leak.
 *
 * The rule this file enforces
 *   `environments.json` already states it: production credentials never live in the checkout, so
 *   `resolveCredentials('production')` reads no env file and every production credential arrives
 *   through the process environment. This tool is the one sanctioned way to fill that environment
 *   for a local run. It reads a file that is **outside the repository root** — enforced, not
 *   trusted — so there is no `.gitignore` rule to remember, no `git add -A` that can catch it, and
 *   no build step that can mistake it for app configuration (`.env.production.local` would have
 *   been loaded by Vite; a file in `~/.agrishop/` is loaded by nothing else).
 *
 * What it does not do
 *   It opens no socket. Shape and identity are checked here; whether the credentials actually
 *   *reach* production is proven later, by the run's own `assertReached()` against the live cluster
 *   fingerprint. A file check is not a substitute for that, and is not presented as one.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ROOT, assertCredentialsNameTarget, expectedProjectRefFor } from './environments.mjs';

/** The three values a production run needs. Nothing else in the file is imported. */
export const CREDENTIAL_KEYS = ['PROD_DB_HOST', 'PROD_DB_USER', 'PROD_DB_PASS'];

/**
 * Supabase's pooler host for this organisation's region, measured on 2026-10-01 by discriminating
 * probes: the correct host with the correct user reached the tenant and asked for a password,
 * while the wrong pooler prefix answered `tenant/user ... not found`. It is not a secret — it is
 * the same host the staging project uses — and it is only a default written into the template.
 */
export const DEFAULT_PRODUCTION_HOST = 'aws-0-ap-northeast-1.pooler.supabase.com';

/** `~/.agrishop/production.env` — outside the checkout by construction. */
export function defaultCredentialsPath() {
  return path.join(os.homedir(), '.agrishop', 'production.env');
}

export function isInsideRepository(candidate) {
  const resolved = path.resolve(candidate);
  const root = path.resolve(ROOT);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/**
 * The check that makes "no production credential in the checkout" structural.
 *
 * @throws when the path is inside the repository root, whether or not the file exists
 */
export function assertOutsideRepository(filePath) {
  const resolved = path.resolve(filePath);
  if (!isInsideRepository(resolved)) return resolved;

  throw new Error(
    `[CREDENTIAL INTAKE REFUSED] ${resolved} is inside this repository (${ROOT}).\n` +
      `  A production credential in the checkout is one accidental \`git add\` away from being\n` +
      `  committed, and an ignore rule is a promise, not a guarantee. Production credentials must\n` +
      `  live outside the repository — that is the rule environments.json has stated since Phase 2A\n` +
      `  began, and this path check is where it stops being a sentence in a comment.\n` +
      `  Default location: ${defaultCredentialsPath()}\n` +
      `  Override with --file <path> (still required to be outside ${ROOT}).`,
  );
}

/**
 * Parse `KEY=VALUE` lines.
 *
 * Deliberately the same semantics as `hydrateCredentialsFromEnvFile()` in environments.mjs, so a
 * password that works in a file also survives being exported into a shell:
 *
 *   - blank lines and lines whose first non-space character is `#` are ignored;
 *   - everything after the FIRST `=` is the value, so passwords may contain `=`, `#`, quotes and
 *     spaces without any escaping;
 *   - one pair of surrounding single or double quotes is stripped, which is how a password with
 *     leading or trailing whitespace is written unambiguously.
 *
 * @returns {{ values: Record<string,string>, ignored: string[], duplicates: string[] }}
 */
export function parseCredentialsFile(text) {
  const values = {};
  const ignored = [];
  const duplicates = [];

  for (const line of String(text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) {
      ignored.push(trimmed.slice(0, 48));
      continue;
    }

    const [, key, rawValue] = match;
    if (Object.prototype.hasOwnProperty.call(values, key)) duplicates.push(key);
    values[key] = rawValue.trim().replace(/^["']|["']$/g, '');
  }

  return { values, ignored, duplicates };
}

/**
 * Check completeness and identity, using the SAME guard the backup path uses.
 *
 * `assertCredentialsNameTarget` is imported rather than reimplemented on purpose: a second copy of
 * the rule would be a second thing to keep in step, and the whole defect this phase exists to fix
 * was a target identified by a name instead of by a check.
 *
 * @param {Record<string,string>} values
 * @param {{ source?: string|null }} [options]
 * @throws when a key is missing/empty, or the user string does not name production
 */
export function validateProductionCredentials(values, { source = null } = {}) {
  const where = source ? source : 'the credentials';

  const missing = CREDENTIAL_KEYS.filter((key) => !values[key]);
  if (missing.length) {
    const present = CREDENTIAL_KEYS.filter((key) => values[key]);
    throw new Error(
      `[CREDENTIAL INTAKE REFUSED] ${where} is missing ${missing.join(', ')}.` +
        (present.length ? ` Present: ${present.join(', ')}.` : '') +
        `\n  PROD_DB_PASS has no default and no fallback: an empty value is a refusal, never a run\n` +
        `  against a different environment. Fill it in from the Supabase dashboard (production\n` +
        `  project ${expectedProjectRefFor('production')} → Settings → Database).`,
    );
  }

  const projectRef = expectedProjectRefFor('production');
  const declaredUser = values.PROD_DB_USER;

  assertCredentialsNameTarget({
    environment: 'production',
    projectRef,
    envPrefix: 'PROD',
    values,
    declaredUser,
  });

  return {
    projectRef,
    host: values.PROD_DB_HOST,
    user: declaredUser,
    extras: Object.keys(values).filter((key) => !CREDENTIAL_KEYS.includes(key)),
  };
}

/**
 * Read and validate a credentials file.
 *
 * @param {string} filePath
 * @param {{ requireAll?: boolean }} [options] `requireAll: false` checks only the file's shape.
 */
export function readCredentialsFile(filePath, { requireAll = true } = {}) {
  const resolved = assertOutsideRepository(filePath);

  if (!fs.existsSync(resolved)) {
    throw new Error(
      `[CREDENTIAL INTAKE REFUSED] No production credential file at ${resolved}.\n` +
        `  Create it with:  node scripts/run-with-production-credentials.mjs --init\n` +
        `  then replace the empty PROD_DB_PASS line with the production database password.\n` +
        `  The value must not be pasted into chat, a tracked file, or a terminal someone else can read.`,
    );
  }

  const { values, ignored, duplicates } = parseCredentialsFile(fs.readFileSync(resolved, 'utf8'));
  const info = requireAll
    ? validateProductionCredentials(values, { source: resolved })
    : { projectRef: null, host: values.PROD_DB_HOST ?? null, user: values.PROD_DB_USER ?? null, extras: [] };

  return { path: resolved, values, ignored, duplicates, info };
}

/**
 * Write the template: the two values that are not secrets are filled in, the one that is stays
 * empty, so the operator edits exactly one line and cannot get the user string subtly wrong.
 *
 * Never overwrites an existing file — the one irreplaceable thing here is a filled-in password.
 */
export function writeCredentialsTemplate(filePath) {
  const resolved = assertOutsideRepository(filePath);

  if (fs.existsSync(resolved)) {
    throw new Error(
      `[CREDENTIAL INTAKE REFUSED] ${resolved} already exists. Refusing to overwrite it — a file in\n` +
        `  this location may already hold the production password, and that value cannot be recovered\n` +
        `  from anywhere else. Delete it deliberately if you want it regenerated.`,
    );
  }

  const projectRef = expectedProjectRefFor('production');
  const template = [
    `# Production database credentials for project ${projectRef} ("Agrishop APp").`,
    '#',
    '# This file lives OUTSIDE the repository on purpose: it can never be staged, committed or',
    '# bundled. It is read only by scripts/run-with-production-credentials.mjs, which validates it',
    '# and then hands the values to one allow-listed, read-only command as process environment.',
    '#',
    '# Fill in PROD_DB_PASS from the Supabase dashboard: production project -> Settings -> Database.',
    '# The database password is the same value the pooler connection string uses. If it was never',
    '# saved, the dashboard is the only place that can reset it - not this tool, and not an agent.',
    '#',
    '# Nothing else in this file is imported, and the password is never printed by any script here.',
    '',
    `PROD_DB_HOST=${DEFAULT_PRODUCTION_HOST}`,
    `PROD_DB_USER=postgres.${projectRef}`,
    'PROD_DB_PASS=',
    '',
  ].join('\n');

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, template, { mode: 0o600 });
  return resolved;
}
