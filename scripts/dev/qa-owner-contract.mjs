#!/usr/bin/env node
/**
 * qa-owner-contract.mjs — is the OWNER rule actually enforced by the database, and is the built-in
 * role fixture intact?
 *
 * WHY THIS EXISTS
 *   Nine integration suites failed while acting as their own owner. The chain, established from the
 *   database rather than inferred:
 *     • 0113 derives a membership from `users.is_original_owner` / `users.role`;
 *     • 0165's `authorize_business_action` resolves the ACTIVE membership, and
 *       `has_effective_permission` grants "all permissions" only when that membership's role is `owner`;
 *     • 0183's `delete_role` clears `memberships.role_id` to NULL for everyone on the role it deletes.
 *   On 2026-10-04 03:18:22Z the built-in role `a0000000-…-0001` ("Sales Employee") was deleted in the
 *   demo tenant by the owner, through the app's own screen — intended behaviour, and the one audit row
 *   records it: { revokedFrom: 2, wasSystemRole: true }. The two memberships it cleared are the two
 *   employee fixtures every lane signs in with. Those accounts then authenticated and authorized
 *   nothing, which is how a working account gets "missing permission" for everything.
 *
 *   The checker is therefore not only about ownership: a built-in role that silently disappears is a
 *   FIXTURE failure with the same consequence as the QA accounts `qaFixtureKeepList.test.ts` protects.
 *
 * THE SAFETY RULE
 *   Read-only: `BEGIN READ ONLY` and SELECTs. It refuses the production project ref by name before any
 *   statement runs, and refuses any connection that does not resolve to the QA project.
 *
 * USAGE
 *   node scripts/dev/qa-owner-contract.mjs          # the contract check (exit 1 on any violation)
 *   node scripts/dev/qa-owner-contract.mjs --json   # machine-readable
 */
import pg from 'pg';
import { QA_PROJECT_REF, qaDatabaseUrl } from './lib.mjs';
import { classifyOwnerContract } from './owner-contract.mjs';
import { CANONICAL_ROLE_DEFINITIONS, CANONICAL_TENANT, missingCanonicalRoles } from './canonical-roles.mjs';

const PRODUCTION_PROJECT_REF = 'gkswcfljxlutkfdvvqng';
const asJson = process.argv.includes('--json');

