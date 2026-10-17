#!/usr/bin/env node
/**
 * data-fingerprint.mjs — READ ONLY. What the database holds, as one digest per table.
 *
 * The batch gate proves the *files* are the verified files. This answers the other question: did the
 * rows change? It is used three ways:
 *
 *   * by a person, to record production's state (`--json backups/fingerprint-…json`);
 *   * by `scripts/migrate.mjs apply --env production`, which rehearses the batch in a transaction that
 *     is always rolled back and refuses if a protected table moved without being declared;
 *   * by `--compare`, to answer "did anything change since that file?" without a second connection.
 *
 * WHAT IT REFUSES
 *   Any environment other than staging/production (development is the local stack and has no ref, so
 *   it cannot be named here), and any transaction that is not READ ONLY. There is no flag that writes.
 *
 * Usage:
 *   node scripts/data-fingerprint.mjs --env staging [--json <file>]
 *   node scripts/data-fingerprint.mjs --env staging --compare backups/fingerprint-before.json
 *   node scripts/run-with-production-credentials.mjs -- node scripts/data-fingerprint.mjs --env production
 *
 * Exit codes: 0 = read (and the comparison, if any, is unchanged), 1 = the comparison found a change,
 *             2 = refused before connecting.
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

import {
  PROTECTED_TABLES,
  diffFingerprints,
  fingerprintDatabase,
  normaliseTable,
} from './lib/data-fingerprint.mjs';
import { ROOT, resolveCredentials } from './lib/environments.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return fallback;
  const token = args[i];
  return token.includes('=') ? token.slice(token.indexOf('=') + 1) : args[i + 1] ?? fallback;
};
const has = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

const environment = flag('env');
if (!environment) {
  console.error('[REFUSED] name the environment: --env staging | --env production');
  process.exit(2);
}
if (environment !== 'staging' && environment !== 'production') {
  console.error(`[REFUSED] ${environment} is not a target of this tool. Only staging and production are.`);
  process.exit(2);
}

const requested = flag('tables');
const tables = requested
  ? String(requested)
      .split(',')
      .map((t) => normaliseTable(t.trim()))
      .filter(Boolean)
  : PROTECTED_TABLES;
const unknown = tables.filter((t) => !PROTECTED_TABLES.includes(t));
if (unknown.length) {
  console.error(`[REFUSED] not a protected table: ${unknown.join(', ')}`);
  process.exit(2);
}

const creds = resolveCredentials(environment, { allowEnvFile: environment !== 'production' });
const client = new pg.Client({
  connectionString: `postgresql://${encodeURIComponent(creds.values[`${creds.envPrefix}_DB_USER`])}:${encodeURIComponent(
    creds.values[`${creds.envPrefix}_DB_PASS`],
  )}@${creds.values[`${creds.envPrefix}_DB_HOST`]}:6543/postgres`,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
await client.query('begin transaction read only');
const query = (sql, params = []) => client.query(sql, params);
const started = Date.now();

try {
  const fingerprints = await fingerprintDatabase(query, { tables });
  const present = Object.values(fingerprints).filter((f) => f.count !== null);
  const rows = present.reduce((sum, f) => sum + f.count, 0);

  const report = {
    environment,
    projectRef: creds.projectRef,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    tables: fingerprints,
    summary: { tables: present.length, rows, digestless: present.filter((f) => f.digest === null).map((f) => f.table) },
  };

  console.log(
    `\n  ${environment} (${creds.projectRef}) — ${present.length} table(s), ${rows} row(s), ` +
      `read-only, ${Date.now() - started}ms\n`,
  );
  for (const f of present) {
    console.log(`  ${String(f.count).padStart(8)}  ${String(f.digest ?? '(no columns)').slice(0, 12)}  ${f.table}`);
  }

  const jsonPath = flag('json');
  if (jsonPath) {
    const out = path.isAbsolute(jsonPath) ? jsonPath : path.join(ROOT, jsonPath);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n  written: ${path.relative(ROOT, out)}`);
  }

  const comparePath = flag('compare');
  if (comparePath) {
    const before = JSON.parse(fs.readFileSync(path.isAbsolute(comparePath) ? comparePath : path.join(ROOT, comparePath), 'utf8'));
    if (before.environment !== environment) {
      console.error(`[REFUSED] ${comparePath} was taken on ${before.environment}, not ${environment}.`);
      process.exit(2);
    }
    const diff = diffFingerprints(before.tables, fingerprints, []);
    if (!diff.ok) {
      console.error(`\n  CHANGED since ${before.generatedAt}:`);
      for (const table of diff.unexpected) {
        const was = before.tables[table];
        const now = fingerprints[table];
        console.error(`    ≠ ${table}: ${was?.count} → ${now?.count ?? 'gone'}`);
      }
      process.exitCode = 1;
    } else {
      console.log(`\n  UNCHANGED since ${before.generatedAt} (${present.length} table(s) compared).`);
    }
  }
} finally {
  try {
    await client.query('rollback');
  } catch {
    /* the read-only transaction is gone; nothing was written either way */
  }
  await client.end();
}

if (has('json') && process.exitCode === undefined) process.exitCode = 0;
