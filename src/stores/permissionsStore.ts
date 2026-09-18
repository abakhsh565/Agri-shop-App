import { create } from "zustand";
import { supabase } from "@/lib/supabase";

interface PermissionRow {
  id: string;
  code: string;
  module: string;
  action: string;
  label_en: string;
  label_ur: string;
}

interface PermissionsState {
  permissions: PermissionRow[];
  loading: boolean;
  ready: boolean;
  load: () => Promise<void>;
  getByModule: (module: string) => PermissionRow[];
}

export const usePermissionsStore = create<PermissionsState>((set, get) => ({
  permissions: [],
  loading: false,
  ready: false,

  load: async () => {
    if (get().ready) return;
    set({ loading: true });
    const { data, error } = await supabase
      .from("permissions")
      .select("*")
      .order("module")
      .order("action");
    if (error) {
      set({ loading: false, ready: true });
      return;
    }
    set({
      permissions: (data as PermissionRow[]) ?? [],
      loading: false,
      ready: true,
    });
  },

  getByModule: (module: string) => {
    return get().permissions.filter((p) => p.module === module);
  },
}));
