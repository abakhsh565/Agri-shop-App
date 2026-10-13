#!/usr/bin/env node
/**
 * verify-environment-isolation.mjs — prove that Development is a database of its own.
 *
 * WHY THIS EXISTS
 *   "Development and Staging/QA point to the same Supabase project" is a claim about *data*, and the
 *   targeting checks in scripts/lib/environments.mjs are claims about *configuration*. Those are not
 *   the same statement: a project ref can be recorded correctly in three files and still, through a
 *   wrong local env file, a stale `.env.local`, or a shared project, put development rows into QA.
 *   So this tool refuses to accept configuration as the proof and writes something instead: a row
 *   whose token is generated fresh on every run, planted in Development, and then searched for in
 *   every other environment.
 *
 * WHAT IT DOES
 *   1. Plants a canary row in Development: a token unique to this run, in a small table this tool
 *      creates in Development only (`public.dev_isolation_canary`). The token is random, so no
 *      comparison or cleanup rule can have been written to expect it.
 *
 *      Development is the LOCAL DOCKER STACK (environments.json: kind "local", see
 *      docs/LOCAL_DEVELOPMENT.md), so its leg is reached through `localStackConnection()`, which
 *      refuses any address that is not loopback — a `.env.local` pointing at a hosted project is
 *      refused before a socket exists rather than verified afterwards.
 *   2. Scans EVERY text-like column of EVERY table in `public` of each environment — Development,
 *      staging/QA, production — for that token. The scan is catalog-driven: it does not know the
 *      schema, so a table named later is searched without editing this file.
 *   3. Judges: Development must contain the token (otherwise the write or the scan is broken and the
 *      "absence" below would be vacuously true), staging must not, production must not.
 *   4. Removes the canary row it planted. The table itself is left in place, inert and empty: it is
 *      Development-only, and dropping it would make the next run's evidence depend on a DDL race.
 *
 * WHAT IT REFUSES, AND WHY THAT IS THE POINT
 *   * It writes to exactly one environment, named in the source (development), and it has no flag
 *     to change that. There is no invocation that plants a canary in QA or production.
 *   * A connection that does not prove it reached the recorded project is never scanned: the
 *     credential must name `postgres.<ref>` and the cluster fingerprint must match the enrolled one,
 *     both checked by the same code every other tool uses (`assertReached`).
 *   * An environment that cannot be reached is reported **BLOCKED**, and a run with any BLOCKED leg
 *     is NOT a pass — exit 1, never 0. This is the rule the whole task turns on: production has no
 *     credentials in this checkout by design, so the honest result is "the production leg is
 *     unverifiable", not "isolated".
 *   * No secret is ever printed: only environment names, project refs and cluster fingerprints.
 *
 * STATUSES
 *   PASS           development contains the canary; every other environment is reachable and does
 *                  not. Exit 0.
 *   FAIL           a reachable environment contradicts the claim (the canary is in QA or in
 *                  production), or an environment's connection states a different project than the
 *                  one recorded for it. Exit 1.
 *   BLOCKED        at least one leg could not be checked (no project recorded, missing credentials,
 *                  unreachable). Printed as `BLOCKED - NOT PASS`. Exit 1.
 *
 * Usage:
 *   node scripts/verify-environment-isolation.mjs [--token <unique-token>] [--json <file>]
 *   node scripts/verify-environment-isolation.mjs --self-test
 *
 * Exit codes: 0 = PASS, 1 = FAIL or BLOCKED, 2 = refused before doing anything.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';

import {
  ENVIRONMENT_NAMES,
  ROOT,
  assertReached,
  connectionStringFor,
  identifyConnection,
  identifyLocalStack,
  isLocalEnvironment,
  loadEnvironmentConfig,
  localStackConnection,
  resolveCredentials,
} from './lib/environments.mjs';

/** The one environment this file is allowed to write to. Not a parameter, on purpose. */
const WRITE_ENVIRONMENT = 'development';
const CANARY_TABLE = 'dev_isolation_canary';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const index = args.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (index === -1) return fallback;
  const token = args[index];
  return token.includes('=') ? token.slice(token.indexOf('=') + 1) : args[index + 1] ?? fallback;
};
const has = (name) => args.some((a) => a === `--${name}` || a.startsWith(`--${name}=`));

