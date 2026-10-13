#!/usr/bin/env node
/**
 * qa-tenant.mjs — the dedicated, empty tenant the two write lanes need, and nothing else.
 *
 * WHY THIS EXISTS
 *   `setupCompletion` and `dependencyContinuity` both need a PREMISE they do not create: a shop with
 *   no suppliers, products or customers (`setupCompletion`), and an empty catalogue
 *   (`dependencyContinuity`, whose check is table-wide). Their old code produced that premise by
 *   deleting the shared QA shop's content, which destroyed other runs' rows and, once that was
 *   removed, made the lanes fail on their own premise check instead. The premise cannot come from
 *   ownership: a lane cannot own the ABSENCE of rows.
 *
 *   So the premise has to be a tenant of its own, and this file prepares it. The tenant is an
 *   APP-CREATED one — `fdfdfds` (`1e5f7e4b-…`), made through the real registration flow on
 *   2026-10-04 — which is why so little has to be written: it already has a branch
 *   (`ea60cd69-…`, `is_default`), its four system roles (Store Manager, Sales Manager, Inventory
 *   Clerk, Sales Employee — the same role sets every tenant gets), and zero business rows (measured
 *   2026-10-13: 0 companies, products, variants, customers, sales, sale_items, movements). What is
 *   missing is only the IDENTITIES the lane signs in with, because a lane signs in through the app:
 *   a test cannot reach a tenant it has no account in.
 *
 * WHAT IT WRITES — the whole list
 *   One `users` row and one `memberships` row per identity, inside the dedicated tenant:
 *     • `QA Isolation Owner`    — membership `owner`, so branch scope and permissions are the
 *                                  owner's own, the same shape as every tenant's first user.
 *     • `QA Isolation Employee` — membership `employee`, for `dependencyContinuity`'s negative case
 *                                  ("an employee is told who can create stock"). Dropping that case
 *                                  to avoid a second row would be weakening the lane, not isolating it.
 *   The sign-in credential is NOT hand-written here: `scripts/provision-auth-sessions.mjs` already
 *   owns that derivation (email/password from the phone) and verifies it by signing in, so `--apply`
 *   invokes it rather than duplicating it.
 *
 * WHAT IT WILL NOT DO
 *   • No DELETE, UPDATE or TRUNCATE — the write plan is INSERTs only, and `assertInsertsOnly` checks
 *     that mechanically before anything runs.
 *   • Never the shared QA shop (`00000000-…-0001`): pointing the fixture at it is a refusal, not a
 *     configuration.
 *   • Never a tenant that holds business rows: false there would mean the fixture was about to hand a
 *     lane somebody else's data to empty, which is the original defect.
 *   • Never silently existing: if the dedicated phone already has a `users` row, the script reports
 *     the fixture as already present instead of re-creating or resetting it.
 *   • Never production or staging: the target must be the QA project ref, read from the same
 *     authority `scripts/lib/environments.mjs` uses everywhere else.
 *
 * USAGE
 *   node scripts/dev/qa-tenant.mjs            # plan (read-only): what exists, what would be written
 *   node scripts/dev/qa-tenant.mjs --apply    # perform the fixture, then provision the credentials
 *   node scripts/dev/qa-tenant.mjs --json     # the plan as JSON
 *
 * This is a WRITE against the QA project when `--apply` is passed. It exists so that one command,
 * run during an authorized window, replaces a hand-built fixture — it is not run by any gate.
 */
import { spawnSync } from 'node:child_process';
import pg from 'pg';
import { QA_PROJECT_REF, qaDatabaseUrl } from './lib.mjs';

/** The app-created tenant used as the lanes' dedicated shop. */
export const ISOLATED_TENANT_ID = '1e5f7e4b-7ed0-4787-8148-8f289fc1c107';
/** The shared QA shop. Never a fixture target — the whole point of the dedicated tenant is not this. */
export const SHARED_QA_SHOP_ID = '00000000-0000-0000-0000-000000000001';
/** Stable ids so a re-run recognises its own rows instead of creating a second fixture. */
export const ISOLATED_IDENTITIES = [
  {
    id: '90000000-0000-0000-0000-0000000000a1',
    membershipId: '90000000-0000-0000-0000-0000000000b1',
    name: 'QA Isolation Owner',
    phone: '923007700001',
    role: 'admin',
    membershipRole: 'owner',
  },
  {
    id: '90000000-0000-0000-0000-0000000000a2',
    membershipId: '90000000-0000-0000-0000-0000000000b2',
    name: 'QA Isolation Employee',
    phone: '923007700002',
    role: 'employee',
    membershipRole: 'employee',
  },
];

// ── pure decision logic (no I/O — this is what the unit guard exercises) ──────────────

/**
 * The project ref a connection string points at, or '' when it cannot be read.
 * Both shapes occur in this repository: the pooler names the ref in the user (`postgres.<ref>`) and
 * a direct connection names it in the host (`db.<ref>.supabase.co`). An unreadable string returns ''
 * rather than a guess, so the caller refuses instead of proceeding.
 */
