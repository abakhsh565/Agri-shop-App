#!/usr/bin/env node
/**
 * qa-baseline.mjs — is the QA database in the state we reviewed, or has it drifted?
 *
 * WHY THIS EXISTS
 *   The tier-2 gate used to demand `qa:count` = 0. Measured 2026-10-13: 687 rows, of which 552 are
 *   `audit_events` — rows migration 0181 has the SYSTEM write rather than the caller, and which
 *   `tests/e2e/cleanupOwnership.ts` deliberately never deletes except by registered id. So the only
 *   way to satisfy a zero-row gate is `scripts/clean-test-data.mjs`, whose table-wide
 *   `DELETE FROM audit_events` destroys the database's own history. A gate whose sole satisfaction is
 *   destructive is not protecting the baseline; it is consuming it.
 *
 * WHAT REPLACES IT
 *   The baseline is defined by OWNERSHIP and EXPECTED FIXTURES, in `qa-baseline.json`, and checked in
 *   BOTH directions:
 *     • a table declared `exact` must match its reviewed count — more rows means a lane left something
 *       behind, FEWER means rows disappeared (the defect that lost seven baseline rows while the old
 *       gate reported the database as cleaner than before);
 *     • a table declared `zero` must hold nothing;
 *     • a table declared `history` is reported, not bounded (the system writes it, no lane can own it);
 *     • a table HOLDING rows that is not declared at all fails — the declaration can only become more
 *       permissive by being edited and reviewed;
 *     • the fixtures themselves must EXIST (the keep-list identities with an active membership, the
 *       FK-referenced supplier), because "the baseline is intact" is a claim about them;
 *     • the dedicated tenant the two write lanes need must still be EMPTY, because that emptiness is
 *       their premise.
 *
 * THE SAFETY RULE
 *   Read-only, structurally: `BEGIN READ ONLY` plus SELECTs, and a refusal for any target that is not
 *   the QA project. This tool never cleans, resets or writes — it is the thing that tells you whether a
 *   human should.
 *
 * USAGE
 *   node scripts/dev/qa-baseline.mjs             # check (exit 1 on any drift, missing fixture or premise loss)
 *   node scripts/dev/qa-baseline.mjs --propose   # print a declaration draft from the current database
 *   node scripts/dev/qa-baseline.mjs --json      # the same result, machine-readable
 */
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { BUSINESS_TABLES, QA_PROJECT_REF, qaDatabaseUrl } from './lib.mjs';

export const DECLARATION_FILE = 'scripts/dev/qa-baseline.json';

