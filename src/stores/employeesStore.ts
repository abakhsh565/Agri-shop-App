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
  /** Present when the row came from get_shop_members(). */
  membership_status?: MembershipStatus;
  branch_scope?: string[] | null;
  role_id?: string | null;
  access_kind?: string | null;
}

// `membershipStatus` comes from the memberships table, not from `users` — that
// table has no status column, and memberships is what authorization reads. It is
// the authoritative invite/active state the owner sees.
function userFromRow(
  r: UserRow,
  membershipStatus?: MembershipStatus,
  branchScope?: string[] | null,
  roleName?: string | null
): User {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    role: r.role,
    isOriginalOwner: r.is_original_owner,
    isActive: r.is_active,
    membershipStatus,
    // Which branch(es) the membership is placed in. An invitation that has not been
    // accepted yet is placed in exactly the branches chosen when it was sent, and that
    // placement is the only thing that says which branch's team screen it belongs on.
    branchScope: branchScope ?? null,
    roleName: roleName ?? null,
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

/** One branch's role for this person. `roleId` null means the membership default applies. */
export interface EmployeeBranchRole {
  roleId: string | null;
  roleName: string | null;
}

/** One row of an employee's performance, for one branch or for the whole business. */
export interface EmployeePerformanceLine {
  branchId: string | null;
  branchName: string | null;
  roleId: string | null;
  roleName: string | null;
  salesCount: number;
  revenue: number;
  itemsSold: number;
  customers: number;
  todaySales: number;
  todayRevenue: number;
}

/** What the owner's employee sheet reads: one person, every branch, and the recent sales. */
export interface EmployeePerformance {
  totals: Omit<EmployeePerformanceLine, "branchId" | "branchName" | "roleId" | "roleName">;
  branches: EmployeePerformanceLine[];
  recent: Array<{
    id: string;
    customerName: string;
    totalAmount: number;
    paymentType: string;
    createdAt: string;
    branchId: string | null;
    branchName: string | null;
    itemCount: number;
  }>;
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
    /** { branchId: roleId }. A branch without an entry uses the default role. */
    branchRoles?: Record<string, string>;
    createdBy?: string | null;
  }) => Promise<User>;
  setActive: (id: string, active: boolean, byUserId?: string | null) => Promise<void>;
  updateAccess: (employeeId: string, input: {
    roleId?: string | null;
    permissions?: string[];
    overrides?: Record<string, boolean>;
    resetOverrides?: boolean;
    branchScope?: string[] | null;
  }) => Promise<void>;
  /** { branchId: roleId }. Its keys become the member's branch scope. */
  setBranchRoles: (employeeId: string, branchRoles: Record<string, string>) => Promise<void>;
  loadEmployeePermissions: (employeeId: string) => Promise<string[]>;
  getEmployeeAccess: (employeeId: string) => Promise<{
    roleId: string | null;
    membershipRole: MembershipRole;
    branchScope: string[] | null;
    defaults: string[];
    overrides: Record<string, boolean>;
    effective: string[];
    branchRoles: Record<string, EmployeeBranchRole>;
  }>;
  /** One employee's sales, grouped by branch plus a total. Owner/admin only, enforced by the RPC. */
  getEmployeePerformance: (employeeId: string) => Promise<EmployeePerformance>;
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
    // Authorization, not RLS row visibility, decides this directory. A person whose home shop
    // is another shop still has a membership here, and get_shop_members() returns exactly this
    // shop's memberships so their invitation is visible to the inviter.
    const { data, error } = await supabase.rpc("get_shop_members");
    if (!isDataContextCurrent(context)) return;
    if (error) {
      set({ loading: false, ready: true, error: error.message });
      return;
    }
    const rows = (data ?? []) as UserRow[];
    const roleIdByUser = new Map<string, string>();
    for (const row of rows) {
      if (row.role_id) roleIdByUser.set(row.id, row.role_id);
    }

    // The name behind each default role, in ONE read. The alternative — asking
    // `get_employee_access` once per row — is an RPC per employee just to print a directory, and
    // it fails for a viewer who may see the team but not inspect each person's access. A failed
    // read leaves the name null, and the screen falls back to the job title rather than inventing
    // one.
    const roleNameById = new Map<string, string>();
    const roleIds = [...new Set(roleIdByUser.values())];
    if (roleIds.length > 0) {
      const { data: roleRows } = await supabase.from("roles").select("id, name").in("id", roleIds);
      if (!isDataContextCurrent(context)) return;
      for (const role of (roleRows ?? []) as Array<{ id: string; name: string }>) {
        roleNameById.set(role.id, role.name);
      }
    }

    set({
      // The original owner has a dedicated owner workspace. Co-Owners have their own
      // delegation screens. Neither is an employee row, even though both have a
      // membership in the same business.
      employees: rows
        .filter((r) => !r.is_original_owner && r.access_kind !== "co_owner")
        .map((r) =>
        userFromRow(
          r,
          r.membership_status,
          r.branch_scope ?? null,
          roleIdByUser.has(r.id) ? roleNameById.get(roleIdByUser.get(r.id) as string) ?? null : null
        )
      ),
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
        // Only send this key when the caller actually selected per-branch roles. Sending
        // JSON null makes `payload->'branchRoles'` a JSON null value (not SQL NULL), which
        // create_employee_core correctly refuses because it is not an object.
        ...(input.branchRoles ? { branchRoles: input.branchRoles } : {}),
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

  setBranchRoles: async (employeeId, branchRoles) => {
    const { error } = await supabase.rpc("set_employee_branch_roles", {
      p_employee_id: employeeId,
      p_branch_roles: branchRoles,
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
      branchRoles: data?.branchRoles && typeof data.branchRoles === "object" ? data.branchRoles : {},
    };
  },

  getEmployeePerformance: async (employeeId) => {
    const { data, error } = await supabase.rpc("get_employee_performance", { p_employee_id: employeeId });
    if (error) throw new Error(error.message);
    const number = (v: unknown) => Number(v ?? 0);
    return {
      totals: {
        salesCount: number(data?.totals?.salesCount),
        revenue: number(data?.totals?.revenue),
        itemsSold: number(data?.totals?.itemsSold),
        customers: number(data?.totals?.customers),
        todaySales: number(data?.totals?.todaySales),
        todayRevenue: number(data?.totals?.todayRevenue),
      },
      branches: Array.isArray(data?.branches)
        ? data.branches.map((b: any) => ({
            branchId: b.branchId ?? null,
            branchName: b.branchName ?? null,
            roleId: b.roleId ?? null,
            roleName: b.roleName ?? null,
            salesCount: number(b.salesCount),
            revenue: number(b.revenue),
            itemsSold: number(b.itemsSold),
            customers: number(b.customers),
            todaySales: number(b.todaySales),
            todayRevenue: number(b.todayRevenue),
          }))
        : [],
      recent: Array.isArray(data?.recent)
        ? data.recent.map((s: any) => ({
            id: s.id,
            customerName: s.customerName ?? "",
            totalAmount: number(s.totalAmount),
            paymentType: s.paymentType ?? "full",
            createdAt: s.createdAt ?? "",
            branchId: s.branchId ?? null,
            branchName: s.branchName ?? null,
            itemCount: number(s.itemCount),
          }))
        : [],
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