if (has('help') || args.includes('-h')) {
  console.log(
    [
      'Usage: node scripts/verify-environment-isolation.mjs [--token <unique-token>] [--json <file>]',
      '       node scripts/verify-environment-isolation.mjs --self-test',
      '',
      `  --token <token>   the canary to plant (default: a fresh random one per run)`,
      '  --json <file>     machine-readable report',
      '  --self-test       prove the scanner is non-vacuous, entirely in-process (no connection)',
      '',
      `  Writes only to "${WRITE_ENVIRONMENT}" (${CANARY_TABLE}); scans ${ENVIRONMENT_NAMES.join(', ')}.`,
      '  A leg that cannot be reached is BLOCKED, and a BLOCKED run is NOT PASS (exit 1).',
    ].join('\n'),
  );
  process.exit(0);
}

const jsonOut = flag('json');
const token = flag('token') ?? `DEV-ISOLATION-${crypto.randomBytes(9).toString('hex')}`;
const startedAt = new Date().toISOString();

const report = {
  tool: 'verify-environment-isolation',
  generatedAt: startedAt,
  writeEnvironment: WRITE_ENVIRONMENT,
  canaryTable: `${CANARY_TABLE}`,
  token,
  environments: {},
  verdict: 'BLOCKED',
  notes: [],
};

function writeReport(exitCode) {
  report.exitCode = exitCode;
  if (!jsonOut) return;
  const outPath = path.isAbsolute(jsonOut) ? jsonOut : path.join(ROOT, jsonOut);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`  Report: ${path.relative(ROOT, outPath)}`);
}

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

/**
 * The files that can write to Development, and the rule they must all obey: none of them may name a
 * hosted target at all.
 *
 * This is the production half of the isolation claim, and it is the only half available on a machine
 * that holds no production credentials — which is by design (environments.json: production's
 * credentials never live in the checkout). The canary above proves no development row reached QA; it
 * cannot say anything about production, because production cannot be reached from here.
 *
 * What CAN be proven, and is stronger than a promise, is structural: the local-development writers
 * are read and searched for the shapes through which a hosted environment would be named — a
 * `*.supabase.co` URL, a `QA_`/`PROD_` process-environment read, and the CLI commands that retarget
 * the whole checkout (`supabase link`, `supabase db push`, `--linked`). Each of those is how a local
 * command could reach a hosted database, and none of them belongs in a Development writer. An
 * inert mention in a comment is explicitly not a violation; a read or a command is.
 */
const LOCAL_DEVELOPMENT_WRITERS = [
  'scripts/dev/local-db.mjs',
  'supabase/seed.sql',
  'supabase/config.toml',
  '.env.local',
];

