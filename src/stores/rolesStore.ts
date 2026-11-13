import { create } from "zustand";
import { captureDataContext, isDataContextCurrent, whenDataContextConfirmed } from "@/lib/localCache";
import { supabase } from "@/lib/supabase";
import { getCurrentTenantId } from "@/lib/tenantContext";
import type { Role, RoleCategory, RoleDataScope, RoleLevel } from "@/types";

interface RoleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  department_id: string | null;
  role_category: RoleCategory | null;
  responsibility_level: RoleLevel | null;
  created_at: string;
  updated_at: string;
  /** Embedded by PostgREST through roles.department_id (migration 0250). */
  departments?: { code: string; name_en: string; name_ur: string } | null;
}

interface RolesState {
  roles: Role[];
  loading: boolean;
  ready: boolean;
  load: () => Promise<void>;
  createRole: (input: {
    name: string;
    description?: string;
    permissions: string[];
    departmentId?: string | null;
    dataScope?: RoleDataScope;
    roleCategory?: RoleCategory | null;
    responsibilityLevel?: RoleLevel | null;
    dashboards?: string[];
  }) => Promise<Role>;
  updateRole: (roleId: string, input: {
    name?: string;
    description?: string;
    permissions?: string[];
    departmentId?: string | null;
    dataScope?: RoleDataScope;
    roleCategory?: RoleCategory | null;
    responsibilityLevel?: RoleLevel | null;
    dashboards?: string[];
  }) => Promise<void>;
  /**
   * Everything the role screen opens on: permissions, department and dashboard rows in
   * one read (migration 0250's `get_role_access`). Reading them separately let the
   * editor paint one answer while the other was still in flight.
   */
  loadRoleAccess: (roleId: string) => Promise<{
    permissions: string[];
    dashboards: string[];
    departmentId: string | null;
    departmentCode: string | null;
    dataScope: RoleDataScope;
    roleCategory: RoleCategory | null;
    responsibilityLevel: RoleLevel | null;
    error: string | null;
  }>;
  deleteRole: (roleId: string) => Promise<void>;
  getRolePermissions: (roleId: string) => Promise<string[]>;
  /**
   * The same read, but a failure is *reported* instead of being returned as "this role grants
   * nothing". Every editor used to open on `getRolePermissions`, which answers `[]` both for a
   * role with no access and for a request that never succeeded — so a slow or failed read
   * painted forty unticked boxes, which is indistinguishable from a deliberate answer.
   */
  loadRolePermissions: (roleId: string) => Promise<{ codes: string[]; error: string | null }>;
  /**
   * How many people hold this role.
   *
   * With a `branchId` the answer is the branch's own figure: a role is granted per branch, so
   * counting the tenant's memberships made a branch that says "0 employees" list "Sales Manager ·
   * 1 employee" directly underneath. Without one it stays the shop-wide number the roles screen
   * asks for.
   */
  getRoleMemberCount: (roleId: string) => Promise<number>;
  /**
   * How many people hold each role AT one branch, keyed by role id.
   *
   * A branch page states a headcount for the branch, so the rows under it have to be counted from
   * the same population that number counts (`get_my_branches().employee_count`, migration 0244):
   * an active member belongs where their branch scope or a per-branch role places them, whoever
   * the roster places nowhere belongs to the main branch, and their role there is the per-branch
   * grant when one exists and the membership's own role otherwise. Counting the shop's
   * memberships instead put "Sales Manager · 1 employee" under a branch reading "0 employees".
   */
  getBranchRoleCounts: (branchId: string, isMain: boolean) => Promise<Record<string, number>>;
  /** Drop every row: the app is about to read a different shop. */
  reset: () => void;
}