const FIXTURE_PHONES = ['923001234567', '923001122334', '923009999999', '923008888888'];

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
  await client.query('BEGIN READ ONLY');

  const tenants = (await client.query('select id, name, owner_id, created_at from tenants order by created_at')).rows;
  const shops = (await client.query('select id, name from shops')).rows;
  const roles = (await client.query('select id, tenant_id, name, is_system, description from roles')).rows;
  const permissionCodes = (await client.query('select code from permissions')).rows.map((r) => r.code);
  const memberships = (await client.query(
    `select m.id, m.user_id, m.tenant_id, m.role::text as role, m.status::text as status, m.role_id,
            m.created_at, u.name as user_name, u.phone as user_phone
       from memberships m left join users u on u.id = m.user_id
      order by m.created_at`,
  )).rows;
  const users = (await client.query(
    'select id, name, phone, role::text as role, is_original_owner, is_active, shop_id from users order by created_at',
  )).rows;
  const ownerConstraintCount = (await client.query(
    `select count(*)::int as n from pg_indexes
      where schemaname = 'public' and tablename = 'memberships'
        and (indexdef ilike '%unique%' and indexdef ilike '%role%')`,
  )).rows[0].n;

  // The two tenants whose built-in roles callers reference: the demo tenant 0107 seeds (the suites)
  // and the tenant the write lanes register through the app.
  const canonicalTenantIds = [...new Set([CANONICAL_TENANT, '1e5f7e4b-7ed0-4787-8148-8f289fc1c107'])];

  const result = classifyOwnerContract({
    tenants,
    memberships,
    users,
    roles,
    permissionCodes,
    ownerConstraintCount,
    canonicalDefinitions: CANONICAL_ROLE_DEFINITIONS,
    canonicalTenantIds,
    missingCanonical: missingCanonicalRoles,
  });

  // The history that explains a broken membership: 0183 clears memberships.role_id for every member of
  // the role it removes and records only `wasSystemRole`, so this event is the visible trace of a
  // canonical role disappearing.
  const roleHistory = (await client.query(
    `select a.action, a.entity_id, a.details, a.created_at, u.name as actor_name
       from audit_events a left join users u on u.id = a.user_id
      where a.action in ('role_deleted', 'role_created', 'role_updated')
      order by a.created_at desc limit 25`,
  )).rows;

  await client.query('ROLLBACK');

  if (asJson) {
    console.log(JSON.stringify({ projectRef: targetRef, ...result, tenants, memberships, roles, roleHistory }, null, 2));
    return;
  }

  console.log(`═══ Owner contract — ${targetRef} (read-only)`);
  console.log(`  tenants ${tenants.length} · shops ${shops.length} · memberships ${memberships.length} · roles ${roles.length} · permissions ${permissionCodes.length} · users ${users.length}`);
  console.log(`  one-owner index enforcing the rule: ${ownerConstraintCount === 0 ? 'NONE' : `${ownerConstraintCount} index(es)`}`);

  for (const tenant of tenants) {
    const members = memberships.filter((m) => m.tenant_id === tenant.id);
    const builtIn = roles.filter((r) => r.tenant_id === tenant.id && r.is_system).map((r) => r.name);
    console.log(`\n  ── ${tenant.name ?? '(unnamed)'} ${tenant.id} — ${members.length} membership(s), owner_id=${tenant.owner_id ?? '(none)'}`);
    console.log(`     built-in roles: ${builtIn.length ? builtIn.join(', ') : 'NONE'}`);
    for (const m of members) {
      const role = m.role_id ? roles.find((r) => r.id === m.role_id) : null;
      console.log(`     ${String(m.user_name ?? m.user_id).padEnd(24)} ${m.role.padEnd(9)} ${String(m.status).padEnd(8)} role_id=${m.role_id ?? 'NULL'}${role ? ` ("${role.name}" tenant ${role.tenant_id === m.tenant_id ? 'matches' : 'MISMATCH'})` : ''}`);
    }
  }

  console.log('');
  for (const note of result.notes) console.log(`  NOTE      ${note}`);
  for (const failure of result.security) console.log(`  SECURITY  ${failure}`);
  for (const failure of result.fixture) console.log(`  FIXTURE   ${failure}`);
  for (const failure of result.canonical) console.log(`  CANONICAL ${failure}`);
  console.log(result.ok
    ? '\nOWNER CONTRACT OK — one owner per business, owners unrestricted, every active membership resolvable, the built-in roles present.'
    : `\nOWNER CONTRACT VIOLATED (${result.failures.length}: ${result.security.length} security, ${result.fixture.length} fixture, ${result.canonical.length} canonical)`);

  const fixtures = users.filter((u) => FIXTURE_PHONES.includes(u.phone));
  console.log(`  fixtures seen: ${fixtures.map((f) => `${f.name} (${f.phone})`).join(', ') || 'NONE'}`);

  console.log('\n  ── role history (the cause, when a membership is broken)');
  if (!roleHistory.length) console.log('     (no role_created / role_updated / role_deleted events recorded)');
  for (const h of roleHistory) {
    const details = h.details ? JSON.stringify(h.details) : '{}';
    console.log(`     ${h.created_at instanceof Date ? h.created_at.toISOString() : h.created_at}  ${h.action.padEnd(13)} role=${h.entity_id}  by ${h.actor_name ?? '(unknown)'} ${details.slice(0, 160)}`);
  }

  if (!result.ok) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(`qa-owner-contract failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await client.end(); } catch {}
}
