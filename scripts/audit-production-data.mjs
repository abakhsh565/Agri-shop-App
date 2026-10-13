#!/usr/bin/env node
/**
 * audit-production-data.mjs — READ ONLY. Measures whether a database's own rows are a customer's,
 * or test data that was never supposed to be there.
 *
 *   node scripts/audit-production-data.mjs                       # newest backups/backup-production-*.sql
 *   node scripts/audit-production-data.mjs --from backups/<artifact>.sql
 *   node scripts/audit-production-data.mjs --from backups/<artifact>.sql --json
 *
 * WHAT IT DOES
 *   Reads a logical backup artifact — the only form of production this repository is allowed to
 *   touch — and splits it with the project's own statement splitter
 *   (`scripts/lib/sql-statements.mjs`), so a statement inside a function body is never mistaken for
 *   a row. For every row it asks two separate questions, because they mean different things:
 *
 *     OWN ID      is the row's own primary key a demo/fixture identity? Then the row IS test data:
 *                 nothing a real shop did created it.
 *     TENANT REF  does the row reference the demo tenant? Then the row lives inside the demo
 *                 tenant. That is a scope fact, not by itself proof of test data — which is exactly
 *                 why the two are reported apart instead of as one alarming number.
 *
 * WHY IT EXISTS
 *   On 2026-10-13 production was reported clean on the strength of a by-hand grep for two patterns.
 *   It was not clean: the artifact holds a shop named `Default Shop`, four users keyed by demo
 *   identities (two of them on fixture phone numbers) and companies named `TEST`. A conclusion
 *   drawn from an ad-hoc grep is not evidence and cannot be reproduced. This is the reproducible
 *   form: one command, one verdict, the table and the identity label — never the row's other
 *   values, because a report is not a place to copy personal data.
 *
 * WHAT IT DOES NOT DO
 *   It never connects to a database, never writes, and cannot tell a demo row that a shop owner is
 *   really using from one nobody has touched. Clearing is a deliberate, owner-authorized action;
 *   see docs/PRODUCTION_DATA_POLICY.md §5.
 *
 * Exit codes: 0 = no demo/QA identity found, 1 = found (with the tables and counts), 2 = refused
 * (the artifact is missing or unreadable — nothing was audited, so nothing may be called clean).
 */
import fs from 'node:fs';
import path from 'node:path';
import { splitStatements } from './lib/sql-statements.mjs';
import {
  fixtureIdentitiesIn,
  DEMO_TENANT_ID,
  NAMED_ROW_LABELS,
  ROW_IDENTITY_LABELS,
} from './lib/fixture-identities.mjs';

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const AS_JSON = argv.includes('--json');
const EXPECT = flag('--expect'); // optional: the project ref this artifact must belong to

function refuse(message) {
  console.error(`REFUSED: ${message}`);
  process.exit(2);
}

