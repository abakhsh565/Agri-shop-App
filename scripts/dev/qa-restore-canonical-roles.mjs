#!/usr/bin/env node
/**
 * qa-restore-canonical-roles.mjs — put the built-in roles back, and the fixture access they revoked.
 *
 * WHY THIS EXISTS
 *   The app lets an owner delete a built-in role and tells them so in its own words:
 *
 *     "roles.deleteHintBuiltIn": "{name} comes with the app. Nobody is using it, so it can be removed
 *      — you can create it again whenever you need it."
 *
 *   Migration 0183's `delete_role` then clears `memberships.role_id` to NULL for everyone who was on
 *   that role. On 2026-10-04 03:18:22Z that happened to the built-in "Sales Employee" role in the demo
 *   tenant — audit row { revokedFrom: 2, wasSystemRole: true } — which silently took the access of the
 *   two employee fixtures every lane signs in with, and left four suites assigning a role id that no
 *   longer exists. Recreating it is exactly what the microcopy promises is possible; this tool is the
 *   mechanical form of that promise, for the QA project only.
 *
 * WHAT IT DOES, IN ONE TRANSACTION
 *   1. For each targeted tenant, insert each missing built-in role from `canonical-roles.mjs` — with the
 *      canonical id when that id is free. If the id is held by a DIFFERENT role, the tool does not
 *      overwrite it: it reports the collision and skips, because two roles cannot share an id and the
 *      existing one is not this tool's to replace.
 *   2. Grant the permission codes 0107 defines for that role (Store Manager: everything except three).
 *   3. With `--repair-fixtures`, re-point the memberships of the DECLARED fixture accounts that have
 *      `role_id = NULL`, because an active membership with no role authorizes nothing (0165 grants "all
 *      permissions" only to role `owner`). The fixture list comes from the reviewed declaration in
 *      `scripts/dev/qa-baseline.json`, not from a second copy maintained here.
 *
 *   4. With `--repair-fixtures`, also restore the fixture accounts' WORK CONTEXT, declared in the same
 *      file under `fixtures.workContext`:
 *        · every declared employee membership whose `branch_scope` is empty gets the declared branch.
 *          This is the same class of defect as the NULL role_id — the accounts were created on
 *          2026-10-04, before 0188 defined a missing employee scope as an EMPTY scope, so they
 *          authenticated and then answered "You are in this business but not in a branch" on every
 *          operational screen. Nothing in the declaration is widened: the scope written is the one the
 *          declaration names, and a membership that is NOT a declared fixture is reported and left
 *          alone.
 *        · the declared owner fixture gets the declared tenant/branch as its ACTIVE shop. The app
 *          stores that selection in `user_active_shops` (0149) and a hand-run can leave it pointing
 *          somewhere else, which silently moves every lane that signs in as that account into another
 *          shop's empty screens. The repair prints what it changed, so the drift is visible.
 *
 * WHAT IT NEVER TOUCHES
 *   Production (refused by name). Rows it cannot attribute: a NULL-role membership that is not a
 *   declared fixture is reported and preserved, never re-pointed. Existing role rows: only missing
 *   names are created, so a tenant that renamed or re-scoped a built-in role keeps its own version.
 *
 * USAGE
 *   node scripts/dev/qa-restore-canonical-roles.mjs                      # plan (dry run), demo tenant
 *   node scripts/dev/qa-restore-canonical-roles.mjs --tenant <uuid>      # target another tenant too
 *   node scripts/dev/qa-restore-canonical-roles.mjs --repair-fixtures --apply
 */
import pg from 'pg';
import { QA_PROJECT_REF, qaDatabaseUrl } from './lib.mjs';
import { DECLARATION_FILE, readDeclaration } from './qa-baseline.mjs';
import {
  CANONICAL_ROLE_DEFINITIONS,
  CANONICAL_TENANT,
  missingCanonicalRoles,
  permissionCodesFor,
} from './canonical-roles.mjs';

const PRODUCTION_PROJECT_REF = 'gkswcfljxlutkfdvvqng';
const apply = process.argv.includes('--apply');
const repairFixtures = process.argv.includes('--repair-fixtures');

const tenantArgs = [];
for (let i = 0; i < process.argv.length; i++) {
  if (process.argv[i] === '--tenant' && process.argv[i + 1]) tenantArgs.push(process.argv[i + 1]);
}
const targetTenants = tenantArgs.length ? tenantArgs : [CANONICAL_TENANT];

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

