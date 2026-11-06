#!/usr/bin/env node
/**
 * qa-fix-0280-duplicate-owners — one-time QA data fix for the 0280 unique index.
 *
 * WHY. Migration 0280 creates `memberships_one_active_owner_per_shop`: one active
 * standard owner per shop. The QA apply failed on it, because the fixture shop
 * 00000000-0000-0000-0000-000000000001 holds SIX active standard owners, not one
 * (probe run 42206750684). The root cause is migration 0113's trigger
 * `ensure_user_membership`: it gives a membership role of 'owner' to every user
 * inserted with `is_original_owner = true` — and five test identities were seeded
 * that way although they are admins, not owners:
 *
 *   QA Admin          10000000-0000-0000-0000-000000000001  (tests/setup/fixtures.ts)
 *   Destruct Test Admin d1000000-0000-0000-0000-000000000099 (destructiveSafety)
 *   Perm Test Admin     e1000000-0000-0000-0000-000000000001 (employeePermissions)
 *   Fin Test User       f0000000-0000-0000-0000-000000000001 (financialIntegrity)
 *   Inv Test User       f1000000-0000-0000-0000-000000000030 (inventoryIntegrity)
 *
 * The designated owner of the fixture shop is Khalid Khan (923001234567,
 * qa-baseline.json workContext.ownerPhone) — he is NOT touched. The four lane
 * users and QA Admin are corrected to what the trigger would have created for an
 * admin: `users.is_original_owner = false` and a membership of role 'admin' with
 * the tenant's Store Manager role_id. The seed files were fixed at the same time
 * (is_original_owner false in the INSERT, and in the ON CONFLICT update where the
 * suite has one), so a fresh setup or a re-created user cannot bring the
 * duplicates back.
 *
 * One subtlety the dry run caught: migration 0188's `validate_member_branch_scope`
 * trigger refuses a role change away from 'owner' unless the membership also
 * gains an explicit branch_scope (owners are exempt; a NULL scope is only allowed
 * on INSERT). So the demoted memberships are scoped to every active branch of
 * the fixture tenant — the same reach they had as owners, only the permission
 * set changes (owner-everything becomes the Store Manager's canonical 30).
 *
 * SAFETY. QA ONLY — it refuses any connection string naming the production
 * project, and requires the QA project ref. One transaction, rolled back on any
 * error. Dry run by default; `--apply` writes. After the updates it asserts,
 * inside the same transaction, that every tenant holds at most one active
 * standard owner and that Khalid Khan is still the fixture shop's sole owner —
 * if either check fails, nothing is written.
 *
 * Usage: node scripts/dev/qa-fix-0280-duplicate-owners.mjs [--apply]
 */

import pg from 'pg';

import { QA_PROJECT_REF, qaDatabaseUrl } from './lib.mjs';

const PRODUCTION_PROJECT_REF = 'gkswcfljxlutkfdvvqng';
const FIXTURE_TENANT = '00000000-0000-0000-0000-000000000001';

// The five identities that are admins, not owners. Khalid Khan (the designated
// owner) is deliberately absent.
const DEMOTE_USER_IDS = [
  '10000000-0000-0000-0000-000000000001', // QA Admin
  'd1000000-0000-0000-0000-000000000099', // Destruct Test Admin
  'e1000000-0000-0000-0000-000000000001', // Perm Test Admin
  'f0000000-0000-0000-0000-000000000001', // Fin Test User
  'f1000000-0000-0000-0000-000000000030', // Inv Test User
];
const OWNER_USER_ID = '10000000-0000-0000-0000-000000000003'; // Khalid Khan

const apply = process.argv.includes('--apply');
const url = qaDatabaseUrl();

if (url.includes(PRODUCTION_PROJECT_REF)) {
  console.error(`Refusing to run: the connection string names the PRODUCTION project (${PRODUCTION_PROJECT_REF}).`);
  process.exit(2);
}
const parsed = new URL(url);
const user = decodeURIComponent(parsed.username ?? '');
const targetRef = user.includes('.') ? user.split('.')[1] : (parsed.hostname.match(/^([a-z]{20})\./)?.[1] ?? '');
if (targetRef !== QA_PROJECT_REF) {
  console.error(`Refusing to run: the target project ref is "${targetRef || '(unreadable)'}", not the QA project (${QA_PROJECT_REF}).`);
  process.exit(2);
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });

async function duplicateOwners() {
  return (
    await client.query(
      `select m.tenant_id, count(*)::int as n
         from memberships m
        where m.role = 'owner' and m.access_kind = 'standard' and m.status = 'active'
        group by m.tenant_id having count(*) > 1`,
    )
  ).rows;
}

