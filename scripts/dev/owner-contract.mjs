/**
 * owner-contract.mjs — the Owner/role rules as a PURE function of what the database returned.
 *
 * Kept separate from any CLI so a unit test can exercise the decision without a connection, and so the
 * checker and the repairer cannot disagree about what "broken" means.
 *
 * THE RULES, each traced to a migration
 *   security  one Owner per business (owner's rule; nothing enforces it yet — see below);
 *             `users.is_original_owner` and the membership role must agree (0113/0110 derive the role
 *             from the flag);
 *             an owner membership must not contradict `tenants.owner_id`;
 *             a membership's role must exist and belong to the SAME tenant (0108's scoping, 0183's FK);
 *   fixture   an ACTIVE non-owner membership with `role_id = NULL` resolves to zero permissions:
 *             migration 0165 grants "all permissions" only to membership role `owner`, so such an
 *             account signs in and is refused every action. This is the defect class that produced
 *             `NOT_AUTHORIZED: missing permission …` across the suites;
 *   canonical the four built-in roles 0107 seeds must exist in a tenant whose callers reference them,
 *             because `delete_role` (0183) clears the memberships that pointed at a deleted role and
 *             the app's own microcopy promises the built-in set can be recreated.
 */

export const CANONICAL_DRIFT = 'canonical';

export function classifyOwnerContract(data) {
  const security = [];
  const fixture = [];
  const canonical = [];
  const notes = [];

  const {
    tenants = [],
    memberships = [],
    users = [],
    roles = [],
    permissionCodes = [],
    ownerConstraintCount = null,
    canonicalDefinitions = [],
    missingCanonical = () => [],
    canonicalTenantIds = null,
  } = data;

  const roleById = new Map(roles.map((r) => [r.id, r]));

  // "Enforced by the database, not just the UI" is the owner's requirement, so the absence of an
  // enforcing constraint is itself a finding rather than an implementation detail.
  if (ownerConstraintCount === 0) {
    security.push("nothing in the schema enforces one Owner per business — no partial unique index on memberships(tenant_id) where role = 'owner'");
  }

  const ownersByTenant = new Map();
  for (const m of memberships) {
    if (m.role !== 'owner') continue;
    ownersByTenant.set(m.tenant_id, [...(ownersByTenant.get(m.tenant_id) ?? []), m]);
  }

  for (const tenant of tenants) {
    const owners = ownersByTenant.get(tenant.id) ?? [];
    if (owners.length === 0) {
      security.push(`tenant ${tenant.name} (${tenant.id}) has NO owner membership — nobody can administer it`);
    } else if (owners.length > 1) {
      security.push(`tenant ${tenant.name} (${tenant.id}) has ${owners.length} owner memberships (${owners.map((o) => o.user_name).join(', ')}) — there must be exactly one Owner per business`);
    }
  }

  for (const u of users) {
    const own = memberships.filter((m) => m.user_id === u.id);
    if (u.is_original_owner && own.length && !own.some((m) => m.role === 'owner')) {
      security.push(`user ${u.name} (${u.phone}) carries is_original_owner=true but holds no owner membership — roles: ${own.map((m) => m.role).join(', ')}`);
    }
    if (!u.is_original_owner && own.some((m) => m.role === 'owner')) {
      security.push(`user ${u.name} (${u.phone}) holds an OWNER membership without is_original_owner — ownership must not be reachable by claiming it`);
    }
    for (const m of own.filter((x) => x.role === 'owner')) {
      const tenant = tenants.find((t) => t.id === m.tenant_id);
      if (tenant?.owner_id && tenant.owner_id !== u.id) {
        security.push(`user ${u.name} (${u.phone}) holds an OWNER membership in ${tenant.name} whose recorded owner is another account (${tenant.owner_id})`);
      }
    }
  }

  for (const m of memberships) {
    if (m.role === 'owner') {
      if (m.role_id !== null) {
        notes.push(`owner membership ${m.user_name ?? m.user_id} in ${m.tenant_id} carries a role_id — the Owner is not restricted by a matrix, so this column is ignored for owners`);
      }
      continue;
    }
    if (m.status !== 'active') continue;
    if (m.role_id === null) {
      fixture.push(`active ${m.role} membership for ${m.user_name ?? m.user_id} has NO role_id — resolves to zero permissions, so a working account is refused every action (migration 0165 grants "all permissions" only to role owner)`);
      continue;
    }
    const role = roleById.get(m.role_id);
    if (!role) {
      security.push(`membership for ${m.user_name ?? m.user_id} points at role ${m.role_id}, which does not exist`);
    } else if (role.tenant_id !== m.tenant_id) {
      security.push(`membership for ${m.user_name ?? m.user_id} in ${m.tenant_id} points at role "${role.name}" owned by tenant ${role.tenant_id} — a role must never cross a tenant boundary`);
    }
  }

  // Built-in role drift. Only the tenants that were asked about, because a tenant whose roles nobody
  // references can legitimately have removed them (the microcopy says so).
  for (const tenantId of canonicalTenantIds ?? tenants.map((t) => t.id)) {
    const missing = missingCanonical(tenantId, roles, canonicalDefinitions);
    for (const definition of missing) {
      canonical.push(`tenant ${tenantId} is missing the built-in role "${definition.name}" — a caller that resolves it is refused, and every membership it carried was cleared to role_id = NULL when it was deleted (0183). The NAME is the requirement; the id 0107 used is only reusable when it is free, since roles.id is one global key`);
    }
  }

  const failures = [...security, ...fixture, ...canonical];
  return { ok: failures.length === 0, failures, security, fixture, canonical, notes, permissionCodes };
}
