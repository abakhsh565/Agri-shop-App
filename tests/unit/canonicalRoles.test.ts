import { describe, it, expect } from 'vitest';
import {
  CANONICAL_ROLE_DEFINITIONS,
  CANONICAL_TENANT,
  livePermissionCodesFor,
  missingCanonicalRoles,
  parse0107Seed,
  permissionCodesFor,
} from '../../scripts/dev/canonical-roles.mjs';
import { classifyOwnerContract } from '../../scripts/dev/owner-contract.mjs';

/**
 * THE DEFECT THIS PREVENTS
 *
 *   On 2026-10-04 03:18:22Z the built-in "Sales Employee" role was deleted in the demo tenant by the
 *   owner, through the app's own screen — intended behaviour. `delete_role` (0183) cleared
 *   `memberships.role_id` to NULL for its two members, which were the two employee fixtures every lane
 *   signs in with; those accounts then authenticated and authorized nothing, and four suites kept
 *   assigning a role id that no longer existed in their tenant. The audit row says it plainly:
 *   { revokedFrom: 2, wasSystemRole: true }.
 *
 *   Two things are therefore worth a guard. First, the copy of the built-in role set that the repair
 *   tool uses must still agree with the migration that defines it, or a "repair" silently installs
 *   different permissions than the product ships. Second, the classifier that decides whether a tenant
 *   is missing those roles — and whether a membership can authorize anything at all — must hold on the
 *   rows that actually occurred, not on a happy path.
 */

describe('the canonical role data agrees with migration 0107', () => {
  const seeded = parse0107Seed();

  it('reads the same four roles out of the migration', () => {
    expect(seeded).toHaveLength(4);
    expect(seeded.map((r) => r.name)).toEqual([
      'Sales Employee',
      'Sales Manager',
      'Store Manager',
      'Inventory Clerk',
    ]);
    for (const role of seeded) expect(role.tenantId).toBe(CANONICAL_TENANT);
  });

  it('matches every id, name and description in the definition module', () => {
    // Non-vacuity: the parser found four roles above, so this comparison is not against an empty list.
    for (const definition of CANONICAL_ROLE_DEFINITIONS) {
      const role = seeded.find((r) => r.name === definition.name);
      expect(role, `migration 0107 no longer seeds "${definition.name}"`).toBeTruthy();
      expect(role!.id).toBe(definition.id);
      expect(role!.description).toBe(definition.description);
    }
  });

  it('matches every permission set, including the exclusion-shaped one', () => {
    for (const definition of CANONICAL_ROLE_DEFINITIONS) {
      const role = seeded.find((r) => r.name === definition.name)!;
      if (definition.include === null) {
        // Store Manager is written as "everything except …", so the migration carries the exclusions.
        expect(role.isExclusion, `${definition.name} should be written with NOT IN`).toBe(true);
        expect(role.codes.sort()).toEqual([...definition.exclude].sort());
      } else {
        expect(role.isExclusion).toBe(false);
        expect(role.codes.sort()).toEqual([...definition.include].sort());
      }
    }
  });

  it('resolves a definition against a real permission catalogue', () => {
    const catalogue = ['a.view', 'a.edit', 'employees.manage', 'settings.edit', 'employees.view'];
    const employee = CANONICAL_ROLE_DEFINITIONS.find((d) => d.name === 'Sales Employee')!;
    const manager = CANONICAL_ROLE_DEFINITIONS.find((d) => d.name === 'Store Manager')!;
    // An included code that the catalogue lacks is dropped rather than inserted as nothing.
    expect(permissionCodesFor(employee, catalogue)).toEqual([]);
    expect(permissionCodesFor(manager, catalogue)).toEqual(['a.view', 'a.edit']);
  });

  it('withholds the permissions a later migration revoked from every role', () => {
    // 0285 deleted customers.delete from every role's grants (only the owner's
    // implicit authority reaches it now). The 0107 seed still lists it, and
    // the pin above keeps the definition honest about that — so the live set
    // the restore tool writes must drop it, or a --reset-grants pass would
    // silently re-add a revoked permission.
    const catalogue = ['customers.view', 'customers.create', 'customers.delete', 'sales.view'];
    const manager = CANONICAL_ROLE_DEFINITIONS.find((d) => d.name === 'Store Manager')!;
    expect(permissionCodesFor(manager, catalogue)).toContain('customers.delete');
    expect(livePermissionCodesFor(manager, catalogue)).not.toContain('customers.delete');
    expect(livePermissionCodesFor(manager, catalogue).sort()).toEqual(
      ['customers.create', 'customers.view', 'sales.view'],
    );
  });
});