export function targetRefFromUrl(url) {
  try {
    const parsed = new URL(String(url ?? ''));
    const user = decodeURIComponent(parsed.username || '');
    if (user.includes('.')) return user.split('.')[1];
    return (
      parsed.hostname.match(/^db\.([a-z]{20})\.supabase\./)?.[1] ??
      parsed.hostname.match(/^([a-z]{20})\.supabase\./)?.[1] ??
      ''
    );
  } catch {
    return '';
  }
}

/**
 * Why this fixture must not run, as a list of reasons. Empty list = safe to proceed.
 * Every reason is checked before any write, so a refusal never leaves half a fixture behind.
 */
export function refusalReasons(input) {
  const reasons = [];
  if (input.targetRef !== QA_PROJECT_REF) {
    reasons.push(`the target project ref is "${input.targetRef || '(unreadable)'}", not the QA project (${QA_PROJECT_REF})`);
  }
  if (input.tenantId === SHARED_QA_SHOP_ID) {
    reasons.push('the fixture tenant is the SHARED QA shop — write lanes must not run against it');
  }
  if (input.tenantId !== ISOLATED_TENANT_ID) {
    reasons.push(`the fixture tenant is "${input.tenantId}", not the dedicated app-created tenant (${ISOLATED_TENANT_ID})`);
  }
  if (input.tenantBusinessRows > 0) {
    reasons.push(
      `the dedicated tenant already holds ${input.tenantBusinessRows} business row(s) — it is no longer empty, so a lane's empty premise would be a lie`,
    );
  }
  return reasons;
}

/** The exact rows the fixture creates. Data, not SQL, so a guard can inspect it. */
export function fixtureRows(tenantId = ISOLATED_TENANT_ID) {
  return ISOLATED_IDENTITIES.map((identity) => ({
    table: 'users',
    values: {
      id: identity.id,
      name: identity.name,
      phone: identity.phone,
      role: identity.role,
      shop_id: tenantId,
      is_original_owner: false,
      is_active: true,
    },
  })).concat(
    ISOLATED_IDENTITIES.map((identity) => ({
      table: 'memberships',
      values: {
        id: identity.membershipId,
        user_id: identity.id,
        tenant_id: tenantId,
        role: identity.membershipRole,
        status: 'active',
      },
    })),
  );
}

/**
 * THE WRITE PLAN, as statements. Parameterised, so no value is ever concatenated into SQL, and
 * INSERT-only by construction — `assertInsertsOnly` re-checks that mechanically rather than
 * trusting this function's name.
 */
