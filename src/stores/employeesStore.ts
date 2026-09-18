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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asUuidOrNull = (id?: string | null) =>
  id && UUID_RE.test(id) ? id : null;

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
    const patch: Record<string, unknown> = { is_active: active };
    if (!active) {
      patch.deactivated_at = new Date().toISOString();
      patch.deactivated_by = asUuidOrNull(byUserId);
    } else {
      patch.deactivated_at = null;
      patch.deactivated_by = null;
    }
    const { error } = await supabase.from("users").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    set({
      employees: get().employees.map((e) =>
        e.id === id
          ? {
              ...e,
              isActive: active,
              deactivatedAt: active ? null : (patch.deactivated_at as string),
              deactivatedBy: active ? null : (patch.deactivated_by as string | null),
            }
          : e
      ),
    });
  },
}));