/** Read the reviewed declaration. A missing file is a refusal, never an empty default. */
export function readDeclaration(file = DECLARATION_FILE) {
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

/**
 * The whole decision, as a pure function: no I/O, no clock, no database. `observed` is what the
 * database currently holds, shaped as:
 *   { tables: { name: number }, fixtures: { users: [{phone, membershipStatus}], companies: [{id}] },
 *     isolatedTenant: { tables: { name: number } } }
 */
export function classifyBaseline(observed, declaration) {
  const failures = [];
  const notes = [];
  const tables = declaration.policies ?? {};

  for (const [name, count] of Object.entries(observed.tables ?? {})) {
    const rule = tables[name];
    // The zero case is NOT a short-circuit: a declared `exact` table that fell to zero is the
    // disappeared-rows failure, which is the half of the check the old zero-row gate could not express.
    // (Found by tests/unit/qaBaselinePolicy.test.ts, which failed on exactly this hole.)
    if (!rule) {
      if (count > 0) {
        failures.push(`${name}: ${count} row(s) in a table the declaration does not mention — review it and add a policy rather than assuming it is residue`);
      }
      continue;
    }
    if (rule.policy === 'history') {
      notes.push(`${name}: ${count} row(s) — system-written history, reported not bounded (reviewed observation ${rule.observed ?? 'not recorded'})`);
      continue;
    }
    if (rule.policy === 'zero') {
      if (count > 0) failures.push(`${name}: ${count} row(s) where the declaration expects none — ${rule.why ?? 'no reason recorded'}`);
      continue;
    }
    if (rule.policy === 'exact') {
      if (count > rule.expected) {
        failures.push(`${name}: ${count} row(s), declared ${rule.expected} — ${count - rule.expected} unexplained row(s) appeared. If a lane created them it should have cleaned them up; if they are legitimate, re-review and update the declaration`);
      } else if (count < rule.expected) {
        failures.push(`${name}: ${count} row(s), declared ${rule.expected} — ${rule.expected - count} row(s) DISAPPEARED. Deleting baseline rows is a failure, not a cleanup`);
      } else {
        notes.push(`${name}: ${count} row(s) — as declared (${rule.why ? rule.why.split('.')[0] : 'reviewed'})`);
      }
      continue;
    }
    failures.push(`${name}: unknown policy "${rule.policy}"`);
  }

  // A declared table that this database does not have at all is fine; one that EXISTS but was not
  // counted is a failure, because then the declaration is being checked against a partial picture.
  for (const [name, rule] of Object.entries(tables)) {
    if (name in (observed.tables ?? {})) continue;
    if ((observed.absentTables ?? []).includes(name)) {
      notes.push(`${name}: declared (${rule.policy}) but this database has no such table — nothing to check`);
      continue;
    }
    failures.push(`${name}: declared (${rule.policy}) but absent from the observation — the checker could not see it`);
  }

  for (const fixture of declaration.fixtures?.users ?? []) {
    const found = (observed.fixtures?.users ?? []).find((u) => u.phone === fixture.phone);
    if (!found) failures.push(`fixture user ${fixture.phone} is MISSING — ${fixture.why ?? ''}`.trim());
    else if (declaration.fixtures?.requireActiveMembership && found.membershipStatus !== 'active') {
      failures.push(`fixture user ${fixture.phone} has membership "${found.membershipStatus ?? 'none'}", not active — ${fixture.why ?? ''}`.trim());
    }
  }
  for (const company of declaration.fixtures?.companies ?? []) {
    if (!(observed.fixtures?.companies ?? []).some((c) => c.id === company.id)) {
      failures.push(`fixture company ${company.id} is MISSING — ${company.why ?? ''}`.trim());
    }
  }

  const tenant = declaration.isolatedTenant;
  if (tenant) {
    for (const table of tenant.mustBeEmpty ?? []) {
      const count = observed.isolatedTenant?.tables?.[table] ?? 0;
      if (count > 0) {
        failures.push(`isolated tenant ${tenant.id} is no longer empty: ${table} holds ${count} row(s) — the two write lanes' premise is gone`);
      }
    }
    if (observed.isolatedTenant && !observed.isolatedTenant.found) {
      failures.push(`isolated tenant ${tenant.id} was not found`);
    }
  }

  return { ok: failures.length === 0, failures, notes };
}

// ── observation (read-only) ───────────────────────────────────────────────────────────
export async function observe(client, declaration) {
  const names = Object.keys(declaration.policies ?? {});
  const present = new Set(
    (await client.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1)`,
      [names],
    )).rows.map((r) => r.relname),
  );
  const tables = {};
  const absentTables = [];
  for (const name of names) {
    if (!present.has(name)) { absentTables.push(name); continue; }
    tables[name] = (await client.query(`select count(*)::int as n from ${name}`)).rows[0].n;
  }
  // Business tables the declaration forgot to mention are still observed, so an undeclared table with
  // rows cannot hide behind not being asked about.
  for (const name of BUSINESS_TABLES) {
    if (tables[name] !== undefined) continue;
    const there = (await client.query(
      `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname = $1`, [name],
    )).rows.length;
    if (there) tables[name] = (await client.query(`select count(*)::int as n from ${name}`)).rows[0].n;
  }

  const phones = (declaration.fixtures?.users ?? []).map((u) => u.phone);
  const users = phones.length
    ? (await client.query(
        `select u.phone, m.status as membership_status
           from users u left join memberships m on m.user_id = u.id and m.status = 'active'
          where u.phone = any($1)`, [phones],
      )).rows
    : [];
  const companyIds = (declaration.fixtures?.companies ?? []).map((c) => c.id);
  const companies = companyIds.length
    ? (await client.query('select id from companies where id = any($1)', [companyIds])).rows
    : [];

  const tenantId = declaration.isolatedTenant?.id;
  let isolatedTenant = null;
  if (tenantId) {
    const found = (await client.query('select id from shops where id = $1', [tenantId])).rows.length > 0;
    const tenantTables = {};
    for (const table of declaration.isolatedTenant.mustBeEmpty ?? []) {
      const there = (await client.query(
        `select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and c.relname = $1`, [table],
      )).rows.length;
      if (!there) continue;
      tenantTables[table] = (await client.query(`select count(*)::int as n from ${table} where shop_id = $1`, [tenantId])).rows[0].n;
    }
    isolatedTenant = { id: tenantId, found, tables: tenantTables };
  }

  return {
    tables,
    absentTables,
    fixtures: {
      users: users.map((u) => ({ phone: u.phone, membershipStatus: u.membership_status ?? null })),
      companies: companies.map((c) => ({ id: c.id })),
    },
    isolatedTenant,
  };
}

/**
 * The whole check, end to end, for callers that are not this CLI (preflight, verify): connects
 * read-only, observes, classifies, and closes. Returns the classified result plus the raw observation,
 * and never throws for drift — the caller decides what drift means for its gate.
 */
export async function checkBaseline(declaration = readDeclaration()) {
  const url = qaDatabaseUrl();
  if (!url) return { ok: false, failures: ['no QA database configuration (QA_DATABASE_URL or QA_DB_HOST/USER/PASS)'], notes: [], observed: null, unreachable: true };
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    await client.query('BEGIN READ ONLY');
    const observed = await observe(client, declaration);
    const result = classifyBaseline(observed, declaration);
    await client.query('ROLLBACK');
    return { ...result, observed };
  } catch (error) {
    return { ok: false, failures: [`QA database unreachable: ${error.message}`], notes: [], observed: null, unreachable: true };
  } finally {
    try { await client.end(); } catch {}
  }
}

/** A declaration draft from the current database — printed for review, never written automatically. */
function propose(observed) {
  const draft = {};
  for (const [name, count] of Object.entries(observed.tables)) {
    draft[name] = {
      policy: name === 'audit_events' ? 'history' : count === 0 ? 'zero' : 'exact',
      ...(count ? { expected: count } : {}),
      why: '<review: say WHICH rows these are — fixture, tagged suite fixture, hand-entered, or history>',
    };
  }
  return draft;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────
async function main() {
  const asJson = process.argv.includes('--json');
  const proposing = process.argv.includes('--propose');
  const declaration = readDeclaration();
  const url = qaDatabaseUrl();
  if (!url) {
    console.error('Refusing to run: no QA database configuration (QA_DATABASE_URL or QA_DB_HOST/USER/PASS).');
    process.exit(1);
  }
  const targetRef = (() => {
    try {
      const parsed = new URL(url);
      const user = decodeURIComponent(parsed.username || '');
      if (user.includes('.')) return user.split('.')[1];
      return parsed.hostname.match(/^db\.([a-z]{20})\.supabase\./)?.[1] ?? parsed.hostname.match(/^([a-z]{20})\.supabase\./)?.[1] ?? '';
    } catch {
      return '';
    }
  })();
  if (targetRef !== QA_PROJECT_REF) {
    console.error(`Refusing to run: the target project ref is "${targetRef || '(unreadable)'}", not the QA project (${QA_PROJECT_REF}).`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const observed = await observe(client, declaration);
    const result = classifyBaseline(observed, declaration);

    if (proposing) {
      console.log(JSON.stringify(propose(observed), null, 2));
      await client.query('ROLLBACK');
      return;
    }
    if (asJson) {
      console.log(JSON.stringify({ ...result, observed }, null, 2));
    } else {
      const total = Object.values(observed.tables).reduce((a, b) => a + b, 0);
      console.log(`═══ QA baseline — ${total} business row(s) vs the declaration reviewed ${declaration.reviewedAt}`);
      for (const note of result.notes) console.log(`  OK    ${note}`);
      for (const failure of result.failures) console.log(`  FAIL  ${failure}`);
      if (result.ok) console.log('\nBASELINE OK — every row is declared, every fixture is present, the isolated tenant is still empty.');
      else console.log(`\nBASELINE DRIFTED (${result.failures.length} finding${result.failures.length === 1 ? '' : 's'}) — review before running more lanes. Never delete system-written history to force this green.`);
    }
    await client.query('ROLLBACK');
    if (!result.ok) process.exitCode = 1;
  } finally {
    try { await client.end(); } catch {}
  }
}

if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  await main();
}
