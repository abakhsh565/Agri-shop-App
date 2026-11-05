#!/usr/bin/env node
/**
 * qa-restore-fixture-users.mjs — put the four declared fixture users back.
 *
 * WHY THIS EXISTS
 *   Two integration suites sign in as, or look up, the sales-employee fixture
 *   `923001122334` (assistantPermission signs in with the phone-derived
 *   credential; signInDoor calls `lookup_user_by_phone` for it). On 2026-11-06
 *   the QA probe found that users row GONE — only three of the four declared
 *   fixtures exist (owner 923001234567, QA Admin 923009999999, QA Employee
 *   923008888888). Nothing in the repo re-seeds it: `tests/setup/fixtures.ts`
 *   `setupUsers()` seeds only QA Admin + QA Employee, and neither failing
 *   suite calls it. So both suites fail at the fixture, not at the product.
 *
 * WHAT IT DOES, IN ONE TRANSACTION
 *   1. Upsert the four declared fixture users by their canonical ids
 *      (10000000-…-0001 QA Admin, -0002 QA Employee, -0003 owner Khalid Khan,
 *      -0004 sales employee 923001122334), with the exact shape the other
 *      fixtures already have: role, is_original_owner, is_active, shop_id.
 *      An existing row keeps its id and is_original_owner; only name, phone,
 *      role and is_active are refreshed to the declared values.
 *   2. The product's own `ensure_user_membership` trigger (0113) creates the
 *      membership when a users row is INSERTed — this script never writes a
 *      membership row by hand.
 *   3. Set the declared branch scope on the two employee fixtures'
 *      memberships where it is NULL or empty (the declared branch from
 *      `qa-baseline.json` workContext), because 0188 reads a missing scope as
 *      an EMPTY scope and the employee then answers "not in a branch" on
 *      every operational screen.
 *
 * WHAT IT NEVER TOUCHES
 *   Production (refused by name, same guard as the role restore). Any users
 *   row that is not one of the four declared fixtures — reported, never
 *   touched. A row whose phone belongs to a DIFFERENT id is reported as a
 *   collision and left alone (two users cannot share a phone).
 *
 * USAGE
 *   node scripts/dev/qa-restore-fixture-users.mjs            # plan (dry run), nothing written
 *   node scripts/dev/qa-restore-fixture-users.mjs --apply    # perform the restore
 */
import pg from 'pg';
import { QA_PROJECT_REF, qaDatabaseUrl } from './lib.mjs';
import { readDeclaration } from './qa-baseline.mjs';

const PRODUCTION_PROJECT_REF = 'gkswcfljxlutkfdvvqng';
const apply = process.argv.includes('--apply');

const SHOP_ID = '00000000-0000-0000-0000-000000000001';

/** The four declared fixture users, with the canonical ids the suites use. */
const FIXTURE_USERS = [
  { id: '10000000-0000-0000-0000-000000000001', name: 'QA Admin', phone: '923009999999', role: 'admin', isOriginalOwner: true },
  { id: '10000000-0000-0000-0000-000000000002', name: 'QA Employee', phone: '923008888888', role: 'employee', isOriginalOwner: false },
  { id: '10000000-0000-0000-0000-000000000003', name: 'Khalid Khan', phone: '923001234567', role: 'admin', isOriginalOwner: true },
  { id: '10000000-0000-0000-0000-000000000004', name: 'Sales Employee', phone: '923001122334', role: 'employee', isOriginalOwner: false },
];

