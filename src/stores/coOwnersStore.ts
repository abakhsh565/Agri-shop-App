import { create } from "zustand";
import { supabase } from "@/lib/supabase";

export type CoOwnerStatus = "invited" | "active" | "suspended" | "revoked";
export type AuthorityMode = "allowed" | "approval_required" | "restricted";

export interface CoOwnerScopes {
  branchesMode: "all" | "selected" | "none";
  suppliersMode: "all" | "selected" | "none";
  departmentsMode: "all" | "selected" | "none";
  recordsMode: "all" | "selected" | "none";
  brandsMode?: "none";
  branchIds: string[];
  supplierIds: string[];
  departmentIds: string[];
  customerIds: string[];
  recordSupplierIds: string[];
}

export interface CoOwnerSummary {
  id: string;
  status: CoOwnerStatus;
  userId: string;
  name: string;
  phone: string;
  photoUrl: string | null;
  jobTitle: string | null;
  lastLoginAt: string | null;
  invitedAt: string;
  activatedAt: string | null;
  suspendedAt: string | null;
  revokedAt: string | null;
  revocationReason: string | null;
  permissions: string[];
  branches: Array<{ id: string; name: string }>;
  scope: {
    branches_mode: "all" | "selected" | "none";
    suppliers_mode: "all" | "selected" | "none";
    departments_mode: "all" | "selected" | "none";
    records_mode: "all" | "selected" | "none";
    brands_mode: "none";
  } | null;
}

export interface CoOwnerActivity {
  action: string;
  at: string;
  details: Record<string, unknown> | null;
}

/** A Co-Owner as Branch Management sees them: one branch, one operator. */
export interface BranchCoOwner {
  grantId: string;
  name: string;
  phone: string;
  status: Exclude<CoOwnerStatus, "revoked">;
  invitedAt: string;
  activatedAt: string | null;
  suspendedAt: string | null;
  lastLoginAt: string | null;
  isOnlyBranch: boolean;
}

export interface BranchCoOwnerResult {
  branchId: string;
  branchName: string;
  isMain: boolean;
  coOwners: BranchCoOwner[];
}

export interface BranchCoOwnerConfig {
  permissions: string[];
  authorities: Record<string, AuthorityMode>;
  dashboards: string[];
  assignableRoleIds: string[];
  canInviteEmployees: boolean;
  canDeactivateEmployees: boolean;
  canManageBranches: boolean;
}

export interface CoOwnerDetail extends CoOwnerSummary {
  membershipId: string;
  canInviteEmployees: boolean;
  canDeactivateEmployees: boolean;
  canManageBranches: boolean;
  notes: string | null;
  supplierIds: string[];
  departmentIds: string[];
  customerIds: string[];
  recordSupplierIds: string[];
  dashboards: string[];
  authorities: Record<string, AuthorityMode>;
  assignableRoleIds: string[];
  activity: CoOwnerActivity[];
}

export interface InviteCoOwnerInput {
  phone: string;
  name?: string;
  scopes: Omit<CoOwnerScopes, "brandsMode"> & { brandsMode?: "none" };
  permissions: string[];
  authorities: Record<string, AuthorityMode>;
  dashboards: string[];
  assignableRoleIds: string[];
  canInviteEmployees: boolean;
  canDeactivateEmployees: boolean;
  canManageBranches: boolean;
  notes?: string;
}

