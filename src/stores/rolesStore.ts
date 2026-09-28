import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { getCurrentTenantId } from "@/lib/tenantContext";
import type { Role } from "@/types";

interface RoleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

interface RolesState {
  roles: Role[];
  loading: boolean;
  ready: boolean;
  load: () => Promise<void>;
  createRole: (input: { name: string; description?: string; permissions: string[] }) => Promise<Role>;
  updateRole: (roleId: string, input: { name?: string; description?: string; permissions?: string[] }) => Promise<void>;
  deleteRole: (roleId: string) => Promise<void>;
  getRolePermissions: (roleId: string) => Promise<string[]>;
  /**
   * The same read, but a failure is *reported* instead of being returned as "this role grants
   * nothing". Every editor used to open on `getRolePermissions`, which answers `[]` both for a
   * role with no access and for a request that never succeeded — so a slow or failed read
   * painted forty unticked boxes, which is indistinguishable from a deliberate answer.
   */
  loadRolePermissions: (roleId: string) => Promise<{ codes: string[]; error: string | null }>;
  getRoleMemberCount: (roleId: string) => Promise<number>;
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
    const tenantId = getCurrentTenantId();
    set({ loading: true });
    if (!tenantId) {
      set({ roles: [], loading: false, ready: true });
      return;
    }
    const { data, error } = await supabase
      .from("roles")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name");
    if (error) {
      set({ loading: false, ready: true });
      return;
    }

    const roles: Role[] = (data as RoleRow[]).map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      description: r.description,
      isSystem: r.is_system,
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

    set({ roles, loading: false, ready: true });
  },

  createRole: async (input) => {
    const { data, error } = await supabase.rpc("create_role", {
      payload: { name: input.name, description: input.description ?? null, permissions: input.permissions },
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

  loadRolePermissions: async (roleId) => {
    const { data, error } = await supabase
      .from("role_permissions")
      .select("permissions(code)")
      .eq("role_id", roleId);
    if (error) return { codes: [], error: error.message };
    return { codes: ((data as any[]) ?? []).map((r) => r.permissions?.code).filter(Boolean), error: null };
  },

  getRoleMemberCount: async (roleId) => {
    const { count } = await supabase
      .from("memberships")
      .select("*", { count: "exact", head: true })
      .eq("role_id", roleId)
      .eq("status", "active");
    return count ?? 0;
  },
}));