// ── pick the artifact ────────────────────────────────────────────────────────────────
let artifact = flag('--from');
if (!artifact) {
  const dir = path.join(process.cwd(), 'backups');
  const candidates = fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /^backup-production-.*\.sql$/.test(f))
        .map((f) => path.join(dir, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
    : [];
  if (!candidates.length) refuse('no backups/backup-production-*.sql found — pass --from <artifact.sql>');
  artifact = candidates[0];
}
if (!fs.existsSync(artifact)) refuse(`no such artifact: ${artifact}`);

const sql = fs.readFileSync(artifact, 'utf8');

// ── identity of the artifact, from its own header and manifest ───────────────────────
const header = (label) => {
  const m = sql.match(new RegExp(`^-- ${label}:\\s*(.+)$`, 'm'));
  return m ? m[1].trim() : null;
};
const environment = header('Environment');
const projectRef = (header('Project') || '').split(/\s+/)[0] || null;
const generatedAt = header('Generated');
const manifestPath = artifact.replace(/\.sql$/, '.manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : null;

if (EXPECT && projectRef !== EXPECT) {
  refuse(`the artifact names project "${projectRef ?? '(unknown)'}", not ${EXPECT}`);
}

// ── reading a row: columns and values, with quoted commas kept inside one value ───────
/** Tables whose rows are people or businesses: a fixture name or phone here is the strongest kind of finding. */
const IDENTITY_TABLES = new Set([
  'users',
  'auth.users',
  'customers',
  'companies',
  'products',
  'product_variants',
  'shops',
]);

/** The nil UUID: Supabase writes it as `auth.users.instance_id` for every account. Not an identity. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000';

const INSERT =
  /^insert\s+into\s+(?:(?:"?([a-z_]+)"?)\.)?"?([a-z_]+)"?\s*\(([^)]*)\)\s*values\s*\(/i;

function splitValues(text, from) {
  const values = [];
  let buf = '';
  let depth = 0;
  let i = from;
  let inString = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      if (ch === "'" && text[i + 1] === "'") {
        buf += "''";
        i += 2;
        continue;
      }
      if (ch === "'") inString = false;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inString = true;
      buf += ch;
      i += 1;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      if (depth === 0) break;
      depth -= 1;
    }
    if (ch === ',' && depth === 0) {
      values.push(buf.trim());
      buf = '';
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  values.push(buf.trim());
  return values;
}

const rows = new Map(); // table -> row count
const keyedAsTest = new Map(); // table -> Map(label -> count): the row's own id is a demo identity
const namedAsTest = new Map(); // table -> Map(label -> count): an account/record carries a demo name or phone
const underDemoTenant = new Map(); // table -> count

const bump = (map, table, labels) => {
  if (!labels.length) return;
  if (!map.has(table)) map.set(table, new Map());
  for (const label of labels) {
    map.get(table).set(label, (map.get(table).get(label) ?? 0) + 1);
  }
};

for (const statement of splitStatements(sql)) {
  const head = statement.trim().match(INSERT);
  if (!head) continue;
  const schema = (head[1] || '').toLowerCase();
  // `public.` is the default schema of every row that matters here, so it is dropped; a non-public
  // schema is kept, because `auth.users` is where the logins live and it must stay distinguishable.
  const table = schema && schema !== 'public' ? `${schema}.${head[2].toLowerCase()}` : head[2].toLowerCase();
  rows.set(table, (rows.get(table) ?? 0) + 1);

  const columns = head[3].split(',').map((c) => c.trim().replace(/^"|"$/g, '').toLowerCase());
  const values = splitValues(statement.trim(), head[0].length);
  const ownIdIndex = columns.indexOf('id');
  const ownId = ownIdIndex === -1 ? '' : String(values[ownIdIndex] ?? '');

  bump(keyedAsTest, table, fixtureIdentitiesIn(ownId, ROW_IDENTITY_LABELS));

  // The demo tenant id is scope, not identity: it is stripped before looking for a name or a phone,
  // so a row is not called test data merely for belonging to the demo tenant.
  if (IDENTITY_TABLES.has(table)) {
    const identityText = statement
      .split(DEMO_TENANT_ID)
      .join('')
      .split(NIL_UUID)
      .join('')
      // The row's own id is already reported above as a keyed row; stripping it (and dropping the
      // id-shaped labels) keeps this bucket about the names and phone numbers a human can recognise,
      // so one finding is never counted twice.
      .split(ownId)
      .join('');
    bump(namedAsTest, table, fixtureIdentitiesIn(identityText, NAMED_ROW_LABELS));
  }
  if (statement.includes(DEMO_TENANT_ID)) {
    underDemoTenant.set(table, (underDemoTenant.get(table) ?? 0) + 1);
  }
}

const totalRows = [...rows.values()].reduce((a, b) => a + b, 0);
const rowsByTable = Object.fromEntries([...rows.entries()].sort());

// Cross-check the artifact against its own manifest: a count that disagrees means the artifact and
// the report describing it are not the same thing, and the audit must say so rather than pick one.
const mismatches = [];
if (manifest?.tableCounts) {
  for (const [key, reported] of Object.entries(manifest.tableCounts)) {
    if (key.startsWith('auth.')) continue;
    const counted = rows.get(key.split('.').pop().toLowerCase()) ?? 0;
    if (counted !== reported) mismatches.push(`${key}: manifest=${reported} artifact=${counted}`);
  }
}

const hasTestRows = keyedAsTest.size > 0 || namedAsTest.size > 0;
const verdict = hasTestRows ? 'FAIL' : 'PASS';
const rel = path.relative(process.cwd(), artifact).replace(/\\/g, '/');

if (AS_JSON) {
  console.log(
    JSON.stringify(
      {
        artifact: rel,
        environment,
        projectRef,
        generatedAt,
        totalRows,
        rowsByTable,
        testKeyedRows: Object.fromEntries(
          [...keyedAsTest.entries()].map(([t, l]) => [t, Object.fromEntries(l)]),
        ),
        testNamedRows: Object.fromEntries(
          [...namedAsTest.entries()].map(([t, l]) => [t, Object.fromEntries(l)]),
        ),
        rowsUnderDemoTenant: Object.fromEntries([...underDemoTenant.entries()].sort()),
        manifestMismatches: mismatches,
        verdict,
      },
      null,
      2,
    ),
  );
  process.exit(verdict === 'PASS' ? 0 : 1);
}

console.log(`\nAudit of ${rel} — READ ONLY`);
console.log(`  environment : ${environment ?? '(not stated)'}`);
console.log(`  project     : ${projectRef ?? '(not stated)'}`);
console.log(`  generated   : ${generatedAt ?? '(not stated)'}`);
console.log(`  rows        : ${totalRows} across ${rows.size} tables`);

if (mismatches.length) {
  console.log('\n  The artifact and its manifest disagree — one of them is stale:');
  for (const line of mismatches) console.log(`    • ${line}`);
}

if (!hasTestRows) {
  console.log('\nPASS: no row is keyed by, or named as, a demo or QA identity.');
  console.log(`      (${ROW_IDENTITY_LABELS.length} identity patterns checked against every row)`);
} else {
  console.log('\nFAIL: test data is present.');
  if (keyedAsTest.size) {
    console.log('  Rows whose own id is a demo identity — nothing a real shop did creates these:');
    for (const [table, labels] of [...keyedAsTest.entries()].sort()) {
      const detail = [...labels.entries()].map(([l, n]) => `${l}×${n}`).join(', ');
      console.log(`    • ${table}: ${detail}`);
    }
  }
  if (namedAsTest.size) {
    console.log('  Accounts and records carrying a demo name or phone number:');
    for (const [table, labels] of [...namedAsTest.entries()].sort()) {
      const detail = [...labels.entries()].map(([l, n]) => `${l}×${n}`).join(', ');
      console.log(`    • ${table}: ${detail}`);
    }
  }
}

if (underDemoTenant.size) {
  const total = [...underDemoTenant.values()].reduce((a, b) => a + b, 0);
  console.log(
    `\nAlso: ${total} row(s) across ${underDemoTenant.size} table(s) reference the demo tenant ${DEMO_TENANT_ID}`,
  );
  console.log('  (scope, not by itself test data — reported apart so the number is not misread):');
  for (const [table, n] of [...underDemoTenant.entries()].sort()) console.log(`  • ${table}: ${n}`);
}

if (verdict === 'FAIL') {
  if (environment && environment.toLowerCase() !== 'production') {
    console.log(`\n  This artifact is ${environment}, where demo rows are expected — what matters is that`);
    console.log('  they exist ONLY there. Run the audit on the production artifact for the verdict that counts.');
  } else {
    console.log('\n  This is a finding, not a cleanup. Removing rows from the live project is a');
    console.log('  deliberate, owner-authorized action — see docs/PRODUCTION_DATA_POLICY.md §5.');
  }
}

process.exit(verdict === 'PASS' ? 0 : 1);