interface State {
  grants: CoOwnerSummary[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  load: () => Promise<void>;
  get: (id: string) => Promise<CoOwnerDetail>;
  invite: (input: InviteCoOwnerInput) => Promise<{ grantId: string }>;
  update: (grantId: string, input: Partial<InviteCoOwnerInput>) => Promise<void>;
  suspend: (grantId: string, reason?: string) => Promise<void>;
  reactivate: (grantId: string) => Promise<void>;
  restore: (grantId: string) => Promise<void>;
  revoke: (grantId: string, reason: string) => Promise<void>;
  getBranchCoOwners: (branchId: string) => Promise<BranchCoOwnerResult>;
  assignBranchCoOwner: (
    branchId: string,
    name: string,
    phone: string,
    config: BranchCoOwnerConfig,
  ) => Promise<{ grantId: string; branchName: string }>;
}

function normalizeError(error: { message?: string } | null): string {
  return error?.message ?? "UNKNOWN";
}

export const useCoOwnersStore = create<State>((set, get) => ({
  grants: [],
  loading: false,
  ready: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase.rpc("get_co_owner_grants");
    if (error) {
      set({ loading: false, ready: true, error: normalizeError(error) });
      return;
    }
    set({
      grants: (Array.isArray(data) ? data : []) as CoOwnerSummary[],
      loading: false,
      ready: true,
      error: null,
    });
  },

  get: async (id) => {
    const { data, error } = await supabase.rpc("get_co_owner_grant", { p_grant_id: id });
    if (error) throw new Error(error.message);
    return data as CoOwnerDetail;
  },

  invite: async (input) => {
    const { data, error } = await supabase.rpc("create_co_owner_invitation", {
      payload: {
        phone: input.phone,
        name: input.name ?? null,
        scopes: input.scopes,
        permissions: input.permissions,
        authorities: input.authorities,
        dashboards: input.dashboards,
        assignableRoleIds: input.assignableRoleIds,
        canInviteEmployees: input.canInviteEmployees,
        canDeactivateEmployees: input.canDeactivateEmployees,
        canManageBranches: input.canManageBranches,
        notes: input.notes ?? null,
      },
    });
    if (error) throw new Error(error.message);
    await get().load();
    return data as { grantId: string };
  },

  update: async (grantId, input) => {
    const payload: Record<string, unknown> = { grantId };
    if (input.scopes) payload.scopes = input.scopes;
    if (input.permissions) payload.permissions = input.permissions;
    if (input.authorities) payload.authorities = input.authorities;
    if (input.dashboards) payload.dashboards = input.dashboards;
    if (input.assignableRoleIds) payload.assignableRoleIds = input.assignableRoleIds;
    if (input.canInviteEmployees !== undefined) payload.canInviteEmployees = input.canInviteEmployees;
    if (input.canDeactivateEmployees !== undefined) payload.canDeactivateEmployees = input.canDeactivateEmployees;
    if (input.canManageBranches !== undefined) payload.canManageBranches = input.canManageBranches;
    const { error } = await supabase.rpc("update_co_owner_grant", { payload });
    if (error) throw new Error(error.message);
    await get().load();
  },

  suspend: async (grantId, reason = "") => {
    const { error } = await supabase.rpc("suspend_co_owner", {
      p_grant_id: grantId,
      p_reason: reason,
    });
    if (error) throw new Error(error.message);
    await get().load();
  },

  reactivate: async (grantId) => {
    const { error } = await supabase.rpc("reactivate_co_owner", { p_grant_id: grantId });
    if (error) throw new Error(error.message);
    await get().load();
  },

  restore: async (grantId) => {
    const { error } = await supabase.rpc("restore_co_owner", { p_grant_id: grantId });
    if (error) throw new Error(error.message);
    await get().load();
  },

  revoke: async (grantId, reason) => {
    const { error } = await supabase.rpc("revoke_co_owner", {
      p_grant_id: grantId,
      p_reason: reason,
    });
    if (error) throw new Error(error.message);
    await get().load();
  },

  getBranchCoOwners: async (branchId) => {
    const { data, error } = await supabase.rpc("get_branch_co_owners", { p_branch_id: branchId });
    if (error) throw new Error(error.message);
    return data as BranchCoOwnerResult;
  },

  assignBranchCoOwner: async (branchId, name, phone, config) => {
    const { data, error } = await supabase.rpc("assign_branch_co_owner", {
      p_branch_id: branchId,
      p_name: name.trim(),
      p_phone: phone.trim(),
      p_config: config,
    });
    if (error) throw new Error(error.message);
    await get().load();
    const result = data as { grantId: string; branchName: string };
    return { grantId: result.grantId, branchName: result.branchName };
  },
}));