export const useRolesStore = create<RolesState>((set, get) => ({
  roles: [],
  loading: false,
  ready: false,

  // The active shop changed: role templates belong to one tenant.
  reset: () => set({ roles: [], loading: false, ready: false }),

  /**
   * Read the roles of the shop the caller is WORKING IN.
   *
   * The filter is the fix, not decoration. Row level security allows an account to read the
   * roles of every shop it belongs to, so this screen used to list another shop's roles while
   * every write — authorized against the ACTIVE shop — refused them: the owner saw four roles,
   * tapped delete, and got "this role is not yours". The list and the writes now agree because
   * both are scoped to the same shop, which is what every other store already does.
   */
  load: async () => {
    // A screen that owns this list (Roles & Access, Add Employee, Employee detail, the branch
    // editor) reads it from its own mount effect, which can run before the shell has confirmed the
    // shop and branch. Dropping that read left the screen on "Loading…" for the rest of the
    // session — measured 2026-10-14: the roles screen made no request at all and never recovered
    // until it was left and re-entered. Waiting for the confirmation is what the read means; it
    // still refuses to publish if the confirmation never comes.
    if (!isDataContextCurrent(captureDataContext()) && !(await whenDataContextConfirmed())) return;
    const context = captureDataContext();
    if (!isDataContextCurrent(context)) return;
    const tenantId = getCurrentTenantId();
    set({ loading: true });
    if (!tenantId) {
      set({ roles: [], loading: false, ready: true });
      return;
    }
    const { data, error } = await supabase
      .from("roles")
      .select("*, departments(code, name_en, name_ur)")
      .eq("tenant_id", tenantId)
      .order("name");
    if (!isDataContextCurrent(context)) return;
    if (error) {
      set({ loading: false, ready: true });
      return;
    }

    const roles: Role[] = (data as unknown as RoleRow[]).map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      description: r.description,
      isSystem: r.is_system,
      departmentId: r.department_id,
      departmentCode: r.departments?.code ?? null,
      roleCategory: r.role_category,
      responsibilityLevel: r.responsibility_level,
      departmentName: r.departments?.name_en ?? null,
      departmentNameUr: r.departments?.name_ur ?? null,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    // Load permission counts for each role
    for (const role of roles) {
      const { count } = await supabase
        .from("role_permissions")
        .select("*", { count: "exact", head: true })
        .eq("role_id", role.id);
      role.permissionCount = count ?? 0;
    }

    if (!isDataContextCurrent(context)) return;
    set({ roles, loading: false, ready: true });
  },

  createRole: async (input) => {
    const { data, error } = await supabase.rpc("create_role", {
      payload: {
        name: input.name,
        description: input.description ?? null,
        permissions: input.permissions,
        departmentId: input.departmentId ?? null,
        dataScope: input.dataScope ?? "business",
        roleCategory: input.roleCategory ?? "other",
        responsibilityLevel: input.responsibilityLevel ?? "individual_contributor",
        ...(input.dashboards !== undefined ? { dashboards: input.dashboards } : {}),
      },
    });
    if (error) throw new Error(error.message);
    await get().load();
    return get().roles.find((r) => r.id === data.id)!;
  },

  updateRole: async (roleId, input) => {
    const payload: Record<string, unknown> = { roleId };
    if (input.name !== undefined) payload.name = input.name;
    if (input.description !== undefined) payload.description = input.description;
    if (input.permissions !== undefined) payload.permissions = input.permissions;
    if (input.departmentId !== undefined) payload.departmentId = input.departmentId;
    if (input.dataScope !== undefined) payload.dataScope = input.dataScope;
    if (input.roleCategory !== undefined) payload.roleCategory = input.roleCategory;
    if (input.responsibilityLevel !== undefined) payload.responsibilityLevel = input.responsibilityLevel;
    if (input.dashboards !== undefined) payload.dashboards = input.dashboards;
    const { error } = await supabase.rpc("update_role", { payload });
    if (error) throw new Error(error.message);
    await get().load();
  },

  deleteRole: async (roleId) => {
    const { error } = await supabase.rpc("delete_role", { payload: { roleId } });
    if (error) throw new Error(error.message);
    await get().load();
  },

  getRolePermissions: async (roleId) => {
    const { data } = await supabase
      .from("role_permissions")
      .select("permissions(code)")
      .eq("role_id", roleId);
    if (!data) return [];
    return data.map((r: any) => r.permissions?.code).filter(Boolean);
  },

  loadRoleAccess: async (roleId) => {
    const { data, error } = await supabase.rpc("get_role_access", { p_role_id: roleId });
    if (error) {
      return { permissions: [], dashboards: [], departmentId: null, departmentCode: null, dataScope: "business", roleCategory: null, responsibilityLevel: null, error: error.message };
    }
    const row = (data ?? {}) as {
      permissions?: string[];
      dashboards?: string[];
      departmentId?: string | null;
      departmentCode?: string | null;
      dataScope?: RoleDataScope;
      roleCategory?: RoleCategory | null;
      responsibilityLevel?: RoleLevel | null;
    };
    return {
      permissions: row.permissions ?? [],
      dashboards: row.dashboards ?? [],
      departmentId: row.departmentId ?? null,
      departmentCode: row.departmentCode ?? null,
      dataScope: row.dataScope ?? "business",
      roleCategory: row.roleCategory ?? null,
      responsibilityLevel: row.responsibilityLevel ?? null,
      error: null,
    };
  },

  loadRolePermissions: async (roleId) => {
    const { data, error } = await supabase
      .from("role_permissions")
      .select("permissions(code)")
      .eq("role_id", roleId);
    if (error) return { codes: [], error: error.message };
    return { codes: ((data as any[]) ?? []).map((r) => r.permissions?.code).filter(Boolean), error: null };
  },

  getRoleMemberCount: async (roleId) => {
    // Pending invitations count too: deleting a role clears it from those memberships,
    // so the confirmation must name every person whose access will be revoked.
    const { data, count } = await supabase
      .from("memberships")
      .select("id, role_id", { count: "exact" })
      .eq("role_id", roleId);
    if (!data) return count ?? 0;

    // A per-branch role assignment is a real use of the role even when the membership's
    // default role points somewhere else.
    const { count: branchCount } = await supabase
      .from("membership_branch_roles")
      .select("*", { count: "exact", head: true })
      .eq("role_id", roleId);
    return Math.max(count ?? 0, branchCount ?? 0);
  },

  getBranchRoleCounts: async (branchId, isMain) => {
    const tenantId = getCurrentTenantId();
    if (!tenantId) return {};

    // The roster, and every per-branch grant this account may read. Two reads, not one per role:
    // the answer is the same set of people whichever row is being printed.
    const [{ data: members }, { data: grants }] = await Promise.all([
      supabase
        .from("memberships")
        .select("id, role_id, branch_scope")
        .eq("tenant_id", tenantId)
        .eq("status", "active"),
      supabase.from("membership_branch_roles").select("membership_id, branch_id, role_id"),
    ]);

    const scopes = new Map<string, unknown>();
    const ownRole = new Map<string, string | null>();
    for (const row of (members ?? []) as Array<{
      id: string;
      role_id: string | null;
      branch_scope: unknown;
    }>) {
      scopes.set(row.id, row.branch_scope);
      ownRole.set(row.id, row.role_id);
    }

    const placedHere = new Set<string>();
    const placedAnywhere = new Set<string>();
    const roleHere = new Map<string, string>();
    for (const grant of (grants ?? []) as Array<{
      membership_id: string;
      branch_id: string;
      role_id: string;
    }>) {
      if (!scopes.has(grant.membership_id)) continue;
      placedAnywhere.add(grant.membership_id);
      if (grant.branch_id === branchId) {
        placedHere.add(grant.membership_id);
        roleHere.set(grant.membership_id, grant.role_id);
      }
    }
    for (const [membershipId, scope] of scopes) {
      if (Array.isArray(scope) && scope.includes(branchId)) placedHere.add(membershipId);
      if (Array.isArray(scope) && scope.length > 0) placedAnywhere.add(membershipId);
      // The roster places whoever it never assigned on the main branch.
      if (isMain && !placedAnywhere.has(membershipId)) placedHere.add(membershipId);
    }

    const counts: Record<string, number> = {};
    for (const membershipId of placedHere) {
      const roleId = roleHere.get(membershipId) ?? ownRole.get(membershipId) ?? null;
      if (roleId) counts[roleId] = (counts[roleId] ?? 0) + 1;
    }
    return counts;
  },
}));
