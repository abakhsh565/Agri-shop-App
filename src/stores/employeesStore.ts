import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import type { User, UserRole } from "@/types";

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

function userFromRow(r: UserRow): User {
  return {
    id: r.id,
    name: r.name,
    phone: r.phone,
    role: r.role,
    isOriginalOwner: r.is_original_owner,
    pin: "",
    isActive: r.is_active,
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
    phone: string; // already normalized (E.164 digits)
    role: Exclude<UserRole, "admin">;
    jobTitle?: string;
    photoUrl?: string;
    createdBy?: string | null;
  }) => Promise<User>;
  setActive: (id: string, active: boolean, byUserId?: string | null) => Promise<void>;
}

let channel: ReturnType<typeof supabase.channel> | null = null;

export const useEmployeesStore = create<EmployeesState>((set, get) => ({
  employees: [],
  loading: false,
  ready: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) {
      set({ loading: false, ready: true, error: error.message });
      return;
    }
    set({
      employees: (data as UserRow[]).map(userFromRow),
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
        jobTitle: input.jobTitle ?? null,
        photoUrl: input.photoUrl ?? null,
        createdBy: input.createdBy ?? null,
      },
    });
    if (error) throw new Error(error.message);
    // Reload employees to get the full record with correct employee_number
    await get().load();
    const created = get().employees.find((e) => e.id === data.id);
    return created!;
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
