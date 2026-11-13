/**
 * canonical-roles.mjs — the built-in role set, as data, in one place.
 *
 * WHY THIS EXISTS
 *   Migration 0107 seeds four built-in roles into the demo tenant with FIXED ids, and the integration
 *   suites reference those ids as "the seeded system role". That assumption held until 2026-10-04,
 *   when the owner deleted the Sales Employee role through the app's own screen — which is intended
 *   behaviour, and which the microcopy states plainly:
 *
 *     "roles.deleteHintBuiltIn": "{name} comes with the app. Nobody is using it, so it can be removed
 *      — you can create it again whenever you need it."
 *
 *   `delete_role` (0183) then cleared `memberships.role_id` to NULL for everyone who had been on it.
 *   In QA that was 2 memberships — the two employee fixtures every lane signs in with. The audit row
 *   says so: { revokedFrom: 2, wasSystemRole: true }. From then on those accounts authenticated
 *   successfully and authorized nothing, because migration 0165 short-circuits to "all permissions"
 *   only for membership role `owner`.
 *
 *   So "the built-in roles exist" is not a convention to assume; it is a FIXTURE to check and to be
 *   able to repair — the same treatment the QA accounts already get in `qaFixtureKeepList.test.ts`.
 *   This module is that single definition: a checker (`qa-owner-contract.mjs`) reports a missing
 *   built-in role, a repairer (`qa-restore-canonical-roles.mjs`) recreates it, and a unit test asserts
 *   the data here still agrees with migration 0107 — because a copy that drifts from the migration is
 *   worse than no copy at all.
 *
 * THE PERMISSION SETS ARE QUOTED FROM 0107, NOT INVENTED. Store Manager is expressed as 0107 writes
 * it: every permission except three.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** The demo tenant 0107 seeds, and the ids it names. */
export const CANONICAL_TENANT = '00000000-0000-0000-0000-000000000001';

export const CANONICAL_ROLE_DEFINITIONS = [
  {
    id: 'a0000000-0000-0000-0000-000000000001',
    name: 'Sales Employee',
    description: 'Shop floor: sales, customers, product viewing',
    include: ['customers.view', 'customers.create', 'sales.view', 'sales.create', 'products.view', 'inventory.view'],
    exclude: [],
  },
  {
    id: 'a0000000-0000-0000-0000-000000000002',
    name: 'Sales Manager',
    description: 'Full sales management: sales, customers, returns, reports',
    include: [
      'customers.view', 'customers.create', 'customers.edit', 'customers.payments',
      'sales.view', 'sales.create', 'sales.void', 'returns.view', 'returns.create',
      'products.view', 'inventory.view', 'reports.view',
    ],
    exclude: [],
  },
  {
    id: 'a0000000-0000-0000-0000-000000000003',
    name: 'Store Manager',
    description: 'Full store operations: all except employee/settings management',
    include: null, // every permission
    exclude: ['employees.manage', 'settings.edit', 'employees.view'],
  },
  {
    id: 'a0000000-0000-0000-0000-000000000004',
    name: 'Inventory Clerk',
    description: 'Stock management: products, inventory, suppliers',
    include: [
      'products.view', 'products.create', 'products.edit', 'inventory.view', 'inventory.adjust',
      'companies.view', 'companies.create', 'companies.edit',
      'purchases.view', 'purchases.create', 'payments.view', 'payments.supplier',
    ],
    exclude: [],
  },
];

/**
 * Permissions a later migration revoked from EVERY role after 0107 seeded them.
 * 0285 deleted `customers.delete` from every role's grants (customer deletion
 * stays with the owner, whose implicit authority in get_effective_permissions
 * is the only path left) — but the 0107 seed above still lists it, and the
 * unit test pins the definitions to that seed, so the exclusion list must NOT
 * grow to cover it. The revocation lives here instead, and the restore tool
 * applies it through livePermissionCodesFor() so a --reset-grants pass can
 * never silently re-add a revoked permission.
 */
export const POST_0107_REVOKED_PERMISSIONS = ['customers.delete'];

/** The permission codes a definition grants LIVE, after post-0107 revocations. */
export function livePermissionCodesFor(definition, allCodes) {
  return permissionCodesFor(definition, allCodes).filter(
    (c) => !POST_0107_REVOKED_PERMISSIONS.includes(c),
  );
}

/** The role a revoked fixture membership is restored to: the shop-floor role 0107 gives employees. */
export const FIXTURE_EMPLOYEE_ROLE_NAME = 'Sales Employee';

/**
 * Which canonical roles a tenant is missing, by name.
 *
 * By NAME, deliberately: 0107 inserts with `ON CONFLICT (tenant_id, name) DO NOTHING`, so a role that
 * already exists under a different id is a legitimate tenant, not drift. The id matters only to the
 * callers that reference it (the suites), which is why the repair reports an id collision instead of
 * forcing the canonical id over an existing role.
 */
export function missingCanonicalRoles(tenantId, roles, definitions = CANONICAL_ROLE_DEFINITIONS) {
  const held = new Set(roles.filter((r) => r.tenant_id === tenantId).map((r) => r.name));
  return definitions.filter((d) => !held.has(d.name));
}

/** The permission codes a definition grants, given the catalogue that exists in the database. */
export function permissionCodesFor(definition, allCodes) {
  if (definition.include === null) return allCodes.filter((c) => !definition.exclude.includes(c));
  return definition.include.filter((c) => allCodes.includes(c));
}

/**
 * Read the four role blocks back out of migration 0107 so a test can compare them with the data above.
 * Deliberately a plain text scan: the point is to compare against the migration as written, not against
 * a second hand-maintained structure.
 */
export function parse0107Seed(migrationPath = path.resolve('supabase/migrations/0107_roles_rbac_model.sql')) {
  const sql = readFileSync(migrationPath, 'utf8');
  const roles = [];
  const roleRe = /INSERT INTO roles \(id, tenant_id, name, description, is_system\) VALUES\s*\n\s*\('([0-9a-f-]+)',\s*'([0-9a-f-]+)',\s*'([^']+)',\s*'([^']*)',\s*(true|false)\)/g;
  let m;
  while ((m = roleRe.exec(sql))) {
    const [, id, tenantId, name, description] = m;
    const rest = sql.slice(m.index);
    // The role's permission block is the next INSERT INTO role_permissions … SELECT '<id>' statement.
    const permRe = new RegExp(
      `INSERT INTO role_permissions \\(role_id, permission_id\\)\\s*\\nSELECT '${id}'::uuid[\\s\\S]*?WHERE ([\\s\\S]*?)ON CONFLICT DO NOTHING;`,
    );
    const pm = rest.match(permRe);
    const clause = pm ? pm[1] : '';
    const codes = [...clause.matchAll(/'([a-z_.]+)'/g)].map((x) => x[1]);
    const isExclusion = /NOT IN/.test(clause);
    roles.push({ id, tenantId, name, description, codes, isExclusion });
  }
  return roles;
}