async function buildPlan() {
  const roles = (await client.query('select id, tenant_id, name, is_system from roles')).rows;
  const allCodes = (await client.query('select code from permissions order by code')).rows.map((r) => r.code);
  const idsTaken = new Set(roles.map((r) => r.id));

  const plan = [];
  for (const tenantId of targetTenants) {
    const missing = missingCanonicalRoles(tenantId, roles, CANONICAL_ROLE_DEFINITIONS);
    plan.push({
      tenantId,
      missing: missing.map((definition) => ({
        definition,
        useCanonicalId: !idsTaken.has(definition.id),
        codes: permissionCodesFor(definition, allCodes),
      })),
    });
  }
  return { plan, allCodes };
}

/**
 * The declared work context, and what it currently looks like — the plan `--repair-fixtures` executes.
 * Read-only: it names the rows, and the apply step writes only these.
 */
async function workContextPlan() {
  const context = readDeclaration().fixtures?.workContext ?? null;
  if (!context) return { context: null, scopeRepairs: [], activeShopRepairs: [], preservedScopes: [] };

  const employees = context.employeePhones ?? [];
  const scopeRows = (await client.query(
    `select m.id, m.tenant_id, m.role::text as role, m.branch_scope, u.name as user_name, u.phone
       from memberships m join users u on u.id = m.user_id
      where u.phone = any($1) and m.tenant_id = $2 and m.status = 'active'
      order by u.phone`,
    [employees, context.tenantId],
  )).rows;
  const scopeRepairs = scopeRows.filter(
    (m) => !Array.isArray(m.branch_scope) || m.branch_scope.length === 0,
  );

  const ownerRow = (await client.query(
    `select u.id as user_id, u.name as user_name, u.phone, a.shop_id, a.branch_id
       from users u left join user_active_shops a on a.user_id = u.id
      where u.phone = $1`,
    [context.ownerPhone],
  )).rows[0] ?? null;
  const activeShopRepairs = ownerRow &&
    (ownerRow.shop_id !== context.tenantId || ownerRow.branch_id !== context.branchId)
    ? [ownerRow]
    : [];

  // Every other empty scope, so the ones this tool will NOT fix are visible too.
  const preservedScopes = (await client.query(
    `select m.id, u.name as user_name, u.phone, m.tenant_id
       from memberships m join users u on u.id = m.user_id
      where m.role <> 'owner' and m.status = 'active'
        and (m.branch_scope is null or cardinality(m.branch_scope) = 0)
      order by u.phone`,
  )).rows.filter((r) => !scopeRepairs.some((s) => s.id === r.id));

  return { context, scopeRepairs, activeShopRepairs, preservedScopes };
}

async function fixtureMemberships() {
  // The declaration names the accounts whose sign-in is a premise of every lane.
  const declaration = readDeclaration();
  const phones = (declaration.fixtures?.users ?? []).map((u) => u.phone);
  if (!phones.length) return [];
  const rows = (await client.query(
    `select m.id, m.tenant_id, m.role::text as role, m.status::text as status, m.role_id,
            u.name as user_name, u.phone
       from memberships m join users u on u.id = m.user_id
      where u.phone = any($1) and m.role <> 'owner' and m.status = 'active' and m.role_id is null
      order by u.phone`,
    [phones],
  )).rows;
  return rows;
}