async function main() {
  await client.connect();
  console.log(`═══ QA 0280 duplicate owners — ${apply ? 'APPLYING' : 'PLAN (dry run, nothing written)'}`);
  console.log(`  target ${targetRef} (QA). production ${PRODUCTION_PROJECT_REF} is refused by this tool.`);
  await client.query('BEGIN');
  try {
    const storeManager = (
      await client.query(
        `select id from roles where tenant_id = $1 and is_system = true and name = 'Store Manager' limit 1`,
        [FIXTURE_TENANT],
      )
    ).rows[0];
    if (!storeManager) throw new Error(`Store Manager system role missing in tenant ${FIXTURE_TENANT} — restore it first (qa-restore-canonical-roles.mjs).`);
    const activeBranches = (
      await client.query(`select id from branches where tenant_id = $1 and is_active order by created_at, id`, [FIXTURE_TENANT])
    ).rows.map((r) => r.id);
    if (!activeBranches.length) throw new Error(`tenant ${FIXTURE_TENANT} has no active branch to scope the demoted memberships to.`);

    const usersToFix = (
      await client.query(
        `select id, name, phone from users where id = any($1) and is_original_owner is true order by phone`,
        [DEMOTE_USER_IDS],
      )
    ).rows;
    const membershipsToFix = (
      await client.query(
        `select m.user_id, u.name, u.phone from memberships m join users u on u.id = m.user_id
          where m.user_id = any($1) and m.tenant_id = $2 and m.role = 'owner' and m.status = 'active' order by u.phone`,
        [DEMOTE_USER_IDS, FIXTURE_TENANT],
      )
    ).rows;
    console.log(`\n  users to demote (is_original_owner true -> false): ${usersToFix.length}`);
    for (const u of usersToFix) console.log(`     ${u.name} (${u.phone})`);
    console.log(`  memberships to re-point (owner -> admin, role_id = Store Manager ${storeManager.id}): ${membershipsToFix.length}`);
    for (const m of membershipsToFix) console.log(`     ${m.name} (${m.phone})`);
    console.log(`  branch scope for the demoted memberships (${activeBranches.length} active branch(es)): ${activeBranches.join(', ')}`);

    // The updates run inside the transaction either way; dry-run rolls back at
    // the end, so the verification below proves the WOULD-BE state too.
    await client.query(`update users set is_original_owner = false where id = any($1) and is_original_owner is true`, [DEMOTE_USER_IDS]);
    await client.query(
      `update memberships set role = 'admin', role_id = $2, branch_scope = $3, updated_at = now()
        where user_id = any($1) and tenant_id = $4 and role = 'owner' and status = 'active'`,
      [DEMOTE_USER_IDS, storeManager.id, activeBranches, FIXTURE_TENANT],
    );

    const duplicates = await duplicateOwners();
    if (duplicates.length) {
      throw new Error(
        `still ${duplicates.length} tenant(s) with more than one active standard owner: ${duplicates.map((d) => `${d.tenant_id} (${d.n})`).join(', ')}`,
      );
    }
    const unscoped = (
      await client.query(
        `select count(*)::int as n from memberships
          where user_id = any($1) and tenant_id = $2 and role = 'admin' and status = 'active'
            and (branch_scope is null or cardinality(branch_scope) = 0)`,
        [DEMOTE_USER_IDS, FIXTURE_TENANT],
      )
    ).rows[0].n;
    if (unscoped) throw new Error(`${unscoped} demoted membership(s) still have no branch scope.`);
    const fixtureOwner = (
      await client.query(
        `select u.phone, u.name from memberships m join users u on u.id = m.user_id
          where m.tenant_id = $1 and m.role = 'owner' and m.access_kind = 'standard' and m.status = 'active'`,
        [FIXTURE_TENANT],
      )
    ).rows;
    if (fixtureOwner.length !== 1 || fixtureOwner[0].phone !== '923001234567') {
      throw new Error(
        `fixture shop owner is not the designated one: ${JSON.stringify(fixtureOwner)} (expected only Khalid Khan, 923001234567)`,
      );
    }
    console.log(`\n  after the fix: no tenant holds more than one active standard owner;`);
    console.log(`  fixture shop owner is Khalid Khan (923001234567), as declared in qa-baseline.json.`);
    await client.query(apply ? 'COMMIT' : 'ROLLBACK');
    console.log(apply ? '\n  APPLIED and committed.' : '\n  Dry run only — rolled back, nothing written. Re-run with --apply to write.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`\n  FAILED — rolled back, nothing written: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

await main();