const HOSTED_SHAPE = /supabase\.(co|in)\b/;
const HOSTED_CREDENTIAL_READ = /process\.env\s*(?:\.\s*(?:QA|PROD)_[A-Z_]+|\[\s*['"`](?:QA|PROD)_)/;
const RETARGETING_COMMAND = /\bsupabase\s+(?:link|unlink|db\s+push)\b|--linked\b/;

/**
 * Remove comments from one line, carrying block-comment state across lines.
 *
 * Needed because a docblock that says "this file never calls `supabase link`" is an assertion about
 * the file, not a call — and flagging it would make this check fire on the very comment that
 * documents the rule, which is how a guard gets deleted instead of fixed.
 */
function codeOnly(line, state) {
  let out = '';
  let i = 0;
  if (/^\s*#/.test(line) && !state.quote) return out; // a shell/env comment
  while (i < line.length) {
    const char = line[i];

    if (state.block) {
      const end = line.indexOf('*/', i);
      if (end === -1) return out;
      state.block = false;
      i = end + 2;
      continue;
    }

    // Inside a string literal, everything is content — including the `//` of a URL. Reading
    // `"https://x.supabase.co"` as a comment is exactly the false negative this state exists to
    // prevent: the most direct way to name a hosted target is a URL string.
    if (state.quote) {
      out += char;
      if (char === '\\') {
        out += line[i + 1] ?? '';
        i += 2;
        continue;
      }
      if (char === state.quote) state.quote = null;
      i += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      state.quote = char;
      out += char;
      i += 1;
      continue;
    }
    if (line.startsWith('/*', i)) {
      state.block = true;
      i += 2;
      continue;
    }
    if (line.startsWith('//', i) || line.startsWith('--', i)) return out;
    out += char;
    i += 1;
  }
  return out;
}

/**
 * Search one file's text for a way to name a hosted environment.
 *
 * Pure, so `--self-test` can prove it flags the real shapes and leaves an innocent comment alone.
 */
export function scanLocalWriterForHostedTargets(text) {
  const violations = [];
  const state = { block: false, quote: null };
  const lines = String(text).split('\n');
  lines.forEach((line, index) => {
    // A comment is a statement about intent, not an action; only code (or SQL/TOML) counts.
    const code = codeOnly(line, state);
    if (!code.trim()) return;
    for (const [kind, pattern] of [
      ['hosted-url', HOSTED_SHAPE],
      ['hosted-credential-read', HOSTED_CREDENTIAL_READ],
      ['retargeting-command', RETARGETING_COMMAND],
    ]) {
      if (pattern.test(code)) violations.push({ line: index + 1, kind, text: line.trim().slice(0, 120) });
    }
  });
  return violations;
}

/** Read each local-development writer, if it is present, and report what it may reach. */
function scanLocalDevelopmentWriters() {
  const files = [];
  for (const rel of LOCAL_DEVELOPMENT_WRITERS) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) {
      files.push({ file: rel, present: false, violations: [] });
      continue;
    }
    files.push({
      file: rel,
      present: true,
      violations: scanLocalWriterForHostedTargets(fs.readFileSync(abs, 'utf8')),
    });
  }
  return { files, violations: files.flatMap((f) => f.violations.map((v) => ({ ...v, file: f.file }))) };
}

/** Every text-like column of every table in `public`, from the catalog rather than a hardcoded list. */
const TEXT_COLUMNS_SQL = `
  select table_name, column_name
    from information_schema.columns
   where table_schema = 'public'
     and data_type in ('text', 'character varying', 'character', 'uuid', 'json', 'jsonb', 'citext')
   order by table_name, column_name`;

/**
 * Search one connection for the token. Returns what was searched and what matched, so a reader can
 * see whether "no match" means "searched everything" or "searched nothing".
 */
async function scanForToken(client, value) {
  const { rows: columns } = await client.query(TEXT_COLUMNS_SQL);
  const matches = [];
  const unreadable = [];

  for (const { table_name: table, column_name: column } of columns) {
    const sql = `select count(*)::int as n from public.${quoteIdent(table)} where ${quoteIdent(column)}::text like $1`;
    try {
      const { rows } = await client.query(sql, [`%${value}%`]);
      if (rows[0].n > 0) matches.push(`${table}.${column} (${rows[0].n})`);
    } catch (error) {
      unreadable.push(`${table}.${column}: ${String(error.message).split('\n')[0].slice(0, 90)}`);
    }
  }

  return { columnsScanned: columns.length, matches, unreadable };
}

/**
 * Reach one environment, or say exactly why it could not be reached.
 *
 * `status` is one of REACHED | BLOCKED | FAIL. A BLOCKED leg is not a failure *of isolation* — it is
 * the absence of evidence about it, and it is deliberately not converted into a pass.
 */
async function reach(name) {
  const config = loadEnvironmentConfig().environments[name];
  const outcome = { environment: name, status: 'BLOCKED', projectRef: config.projectRef ?? null };

  // ── A local environment: reached through the stack on this machine, not through a project ref ──
  if (isLocalEnvironment(name)) {
    let target;
    try {
      target = localStackConnection(name);
    } catch (error) {
      return { ...outcome, reason: String(error.message).split('\n')[0] };
    }

    const client = new pg.Client({
      connectionString: target.connectionString,
      ssl: false,
      connectionTimeoutMillis: 15000,
      statement_timeout: 120000,
    });

    try {
      await client.connect();
    } catch (error) {
      await client.end().catch(() => {});
      return {
        ...outcome,
        reason:
          `could not connect to the local stack at ${target.host}:${target.port}: ` +
          String(error.message).split('\n')[0],
      };
    }

    let identity;
    try {
      identity = await identifyLocalStack(client, target);
    } catch (error) {
      await client.end().catch(() => {});
      return {
        ...outcome,
        status: 'FAIL',
        reason: `the local connection did not answer as a Supabase stack: ${String(error.message).split('\n')[0]}`,
      };
    }

    // The positive half of "this is the local stack": a plain Postgres on the same port would not
    // have Supabase's API roles. Without this, "scanned nothing" could pass for "scanned the stack".
    if (!identity.looksLikeSupabaseStack) {
      await client.end().catch(() => {});
      return {
        ...outcome,
        status: 'FAIL',
        reason:
          `connected to ${target.host}:${target.port}, but the Supabase API roles ` +
          `(anon, authenticated, service_role) are not all present, so this is not the local stack.`,
      };
    }

    return {
      environment: name,
      status: 'REACHED',
      client,
      /** Recorded so the report says the truth about which kind of target this leg was. */
      local: true,
      projectRef: target.projectId,
      serverVersion: identity.serverVersion,
      localStack: {
        host: identity.host,
        port: identity.port,
        database: identity.database,
        containers: identity.containers,
      },
    };
  }

  if (config.status !== 'active' || !config.projectRef) {
    return {
      ...outcome,
      reason: `no project ref is recorded for it in environments.json (status: "${config.status}")`,
    };
  }

  let creds;
  try {
    creds = resolveCredentials(name, { requireAll: false });
  } catch (error) {
    return { ...outcome, reason: String(error.message).split('\n')[0] };
  }
  if (creds.missing.length) {
    return { ...outcome, reason: `missing ${creds.missing.join(', ')}` };
  }

  const client = new pg.Client({
    connectionString: connectionStringFor(creds),
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 120000,
  });

  try {
    await client.connect();
  } catch (error) {
    await client.end().catch(() => {});
    return { ...outcome, reason: `could not connect: ${String(error.message).split('\n')[0]}` };
  }

  let identity;
  try {
    identity = await identifyConnection(client, creds);
    assertReached(creds, identity);
  } catch (error) {
    await client.end().catch(() => {});
    return {
      ...outcome,
      status: 'FAIL',
      reason: String(error.message).split('\n')[0],
      clusterId: identity?.clusterId ?? null,
    };
  }

  return {
    environment: name,
    status: 'REACHED',
    client,
    projectRef: creds.projectRef,
    clusterId: identity.clusterId ?? null,
    clusterIdEnrolled:
      (loadEnvironmentConfig().environments[name].clusterId ?? null) === (identity.clusterId ?? null),
  };
}

/**
 * The scanner's own non-vacuity proof.
 *
 * A tool that reports "absent everywhere" is satisfied by a scan that searches nothing — a broken
 * `information_schema` query, an empty schema, a wrong cast. So the scanner is run here against a
 * throwaway in-process Postgres holding one table that matches and one that does not, and both
 * outcomes must come out right. No Supabase project is contacted, and no credential is involved.
 */
async function selfTest() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  const present = `SELFTEST-${crypto.randomBytes(6).toString('hex')}`;
  const absent = `SELFTEST-${crypto.randomBytes(6).toString('hex')}`;

  await db.exec(`
    create schema if not exists public;
    create table public.holdings (id uuid primary key, label text not null, note varchar(64));
    create table public.unrelated (id uuid primary key, label text not null);
    insert into public.holdings (id, label, note) values
      (gen_random_uuid(), '${present}', 'a note that must also be searchable');
    insert into public.unrelated (id, label) values (gen_random_uuid(), 'nothing of interest');
  `);

  const hit = await scanForToken(db, present);
  const miss = await scanForToken(db, absent);
  const deepHit = await scanForToken(db, 'also be searchable');
  await db.close();

  const hostedScan = scanLocalWriterForHostedTargets(
    [
      'const url = "https://bpybjrjenwccowvtrevu.supabase.co";',
      'const pass = process.env.PROD_DB_PASS;',
      'await supabase link --project-ref bpybjrjenwccowvtrevu',
    ].join('\n'),
  );
  const innocentScan = scanLocalWriterForHostedTargets(
    [
      '-- it reads no QA_* or PROD_* variable (see the comment above)',
      '// supabase.co is never consulted by this file',
      '# PROD_DB_PASS=never-read-here',
      'alter default privileges in schema public grant all on tables to anon;',
    ].join('\n'),
  );
  // The false positive that this scan produced on its first real run: a docblock that DOCUMENTS the
  // rule was read as a call to `supabase link`. A comment must never be a violation, and the code
  // after the docblock must still be scanned.
  const docblockScan = scanLocalWriterForHostedTargets(
    [
      '/**',
      ' * WHAT IT REFUSES',
      ' *   * It never calls `supabase link`/`db push`, and never reads PROD_DB_PASS.',
      ' */',
      'const codeAfterTheDocblock = 1;',
    ].join('\n'),
  );
  const docblockThenViolation = scanLocalWriterForHostedTargets(
    [
      '/**',
      ' * A docblock that mentions supabase.co and PROD_DB_PASS.',
      ' */',
      'const pass = process.env.PROD_DB_PASS;',
    ].join('\n'),
  );

  const checks = [
    ['searches more than one column', hit.columnsScanned >= 3],
    ['finds the token that is present', hit.matches.length > 0],
    ['finds it by the table it is in', hit.matches.some((m) => m.startsWith('holdings.'))],
    ['reports no match for a token that is absent', miss.matches.length === 0],
    ['finds a token inside a longer value', deepHit.matches.length > 0],
    ['reads every column it claims to', hit.unreadable.length === 0],
    ['flags a hosted URL in a writer', hostedScan.some((v) => v.kind === 'hosted-url')],
    [
      'flags a hosted credential read in a writer',
      hostedScan.some((v) => v.kind === 'hosted-credential-read'),
    ],
    [
      'flags a retargeting CLI command in a writer',
      hostedScan.some((v) => v.kind === 'retargeting-command'),
    ],
    ['leaves an inert comment about hosted names alone', innocentScan.length === 0],
    ['leaves a docblock that documents the rule alone', docblockScan.length === 0],
    [
      'flags a hosted URL that appears inside a code string',
      hostedScan.some((v) => v.kind === 'hosted-url') &&
        scanLocalWriterForHostedTargets('const u = "https://x.supabase.co";').length === 1,
    ],
    [
      'still scans code that follows a docblock',
      docblockThenViolation.length === 1 && docblockThenViolation[0].line === 4,
    ],
  ];

  console.log('Isolation scanner — self-test (in-process Postgres, no connection, no credential)');
  console.log(`  columns discovered : ${hit.columnsScanned}`);
  console.log(`  present token      : ${hit.matches.join(', ') || 'NOT FOUND'}`);
  console.log(`  absent token       : ${miss.matches.length} match(es)`);
  console.log('');
  let failed = 0;
  for (const [label, ok] of checks) {
    if (!ok) failed += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  }
  console.log('');
  console.log(
    failed === 0
      ? 'SELF-TEST PASS — the scan is catalog-driven and can tell a present token from an absent one, so a clean result from it is evidence.'
      : `SELF-TEST FAIL — ${failed} of ${checks.length} checks failed; the scan must not be trusted until this passes.`,
  );

  report.selfTest = { checks: checks.map(([label, ok]) => ({ label, ok })), failed };
  report.verdict = failed === 0 ? 'SELF-TEST PASS' : 'SELF-TEST FAIL';
  writeReport(failed === 0 ? 0 : 1);
  process.exit(failed === 0 ? 0 : 1);
}

if (has('self-test')) {
  await selfTest();
}

// ── The run ─────────────────────────────────────────────────────────────────────────────────

// ── The structural half: what the local-development writers are able to name ──────────────────
const writers = scanLocalDevelopmentWriters();

console.log('Environment isolation proof — a canary planted in development, searched everywhere else');
console.log(`  Token:    ${token}`);
console.log(`  Writes:   ${WRITE_ENVIRONMENT} only (${CANARY_TABLE})`);
console.log(`  Scans:    ${ENVIRONMENT_NAMES.join(', ')}`);
console.log('');

const legs = {};
for (const name of ENVIRONMENT_NAMES) legs[name] = await reach(name);

/** Scan every reachable leg, planting first in the one environment this tool may write to. */
for (const name of ENVIRONMENT_NAMES) {
  const leg = legs[name];
  if (leg.status !== 'REACHED') continue;
  try {
    if (name === WRITE_ENVIRONMENT) {
      await leg.client.query(
        `create table if not exists public.${CANARY_TABLE} (
           token text primary key,
           created_at timestamptz not null default now()
         )`,
      );
      await leg.client.query(
        `insert into public.${CANARY_TABLE} (token) values ($1) on conflict (token) do nothing`,
        [token],
      );
      leg.planted = true;
    }
    const scan = await scanForToken(leg.client, token);
    leg.scan = scan;
    leg.found = scan.matches.length > 0;
  } catch (error) {
    leg.status = 'FAIL';
    leg.reason = `scan failed: ${String(error.message).split('\n')[0]}`;
  }
}

// ── Report, per environment, with the evidence and not just the verdict ──────────────────────
console.log('  Environment     Status   Project / evidence');
for (const name of ENVIRONMENT_NAMES) {
  const leg = legs[name];
  let detail;
  if (leg.status === 'REACHED') {
    const scanned = leg.scan ? `${leg.scan.columnsScanned} column(s) scanned, ` : '';
    const hits = leg.found ? `FOUND in ${leg.scan.matches.join(', ')}` : 'not found';
    const planted = leg.planted ? 'canary planted, ' : '';
    const where = leg.local
      ? `LOCAL STACK ${leg.localStack.host}:${leg.localStack.port}/${leg.localStack.database} ` +
        `[${leg.localStack.containers.join(', ') || 'container name unavailable'}, PostgreSQL ${
          leg.serverVersion ?? '?'
        }, project id "${leg.projectRef}"]`
      : `${leg.projectRef} cluster ${leg.clusterId ?? 'unavailable'}`;
    detail = `${where} — ${planted}${scanned}${hits}`;
    if (leg.scan?.unreadable.length) detail += `, ${leg.scan.unreadable.length} unreadable column(s)`;
  } else {
    detail = leg.reason;
  }
  console.log(`  ${name.padEnd(15)} ${leg.status.padEnd(8)} ${detail}`);
}
console.log('');

for (const name of ENVIRONMENT_NAMES) {
  const leg = legs[name];
  report.environments[name] = {
    status: leg.status,
    local: Boolean(leg.local),
    localStack: leg.localStack ?? null,
    serverVersion: leg.serverVersion ?? null,
    projectRef: leg.projectRef ?? null,
    clusterId: leg.clusterId ?? null,
    clusterIdEnrolled: leg.clusterIdEnrolled ?? null,
    reason: leg.reason ?? null,
    planted: Boolean(leg.planted),
    found: leg.found ?? null,
    columnsScanned: leg.scan?.columnsScanned ?? null,
    matches: leg.scan?.matches ?? [],
    unreadable: leg.scan?.unreadable ?? [],
  };
}

const development = legs[WRITE_ENVIRONMENT];
const others = ENVIRONMENT_NAMES.filter((name) => name !== WRITE_ENVIRONMENT);
const blocked = ENVIRONMENT_NAMES.filter((name) => legs[name].status === 'BLOCKED');
const failed = Object.values(legs).filter((leg) => leg.status === 'FAIL');
const contaminated = others.filter((name) => legs[name].status === 'REACHED' && legs[name].found);

if (failed.length || contaminated.length) {
  report.verdict = 'FAIL';
  console.log('ISOLATION: FAIL');
  for (const leg of failed) console.log(`  · ${leg.environment}: ${leg.reason}`);
  for (const name of contaminated) {
    console.log(
      `  · the canary IS in ${name} (${legs[name].scan.matches.join(', ')}) — ${WRITE_ENVIRONMENT} data has reached it.`,
    );
  }
} else if (development.status !== 'REACHED' || !development.found) {
  // The write side is the control. Without it, "not found" elsewhere proves nothing at all.
  report.verdict = 'BLOCKED';
  console.log('ISOLATION: BLOCKED - NOT PASS');
  console.log(
    `  · the canary could not be planted in ${WRITE_ENVIRONMENT} (${
      development.status === 'REACHED' ? 'it was planted but the scan did not find it' : development.reason
    }), so absence elsewhere is not evidence of isolation.`,
  );
} else if (blocked.length) {
  report.verdict = 'BLOCKED';
  console.log('ISOLATION: BLOCKED - NOT PASS');
  for (const name of blocked) console.log(`  · ${name} could not be checked: ${legs[name].reason}`);
  console.log(
    '  · the legs that WERE checked found no canary outside development; that is not a pass for the ones that were not.',
  );
} else {
  report.verdict = 'PASS';
  console.log('ISOLATION: PASS');
  console.log(
    `  · the canary is in ${WRITE_ENVIRONMENT} and appears in no other environment, across ` +
      `${others.map((name) => `${name} (${legs[name].scan.columnsScanned} columns)`).join(' and ')}.`,
  );
}

// ── Clean up only what this run planted, in the environment it was allowed to write to ───────
if (development.status === 'REACHED' && development.planted) {
  try {
    await development.client.query(
      `delete from public.${CANARY_TABLE} where token = $1`,
      [token],
    );
    const remaining = (
      await development.client.query(
        `select count(*)::int as n from public.${CANARY_TABLE} where token = $1`,
        [token],
      )
    ).rows[0].n;
    report.canaryRemoved = remaining === 0;
    console.log(
      remaining === 0
        ? '\n  Canary removed from development (the table itself is left in place, empty and inert).'
        : '\n  WARNING: the canary row is still present in development — remove it by hand.',
    );
  } catch (error) {
    report.canaryRemoved = false;
    console.log(`\n  WARNING: could not remove the canary row: ${String(error.message).split('\n')[0]}`);
  }
} else {
  report.canaryRemoved = null;
}

for (const name of ENVIRONMENT_NAMES) {
  const leg = legs[name];
  if (leg.client) await leg.client.end().catch(() => {});
}

// ── Report the structural scan, and let a violation refuse the run as a FAIL ──────────────────
report.structuralScan = writers;
console.log('  Local-development writers — what each one may name');
for (const entry of writers.files) {
  const state = !entry.present
    ? 'not present'
    : entry.violations.length
      ? `${entry.violations.length} violation(s)`
      : 'clean — no hosted URL, no QA_/PROD_ read, no retargeting command';
  console.log(`  ${entry.file.padEnd(28)} ${state}`);
  for (const violation of entry.violations) {
    console.log(`      line ${violation.line} [${violation.kind}] ${violation.text}`);
  }
}
console.log('');

if (writers.violations.length && report.verdict !== 'FAIL') {
  report.verdict = 'FAIL';
  console.log('ISOLATION: FAIL');
  console.log(
    `  · ${writers.violations.length} local-development writer(s) can name a hosted target, so a ` +
      `local command could reach QA or production. Fix the writer, not this check.`,
  );
}

const exitCode = report.verdict === 'PASS' ? 0 : 1;
writeReport(exitCode);
process.exit(exitCode);