const url = qaDatabaseUrl();
if (!url) {
  console.error('Refusing to run: no QA database configuration (QA_DATABASE_URL or QA_DB_HOST/USER/PASS).');
  process.exit(2);
}
let targetRef = '';
try {
  const parsed = new URL(url);
  const user = decodeURIComponent(parsed.username || '');
  targetRef = user.includes('.') ? user.split('.')[1] : (parsed.hostname.match(/^([a-z]{20})\./)?.[1] ?? '');
} catch {
  targetRef = '';
}
if (url.includes(PRODUCTION_PROJECT_REF)) {
  console.error(`Refusing to run: the connection string names the PRODUCTION project (${PRODUCTION_PROJECT_REF}).`);
  process.exit(2);
}
if (targetRef !== QA_PROJECT_REF) {
  console.error(`Refusing to run: the target project ref is "${targetRef || '(unreadable)'}", not the QA project (${QA_PROJECT_REF}).`);
  process.exit(2);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  const declaration = readDeclaration();
  const workContext = declaration.fixtures?.workContext ?? null;
  const branchId = workContext?.branchId ?? null;

  const existing = (await client.query(
    'select id, name, phone, role, is_active from users where id = any($1) or phone = any($2)',
    [FIXTURE_USERS.map((u) => u.id), FIXTURE_USERS.map((u) => u.phone)],
  )).rows;

  console.log(`═══ QA fixture users — ${apply ? 'APPLYING' : 'PLAN (dry run, nothing written)'}`);
  console.log(`  target ${targetRef} (QA). production ${PRODUCTION_PROJECT_REF} is refused by this tool.`);

  const plan = [];
  for (const fixture of FIXTURE_USERS) {
    const byId = existing.find((r) => r.id === fixture.id);
    const byPhone = existing.find((r) => r.phone === fixture.phone);
    if (byId && byPhone && byId.id !== byPhone.id) {
      console.log(`\n  COLLISION: phone ${fixture.phone} belongs to ${byPhone.id} (${byPhone.name}), not the canonical ${fixture.id} — left alone, report it instead of overwriting.`);
      plan.push({ ...fixture, action: 'collision' });
    } else if (byId) {
      console.log(`\n  present: ${fixture.name} (${fixture.phone}) id ${fixture.id} role ${byId.role} active=${byId.is_active}`);
      plan.push({ ...fixture, action: 'present' });
    } else if (byPhone) {
      console.log(`\n  COLLISION: id ${fixture.id} is free but phone ${fixture.phone} already belongs to ${byPhone.id} (${byPhone.name}) — left alone.`);
      plan.push({ ...fixture, action: 'collision' });
    } else {
      console.log(`\n  MISSING: ${fixture.name} (${fixture.phone}) id ${fixture.id} — would be created.`);
      plan.push({ ...fixture, action: 'create' });
    }
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply to act.');
    return;
  }

  await client.query('BEGIN');
  try {
    for (const entry of plan.filter((p) => p.action === 'create')) {
      await client.query(
        `insert into users (id, name, phone, role, is_original_owner, is_active, shop_id)
         values ($1, $2, $3, $4, $5, true, $6)
         on conflict (id) do update set name = excluded.name, phone = excluded.phone,
           role = excluded.role, is_active = excluded.is_active`,
        [entry.id, entry.name, entry.phone, entry.role, entry.isOriginalOwner, SHOP_ID],
      );
      console.log(`  created ${entry.name} (${entry.phone}) id ${entry.id}`);
    }
    // The trigger creates the membership on INSERT; the scope is the one
    // column it leaves empty for employees. Set it only where it is missing,
    // only for the declared fixture phones, only in the shared tenant.
    if (branchId) {
      const scoped = (await client.query(
        `update memberships m set branch_scope = $1::uuid[], updated_at = now()
           from users u
          where m.user_id = u.id and m.tenant_id = $2 and u.phone = any($3)
            and m.role = 'employee' and m.status = 'active'
            and (m.branch_scope is null or cardinality(m.branch_scope) = 0)
          returning u.phone`,
        [[branchId], SHOP_ID, FIXTURE_USERS.filter((u) => u.role === 'employee').map((u) => u.phone)],
      )).rows;
      for (const r of scoped) console.log(`  scoped ${r.phone} to branch ${branchId}`);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`\nROLLED BACK — nothing was written: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  // Independent verification, from a fresh read.
  const verify = (await client.query(
    'select u.id, u.name, u.phone, u.role, u.is_active, m.status as membership_status, m.role_id is not null as has_role, m.branch_scope from users u left join memberships m on m.user_id = u.id and m.tenant_id = $1 where u.id = any($2) order by u.phone',
    [SHOP_ID, FIXTURE_USERS.map((u) => u.id)],
  )).rows;
  console.log('\n  verified after the write:');
  for (const v of verify) {
    console.log(`     ${v.phone} ${v.name} role=${v.role} active=${v.is_active} membership=${v.membership_status ?? '(none)'} has_role=${v.has_role} scope=${JSON.stringify(v.branch_scope)}`);
  }
  const missing = FIXTURE_USERS.filter((f) => !verify.some((v) => v.id === f.id));
  if (missing.length) console.log(`  STILL MISSING: ${missing.map((m) => m.phone).join(', ')}`);
}

try {
  await main();
} catch (error) {
  console.error(`qa-restore-fixture-users failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await client.end(); } catch {}
}
