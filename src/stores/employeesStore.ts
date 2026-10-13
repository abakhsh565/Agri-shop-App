import { create } from "zustand";
import { captureDataContext, isDataContextCurrent } from "@/lib/localCache";
import { supabase } from "@/lib/supabase";
import type { User, UserRole, MembershipRole, MembershipStatus } from "@/types";

// Employees ARE rows in the `users` table (the same table auth resolves login
// against). Admins manage them; RLS lets admins read/insert/update all users.

interface UserRow {
  id: string;
  name: string;
  phone: string;
  role: UserRole;
  is_original_owner: boolean;
  is_active: boolean;
  employee_number: string | null;
  job_title: string | null;
  photo_url: string | null;
  first_login_at: string | null;
  last_login_at: string | null;
  deactivated_at: string | null;
  deactivated_by: string | null;
  created_by: string | null;
  created_at: string;
}

// `membershipStatus` comes from the memberships table, not from `users` — that
// table has no status column, and memberships is what authorization reads. It is
// the authoritative invite/active state the owner sees.
function userFromRow(r: UserRow, membershipStatus?: MembershipStatus): User {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    role: r.role,
    isOriginalOwner: r.is_original_owner,
    isActive: r.is_active,
    membershipStatus,
    employeeNumber: r.employee_number ?? undefined,
    jobTitle: r.job_title ?? undefined,
    photoUrl: r.photo_url ?? undefined,
    firstLoginAt: r.first_login_at,
    lastLoginAt: r.last_login_at,
    deactivatedAt: r.deactivated_at,
    deactivatedBy: r.deactivated_by,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}


interface EmployeesState {
  employees: User[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  load: () => Promise<void>;
  subscribe: () => () => void;
  createEmployee: (input: {
    name: string;
    phone: string;
    role: Exclude<UserRole, "admin">;
    roleId?: string;
    jobTitle?: string;
    photoUrl?: string;
    /** This employee's exceptions to the role's defaults (code → granted). */
    overrides?: Record<string, boolean>;
    branchScope?: string[] | null;
    createdBy?: string | null;
  }) => Promise<User>;
  assignBranch: (employeeId: string, branchId: string, action: "add" | "move") => Promise<void>;
  setActive: (id: string, active: boolean, byUserId?: string | null) => Promise<void>;
  updateAccess: (employeeId: string, input: {
    roleId?: string | null;
    permissions?: string[];
    overrides?: Record<string, boolean>;
    resetOverrides?: boolean;
    branchScope?: string[] | null;
  }) => Promise<void>;
  loadEmployeePermissions: (employeeId: string) => Promise<string[]>;
  getEmployeeAccess: (employeeId: string) => Promise<{ roleId: string | null; membershipRole: MembershipRole; branchScope: string[] | null; defaults: string[]; overrides: Record<string, boolean>; effective: string[] }>;
  /** Drop every row: the app is about to read a different shop. */
  reset: () => void;
}

let channel: ReturnType<typeof supabase.channel> | null = null;

export const useEmployeesStore = create<EmployeesState>((set, get) => ({
  employees: [],
  loading: false,
  ready: false,
  error: null,

  // The active shop changed: the previous shop's staff list must not be shown as this one's.
  reset: () => set({ employees: [], loading: false, ready: false, error: null }),

  load: async () => {
    const context = captureDataContext();
    if (!isDataContextCurrent(context)) return;
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("created_at", { ascending: true });
    if (!isDataContextCurrent(context)) return;
    if (error) {
      set({ loading: false, ready: true, error: error.message });
      return;
    }
    // Read the membership status alongside, so the list can distinguish an
    // invitation that has not been accepted from an employee who works here.
    const { data: memberships } = await supabase
      .from("memberships")
      .select("user_id, status");
    if (!isDataContextCurrent(context)) return;
    const statusByUser = new Map<string, MembershipStatus>(
      (memberships ?? []).map((m) => [m.user_id as string, m.status as MembershipStatus])
    );
    set({
      employees: (data as UserRow[]).map((r) => userFromRow(r, statusByUser.get(r.id))),
      loading: false,
      ready: true,
    });
  },

  subscribe: () => {
    if (channel) return () => {};
    channel = supabase
      .channel("employees-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "users" },
        async () => { await get().load(); }
      )
      .subscribe();
    return () => {
      if (channel) { supabase.removeChannel(channel); channel = null; }
    };
  },

  assignBranch: async (employeeId, branchId, action) => {
    const { error } = await supabase.rpc("assign_employee_branch", {
      p_employee_id: employeeId, p_branch_id: branchId, p_action: action,
    });
    if (error) throw new Error(error.message);
    await get().load();
  },

  createEmployee: async (input) => {
    const { data, error } = await supabase.rpc("create_employee", {
      payload: {
        name: input.name,
        phone: input.phone,
        role: input.role,
        // No membership role is sent: it is an authorization input that the
        // database derives (migration 0131).
        roleId: input.roleId ?? null,
        jobTitle: input.jobTitle ?? null,
        photoUrl: input.photoUrl ?? null,
        overrides: input.overrides ?? null,
        branchScope: input.branchScope ?? null,
        createdBy: input.createdBy ?? null,
      },
    });
    if (error) throw new Error(error.message);
    await get().load();
    const created = get().employees.find((e) => e.id === data.id);
    return created!;
  },

  updateAccess: async (employeeId, input) => {
    const { error } = await supabase.rpc("update_employee_access", {
      payload: {
        employeeId,
        roleId: input.roleId ?? undefined,
        permissions: input.permissions ?? undefined,
        overrides: input.overrides ?? undefined,
        resetOverrides: input.resetOverrides ?? undefined,
        branchScope: input.branchScope === undefined ? undefined : input.branchScope,
      },
    });
    if (error) throw new Error(error.message);
    await get().load();
  },

  getEmployeeAccess: async (employeeId) => {
    const { data, error } = await supabase.rpc("get_employee_access", { p_employee_id: employeeId });
    if (error) throw new Error(error.message);
    return {
      roleId: data?.roleId ?? null,
      membershipRole: (data?.membershipRole ?? "employee") as MembershipRole,
      branchScope: data?.branchScope ?? null,
      defaults: Array.isArray(data?.defaults) ? data.defaults : [],
      overrides: data?.overrides && typeof data.overrides === "object" ? data.overrides : {},
      effective: Array.isArray(data?.effective) ? data.effective : [],
    };
  },

  loadEmployeePermissions: async (employeeId) => {
    // For the current user, use get_my_permissions().
    // For other employees, query user_permissions directly.
    const currentUser = (await import("@/stores/authStore")).useAuthStore.getState().user;
    if (currentUser?.id === employeeId) {
      const { data } = await supabase.rpc("get_my_permissions");
      return Array.isArray(data) ? data : [];
    }
    // Query via direct table access (RLS allows admin to see same-tenant users)
    const { data } = await supabase
      .from("user_permissions")
      .select("permissions(code)")
      .eq("user_id", employeeId);
    if (!data) return [];
    return data.map((r: any) => r.permissions?.code).filter(Boolean);
  },

  setActive: async (id, active, byUserId) => {
    // Use backend RPC instead of direct UPDATE.
    // RPC handles: admin auth, tenant isolation, membership sync, audit logging.
    const rpcName = active ? "activate_employee_v1" : "deactivate_employee_v1";
    const { data, error } = await supabase.rpc(rpcName, {
      payload: { employeeId: id },
    });
    if (error) throw new Error(error.message);
    // Reload to get fresh state from DB (membership status, timestamps, etc.)
    await get().load();
  },
}));