export function writePlan(tenantId = ISOLATED_TENANT_ID) {
  return fixtureRows(tenantId).map(({ table, values }) => {
    const columns = Object.keys(values);
    return {
      table,
      sql: `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
      params: columns.map((c) => values[c]),
    };
  });
}

/**
 * Refuse any plan that is not INSERT-only: the fixture must not be able to remove or edit a row.
 * The placeholder/parameter count is checked too — a mismatch would either fail at the database or,
 * worse, bind values to the wrong columns, and neither is something to discover mid-write.
 */
export function assertInsertsOnly(plan) {
  const allowedTables = new Set(['users', 'memberships']);
  for (const step of plan) {
    if (!/^INSERT INTO [a-z_]+ \(/.test(step.sql)) {
      throw new Error(`[QA TENANT] refusing a non-INSERT statement: ${step.sql}`);
    }
    if (/delete|update|truncate|drop|alter/i.test(step.sql)) {
      throw new Error(`[QA TENANT] refusing a statement that could modify existing data: ${step.sql}`);
    }
    if (!allowedTables.has(step.table)) {
      throw new Error(`[QA TENANT] refusing to write ${step.table}: the fixture writes ${[...allowedTables].join(' and ')} only`);
    }
    const placeholders = step.sql.match(/\$\d+/g)?.length ?? 0;
    if (placeholders !== step.params.length) {
      throw new Error(`[QA TENANT] refusing ${step.sql}: ${placeholders} placeholder(s) for ${step.params.length} value(s)`);
    }
  }
  return plan;
}

// ── I/O ───────────────────────────────────────────────────────────────────────────────
const BUSINESS_TABLES_IN_TENANT = ['companies', 'products', 'customers', 'sales', 'suppliers'];

async function inspect(client, tenantId) {
  const present = new Set(
    (await client.query(
      `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relname = any($1)`,
      [BUSINESS_TABLES_IN_TENANT],
    )).rows.map((r) => r.relname),
  );
  const perTable = {};
  for (const table of BUSINESS_TABLES_IN_TENANT) {
    if (!present.has(table)) continue;
    perTable[table] = (await client.query(`select count(*)::int as n from ${table} where shop_id = $1`, [tenantId])).rows[0].n;
  }
  const tenantBusinessRows = Object.values(perTable).reduce((a, b) => a + b, 0);
  const tenant = (await client.query('select id, name, created_at from shops where id = $1', [tenantId])).rows[0] ?? null;
  const phones = ISOLATED_IDENTITIES.map((i) => i.phone);
  const existing = (await client.query('select id, name, phone from users where phone = any($1)', [phones])).rows;
  const branch = (await client.query('select id, name, is_default from branches where tenant_id = $1 order by is_default desc', [tenantId])).rows[0] ?? null;
  const roles = (await client.query('select count(*)::int as n from roles where tenant_id = $1', [tenantId])).rows[0].n;
  return { tenant, perTable, tenantBusinessRows, existing, branch, roles };
}

function printPlan(facts, apply, asJson) {
  const plan = writePlan();
  // The same reasons in both modes: a plan that would be refused must SAY so, or the plan looks
  // like an invitation to run a fixture against a tenant that is no longer empty.
  const refusals = refusalReasons({
    targetRef: facts.targetRef,
    tenantId: ISOLATED_TENANT_ID,
    tenantBusinessRows: facts.tenantBusinessRows,
  });
  const out = {
    mode: apply ? 'apply' : 'plan',
    targetRef: facts.targetRef,
    tenant: facts.tenant,
    branch: facts.branch,
    rolesInTenant: facts.roles,
    businessRowsInTenant: facts.tenantBusinessRows,
    businessRowsPerTable: facts.perTable,
    identitiesAlreadyPresent: facts.existing,
    refusals,
    writes: plan.map((p) => ({ table: p.table, sql: p.sql })),
  };
  if (asJson) {
    console.log(JSON.stringify(out, null, 2));
    return out;
  }
  console.log(`═══ isolated-tenant fixture (${out.mode}) — QA ${facts.targetRef}`);
  console.log(`  tenant   ${facts.tenant ? `${facts.tenant.name} (${facts.tenant.id}) created ${facts.tenant.created_at.toISOString()}` : '(not found)'}`);
  console.log(`  branch   ${facts.branch ? `${facts.branch.name} (is_default=${facts.branch.is_default})` : '(none)'}`);
  console.log(`  setup    ${facts.roles} role(s) in the tenant (app-created, not fixture-written)`);
  console.log(`  emptiness ${facts.tenantBusinessRows} business row(s)${Object.keys(facts.perTable).length ? ` — ${Object.entries(facts.perTable).map(([t, n]) => `${t}:${n}`).join(', ')}` : ''}`);
  for (const row of facts.existing) console.log(`  present  ${row.name} (${row.phone}) already exists`);
  console.log('  writes:');
  for (const step of plan) console.log(`    ${step.sql}`);
  if (refusals.length) {
    console.log('  REFUSED:');
    for (const r of refusals) console.log(`    • ${r}`);
  }
  return out;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const asJson = process.argv.includes('--json');
  const url = qaDatabaseUrl();
  if (!url) {
    console.error('Refusing to run: no QA database configuration (QA_DATABASE_URL or QA_DB_HOST/USER/PASS).');
    process.exit(1);
  }
  const targetRef = targetRefFromUrl(url);
  if (targetRef !== QA_PROJECT_REF) {
    console.error(`Refusing to run: the target project ref is "${targetRef || '(unreadable)'}", not the QA project (${QA_PROJECT_REF}).`);
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    if (!apply) {
      await client.query('BEGIN READ ONLY');
      const facts = await inspect(client, ISOLATED_TENANT_ID);
      facts.targetRef = targetRef;
      printPlan(facts, false, asJson);
      await client.query('ROLLBACK');
      return;
    }

    const facts = await inspect(client, ISOLATED_TENANT_ID);
    facts.targetRef = targetRef;
    const refusals = refusalReasons({ targetRef, tenantId: ISOLATED_TENANT_ID, tenantBusinessRows: facts.tenantBusinessRows });
    if (facts.existing.length) {
      // Not a refusal: the fixture is already there. Say so and stop, rather than re-writing it.
      printPlan(facts, true, asJson);
      console.log('\nfixture already present — nothing written.');
      return;
    }
    if (refusals.length) {
      printPlan(facts, true, asJson);
      console.error(`\nREFUSED (${refusals.length} reason${refusals.length === 1 ? '' : 's'}) — nothing written.`);
      process.exitCode = 1;
      return;
    }

    const plan = assertInsertsOnly(writePlan());
    await client.query('BEGIN');
    try {
      for (const step of plan) await client.query(step.sql, step.params);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    console.log(`wrote ${plan.length} row(s) into tenant ${ISOLATED_TENANT_ID}`);

    // The app signs in with a credential derived from the phone; the repo already owns that step and
    // verifies it by signing in, so it is invoked rather than reimplemented here.
    console.log('\n── provisioning sign-in credentials (scripts/provision-auth-sessions.mjs)');
    const provisioned = spawnSync('node', ['scripts/provision-auth-sessions.mjs'], { stdio: 'inherit', shell: true });
    if (provisioned.status !== 0) {
      console.error(`credential provisioning exited ${provisioned.status} — the fixture rows exist but the identities may not be able to sign in`);
      process.exitCode = 1;
    }
  } finally {
    try { await client.end(); } catch {}
  }
}

// Importable for the unit guard: the CLI only runs when this file is the entry point.
if (process.argv[1] && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  await main();
}
