#!/usr/bin/env node
/**
 * production-gap.mjs — the objects the app calls, measured against an environment.
 *
 * THE DEFECT THIS CLOSES
 *   "Production is ready" was a statement about a ledger and a migration batch, not about the app.
 *   On 2026-11-15 production held 0315 — the newest ledger position in the repository — while 30
 *   RPCs and one table the client code actually calls were absent, because the files that create
 *   them had been replayed onto staging and never onto production. The app did not crash: those
 *   screens answered 404 and degraded, which is exactly the kind of gap a green ledger hides.
 *
 *   A ledger position is not an alignment claim. This tool measures the claim directly: it reads
 *   every `supabase.rpc('…')` and `supabase.from('…')` in `src/`, and asks the target database
 *   which of those names do not exist. Nothing about the repository's history is assumed.
 *
 * USAGE
 *   node scripts/dev/production-gap.mjs --env production                    # report
 *   node scripts/dev/production-gap.mjs --env production --fail-on-gap      # exit 1 on any gap
 *   node scripts/dev/production-gap.mjs --env production --json gap.json
 *
 *   Credentials come from that environment's own prefix (PROD_DB_* for production, QA_DB_* for
 *   staging) through `scripts/lib/environments.mjs`; a production run cannot borrow staging's
 *   credentials and refuses before connecting if they are absent. The gated production workflow
 *   runs this with `--fail-on-gap` after the apply, so a batch that leaves the app short of an
 *   object fails the release instead of being reported as complete.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import pg from 'pg';

import {
  ROOT,
  assertReached,
  connectionStringFor,
  identifyConnection,
  resolveCredentials,
} from '../lib/environments.mjs';

const SOURCE_EXTENSIONS = /\.(ts|tsx|js|mjs)$/;
const SKIP_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build', 'coverage']);

/** Every source file under `src/`. */
export function sourceTexts(root = ROOT) {
  const texts = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE_EXTENSIONS.test(entry.name)) texts.push(fs.readFileSync(full, 'utf8'));
    }
  };
  walk(path.join(root, 'src'));
  return texts;
}

/**
 * The RPC and relation names the client asks for. Pure, so the guard test can prove the
 * extraction is not silently empty.
 */
export function extractUsages(texts) {
  const joined = texts.join('\n');
  const collect = (pattern) => [
    ...new Set([...joined.matchAll(pattern)].map((match) => match[1].toLowerCase())),
  ].sort();
  return {
    rpc: collect(/\.rpc\(\s*['"`]([a-z0-9_]+)['"`]/gi),
    tables: collect(/\.from\(\s*['"`]([a-z0-9_]+)['"`]/gi),
  };
}

/** Names in `wanted` that are not in `present`. Pure. */
export function diffMissing(wanted, present) {
  const have = new Set(present.map((name) => name.toLowerCase()));
  return wanted.filter((name) => !have.has(name.toLowerCase()));
}

/**
 * Measure the gap. Returns the report; never exits, so the workflow decides what the numbers mean
 * and the guard test can call it with a stub client.
 */
export async function measureGap({
  environment,
  texts,
  clientFactory = (creds) =>
    new pg.Client({
      connectionString: connectionStringFor(creds),
      ssl: { rejectUnauthorized: false },
    }),
}) {
  const usages = extractUsages(texts);
  if (!usages.rpc.length) {
    throw new Error(
      'no `supabase.rpc(…)` calls were found in src/ — the extraction is stale, and a gap of zero ' +
        'measured from no calls would be a false pass.',
    );
  }

  const creds = resolveCredentials(environment);
  const client = clientFactory(creds);
  try {
    await client.connect();
    const identity = await identifyConnection(client, creds);
    assertReached(creds, identity);

    const presentRpc = (
      await client.query(
        `select p.proname as name
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = any($1::text[])`,
        [usages.rpc],
      )
    ).rows.map((row) => row.name);

    const presentTables = (
      await client.query(
        `select t.table_name as name
           from information_schema.tables t
          where t.table_schema = 'public' and t.table_name = any($1::text[])`,
        [usages.tables],
      )
    ).rows.map((row) => row.name);

    return {
      environment,
      projectRef: identity.projectRef ?? creds.projectRef,
      measuredAt: new Date().toISOString(),
      appCalls: { rpc: usages.rpc.length, tables: usages.tables.length },
      missingRpc: diffMissing(usages.rpc, presentRpc),
      missingTables: diffMissing(usages.tables, presentTables),
    };
  } finally {
    await client.end().catch(() => {});
  }
}

const flag = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return null;
  const next = process.argv[index + 1];
  return next && !next.startsWith('--') ? next : true;
};

async function main() {
  const environment = flag('env');
  const failOnGap = Boolean(flag('fail-on-gap'));
  const jsonPath = flag('json');

  if (environment === true || !environment) {
    console.error('[GAP REFUSED] name an environment: --env production|staging.');
    console.error('  Development has no project ref; this tool measures a deployed database only.');
    process.exit(2);
  }
  if (!['production', 'staging'].includes(environment)) {
    console.error(`[GAP REFUSED] ${environment} is not a deployed environment this tool measures.`);
    process.exit(2);
  }

  let result;
  try {
    result = await measureGap({ environment, texts: sourceTexts() });
  } catch (error) {
    console.error(`[GAP FAILED] ${error.message}`);
    process.exit(2);
  }

  const gapCount = result.missingRpc.length + result.missingTables.length;
  console.log(
    `\nApp-facing schema gap — ${result.environment} (${result.projectRef})\n` +
      `  app calls:  ${result.appCalls.rpc} RPC(s), ${result.appCalls.tables} relation(s) from src/\n` +
      `  missing:    ${result.missingRpc.length} RPC(s), ${result.missingTables.length} relation(s)\n`,
  );
  for (const name of result.missingRpc) console.log(`  RPC       ${name}`);
  for (const name of result.missingTables) console.log(`  relation  ${name}`);

  if (jsonPath) {
    fs.writeFileSync(path.resolve(ROOT, jsonPath), `${JSON.stringify(result, null, 2)}\n`);
    console.log(`\n  report: ${jsonPath}`);
  }

  if (gapCount === 0) {
    console.log('\nPASS: every RPC and relation the app calls exists in this environment.\n');
    process.exit(0);
  }

  console.log(
    `\n${failOnGap ? 'FAIL' : 'GAP'}: ${gapCount} object(s) the app calls are absent here. ` +
      'A migration batch that leaves this non-empty is not an alignment.\n',
  );
  process.exit(failOnGap ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