describe('missingCanonicalRoles', () => {
  const roles = [
    { tenant_id: CANONICAL_TENANT, name: 'Sales Manager' },
    { tenant_id: CANONICAL_TENANT, name: 'Store Manager' },
    { tenant_id: CANONICAL_TENANT, name: 'Inventory Clerk' },
  ];

  it('reports the role that the deletion removed, and only that one', () => {
    const missing = missingCanonicalRoles(CANONICAL_TENANT, roles);
    expect(missing.map((d) => d.name)).toEqual(['Sales Employee']);
  });

  it('is satisfied by a role of the same NAME under a different id', () => {
    // 0107 inserts with ON CONFLICT (tenant_id, name) DO NOTHING, and roles.id is one global key — so
    // a tenant that holds "Sales Employee" under a recreated id is legitimate, not drift.
    const renamed = [...roles, { tenant_id: CANONICAL_TENANT, name: 'Sales Employee', id: 'other-id' }];
    expect(missingCanonicalRoles(CANONICAL_TENANT, renamed)).toEqual([]);
  });

  it('is tenant-scoped', () => {
    const otherTenant = '1e5f7e4b-7ed0-4787-8148-8f289fc1c107';
    const withOtherTenantsRole = [...roles, { tenant_id: otherTenant, name: 'Sales Employee' }];
    expect(missingCanonicalRoles(CANONICAL_TENANT, withOtherTenantsRole).map((d) => d.name)).toEqual(['Sales Employee']);
  });
});

describe('the owner-contract classifier', () => {
  const tenant = { id: CANONICAL_TENANT, name: 'Default Shop', owner_id: null };
  const role = { id: 'role-1', tenant_id: CANONICAL_TENANT, name: 'Sales Manager' };
  const ownerUser = { id: 'u-owner', name: 'Owner', phone: '923001234567', is_original_owner: true };
  const employeeUser = { id: 'u-emp', name: 'Employee', phone: '923001122334', is_original_owner: false };
  const ownerMembership = { id: 'm1', user_id: 'u-owner', tenant_id: CANONICAL_TENANT, role: 'owner', status: 'active', role_id: null, user_name: 'Owner' };

  const base = {
    tenants: [tenant],
    memberships: [ownerMembership],
    users: [ownerUser],
    roles: [role],
    permissionCodes: ['sales.view'],
    ownerConstraintCount: 1,
    canonicalDefinitions: CANONICAL_ROLE_DEFINITIONS,
    canonicalTenantIds: [CANONICAL_TENANT],
    missingCanonical: missingCanonicalRoles,
  };

  it('flags a tenant whose built-in role was deleted', () => {
    const result = classifyOwnerContract({
      ...base,
      roles: [{ ...role, name: 'Sales Manager' }],
      canonicalTenantIds: [CANONICAL_TENANT],
    });
    expect(result.canonical.join(' ')).toContain('Sales Employee');
    expect(result.ok).toBe(false);
  });

  it('flags an active employee membership that resolves to nothing', () => {
    const result = classifyOwnerContract({
      ...base,
      memberships: [ownerMembership, { id: 'm2', user_id: 'u-emp', tenant_id: CANONICAL_TENANT, role: 'employee', status: 'active', role_id: null, user_name: 'Employee' }],
      users: [ownerUser, employeeUser],
    });
    expect(result.fixture.join(' ')).toContain('NO role_id');
    expect(result.ok).toBe(false);
  });

  it('flags a second owner in the same business', () => {
    const result = classifyOwnerContract({
      ...base,
      memberships: [ownerMembership, { ...ownerMembership, id: 'm3', user_id: 'u-emp', user_name: 'Employee', user_phone: '923001122334' }],
      users: [ownerUser, { ...employeeUser, is_original_owner: true }],
    });
    expect(result.security.join(' ')).toContain('exactly one Owner per business');
  });

  it('flags a role that crosses a tenant boundary', () => {
    const result = classifyOwnerContract({
      ...base,
      memberships: [ownerMembership, { id: 'm4', user_id: 'u-emp', tenant_id: CANONICAL_TENANT, role: 'employee', status: 'active', role_id: 'role-from-B', user_name: 'Employee' }],
      users: [ownerUser, employeeUser],
      roles: [role, { id: 'role-from-B', tenant_id: 'other-tenant', name: 'Sales Employee' }],
      canonicalTenantIds: [],
    });
    expect(result.security.join(' ')).toContain('cross a tenant boundary');
  });

  it('passes a tenant that is intact on every rule', () => {
    // "Intact" includes holding every built-in role, so the fixture supplies the full set — the earlier
    // cases in this block deliberately leave one out, which is what makes the canonical rule fire.
    const allBuiltIns = CANONICAL_ROLE_DEFINITIONS.map((d) => ({
      id: `id-${d.name}`,
      tenant_id: CANONICAL_TENANT,
      name: d.name,
    }));
    const result = classifyOwnerContract({
      ...base,
      roles: [...allBuiltIns, role],
      memberships: [
        ownerMembership,
        { id: 'm5', user_id: 'u-emp', tenant_id: CANONICAL_TENANT, role: 'employee', status: 'active', role_id: 'role-1', user_name: 'Employee' },
      ],
      users: [ownerUser, employeeUser],
    });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });
});