async function main() {
  await client.connect();
  const { plan } = await buildPlan();
  const work = await workContextPlan();

  const declared = await fixtureMemberships();
  const declaredPhones = new Set(readDeclaration().fixtures?.users?.map((u) => u.phone) ?? []);

  // Every NULL-role active membership, so the ones this tool will NOT fix are visible too.
  const allNull = (await client.query(
    `select m.id, m.tenant_id, m.role::text as role, u.name as user_name, u.phone
       from memberships m join users u on u.id = m.user_id
      where m.role <> 'owner' and m.status = 'active' and m.role_id is null
      order by m.tenant_id`,
  )).rows;

  console.log(`═══ QA built-in roles — ${apply ? 'APPLYING' : 'PLAN (dry run, nothing written)'}`);
  console.log(`  target ${targetRef} (QA). production ${PRODUCTION_PROJECT_REF} is refused by this tool.`);

  const willCreate = plan.flatMap((t) => t.missing.map((m) => ({ tenantId: t.tenantId, ...m })));
  for (const entry of willCreate) {
    console.log(`\n  create "${entry.definition.name}" in tenant ${entry.tenantId}`);
    console.log(`     id: ${entry.useCanonicalId ? entry.definition.id : '(canonical id is taken — a generated id will be reported as an exception)'}`);
    console.log(`     description: ${entry.definition.description}`);
    console.log(`     permissions (${entry.codes.length}): ${entry.codes.join(', ')}`);
  }
  if (!willCreate.length) console.log('\n  every targeted tenant already holds the built-in roles.');

  const toRepair = declared.filter((m) => targetTenants.includes(m.tenant_id));
  console.log(`\n  fixture memberships to re-point (role_id NULL, declared fixture, targeted tenant): ${repairFixtures ? toRepair.length : `${toRepair.length} (pass --repair-fixtures to act)`}`);
  for (const m of toRepair) console.log(`     ${m.user_name} (${m.phone}) in ${m.tenant_id} — active ${m.role}, role_id NULL`);
  const preserved = allNull.filter((m) => !toRepair.some((r) => r.id === m.id));
  console.log(`  preserved as exceptions (NULL role_id, not a declared fixture or not targeted): ${preserved.length}`);
  for (const m of preserved) console.log(`     ${m.user_name} (${m.phone}) in ${m.tenant_id} — ${declaredPhones.has(m.phone) ? 'fixture, but in a non-targeted tenant' : 'not a declared fixture'}`);

  if (work.context) {
    console.log(`\n  work context (declared in ${DECLARATION_FILE}): tenant ${work.context.tenantId}, branch ${work.context.branchId}`);
    console.log(`  employee memberships with an EMPTY branch scope (0188 = no branch, so no operational screen): ${repairFixtures ? work.scopeRepairs.length : `${work.scopeRepairs.length} (pass --repair-fixtures to act)`}`);
    for (const m of work.scopeRepairs) {
      console.log(`     ${m.user_name} (${m.phone}) in ${m.tenant_id} — active ${m.role}, branch_scope ${m.branch_scope === null ? 'NULL' : '[]'} → [${work.context.branchId}]`);
    }
    console.log(`  owner fixture active shop differs from the declaration: ${work.activeShopRepairs.length}`);
    for (const o of work.activeShopRepairs) {
      console.log(`     ${o.user_name} (${o.phone}) is working in ${o.shop_id ?? '(no row)'}${o.branch_id ? ` / ${o.branch_id}` : ''} → ${work.context.tenantId} / ${work.context.branchId}`);
    }
    console.log(`  preserved as exceptions (empty scope, not a declared fixture): ${work.preservedScopes.length}`);
    for (const p of work.preservedScopes) console.log(`     ${p.user_name} (${p.phone}) in ${p.tenant_id}`);
  } else {
    console.log('\n  work context: NOT DECLARED — nothing about branch scope or the active shop is checked or repaired');
  }

  if (!apply) {
    console.log('\nDRY RUN — nothing was written. Re-run with --apply (and --repair-fixtures) to act.');
    return;
  }

  await client.query('BEGIN');
  try {
    for (const tenantId of targetTenants) {
      const roles = (await client.query('select id, tenant_id, name from roles')).rows;
      const allCodes = (await client.query('select code from permissions')).rows.map((r) => r.code);
      const missing = missingCanonicalRoles(tenantId, roles, CANONICAL_ROLE_DEFINITIONS);
      for (const definition of missing) {
        const idIsFree = !roles.some((r) => r.id === definition.id);
        const id = idIsFree ? definition.id : (await client.query('select gen_random_uuid()::text as id')).rows[0].id;
        if (!idIsFree) {
          console.log(`  EXCEPTION: canonical id ${definition.id} is held by another role; created "${definition.name}" as ${id} instead`);
        }
        await client.query(
          `insert into roles (id, tenant_id, name, description, is_system)
           values ($1, $2, $3, $4, true)
           on conflict (tenant_id, name) do nothing`,
          [id, tenantId, definition.name, definition.description],
        );
        const codes = permissionCodesFor(definition, allCodes);
        await client.query(
          `insert into role_permissions (role_id, permission_id)
           select $1::uuid, p.id from permissions p where p.code = any($2::text[])
           on conflict do nothing`,
          [id, codes],
        );
        console.log(`  created "${definition.name}" (${id}) in ${tenantId} with ${codes.length} permission(s)`);
      }
    }

    if (repairFixtures) {
      for (const m of toRepair) {
        const role = (await client.query(
          `select id from roles where tenant_id = $1 and name = $2`,
          [m.tenant_id, 'Sales Employee'],
        )).rows[0];
        if (!role) {
          console.log(`  EXCEPTION: no "Sales Employee" role in ${m.tenant_id}; ${m.user_name} left with role_id NULL`);
          continue;
        }
        await client.query('update memberships set role_id = $1, updated_at = now() where id = $2', [role.id, m.id]);
        console.log(`  re-pointed ${m.user_name} (${m.phone}) to "${'Sales Employee'}" (${role.id})`);
      }

      // 4. The declared work context. `branch_scope` is written only for memberships the declaration
      // names as fixtures, and only where it is EMPTY — a scope someone deliberately set is a decision,
      // not drift. The branch must exist in that tenant and be active; otherwise this is an exception.
      if (work.context) {
        const branch = (await client.query(
          'select id, name from branches where id = $1 and tenant_id = $2 and is_active',
          [work.context.branchId, work.context.tenantId],
        )).rows[0];
        if (!branch) {
          console.log(`  EXCEPTION: declared branch ${work.context.branchId} is not an active branch of ${work.context.tenantId}; nothing re-scoped`);
        } else {
          for (const m of work.scopeRepairs) {
            await client.query(
              'update memberships set branch_scope = $1::uuid[], updated_at = now() where id = $2',
              [[work.context.branchId], m.id],
            );
            console.log(`  scoped ${m.user_name} (${m.phone}) to "${branch.name}" (${work.context.branchId})`);
          }
        }
        for (const o of work.activeShopRepairs) {
          await client.query(
            `insert into user_active_shops (user_id, shop_id, branch_id, updated_at)
             values ($1, $2, $3, now())
             on conflict (user_id) do update set shop_id = excluded.shop_id,
               branch_id = excluded.branch_id, updated_at = now()`,
            [o.user_id, work.context.tenantId, work.context.branchId],
          );
          console.log(`  moved ${o.user_name} (${o.phone}) back to working in ${work.context.tenantId} / ${work.context.branchId}`);
        }
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`\nROLLED BACK — nothing was written: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  // Independent verification, from a fresh read: the roles exist with their permission counts.
  const verify = (await client.query(
    `select r.tenant_id, r.name, r.is_system, count(rp.permission_id)::int as permissions
       from roles r left join role_permissions rp on rp.role_id = r.id
      where r.name = any($1) and r.tenant_id = any($2::uuid[])
      group by 1,2,3 order by 1,2`,
    [CANONICAL_ROLE_DEFINITIONS.map((d) => d.name), targetTenants],
  )).rows;
  console.log('\n  verified after the write:');
  for (const v of verify) console.log(`     ${v.tenant_id} "${v.name}" is_system=${v.is_system} permissions=${v.permissions}`);
  const stillNull = (await client.query(
    `select count(*)::int as n from memberships m join users u on u.id = m.user_id
      where m.status = 'active' and m.role <> 'owner' and m.role_id is null and u.phone = any($1)`,
    [[...declaredPhones]],
  )).rows[0].n;
  console.log(`     declared fixture memberships still without a role: ${stillNull}`);
  if (work.context) {
    const scopeNow = (await client.query(
      `select u.phone, m.branch_scope from memberships m join users u on u.id = m.user_id
        where u.phone = any($1) and m.tenant_id = $2`,
      [work.context.employeePhones ?? [], work.context.tenantId],
    )).rows;
    for (const r of scopeNow) console.log(`     ${r.phone} branch_scope = ${JSON.stringify(r.branch_scope)}`);
    const activeNow = (await client.query(
      'select shop_id, branch_id from user_active_shops where user_id = (select id from users where phone = $1)',
      [work.context.ownerPhone],
    )).rows[0] ?? null;
    console.log(`     ${work.context.ownerPhone} active shop/branch = ${activeNow ? `${activeNow.shop_id} / ${activeNow.branch_id}` : '(none)'}`);
  }
}

try {
  await main();
} catch (error) {
  console.error(`qa-restore-canonical-roles failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await client.end(); } catch {}
}
