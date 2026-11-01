import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { getCurrentTenantId } from "@/lib/tenantContext";
import type { DashboardWidget, Department } from "@/types";

interface DepartmentRow {
  id: string;
  tenant_id: string;
  code: string;
  name_en: string;
  name_ur: string;
  sort_order: number;
  is_system: boolean;
}

interface WidgetRow {
  key: string;
  module: string;
  label_en: string;
  label_ur: string;
  sort_order: number;
  default_permission: string | null;
}

interface AccessCatalogState {
  departments: Department[];
  /** The dashboard blocks the app can draw, in catalogue order. */
  widgets: DashboardWidget[];
  ready: boolean;
  load: () => Promise<void>;
  /** An owner-added department. The five the business starts with cannot be duplicated. */
  createDepartment: (input: { nameEn: string; nameUr?: string }) => Promise<Department>;
  reset: () => void;
}

/**
 * The two catalogues a role is described with: the departments a business is divided
 * into, and the dashboard blocks a role may be shown.
 *
 * Both are read once per shop and shared by the roles list, the role editor and the
 * access pickers, so three screens cannot disagree about what "Sales" means or which
 * widgets exist. The widgets carry their own EN/UR labels (like `permissions` does),
 * which is why the checklist never needs a translation key per block.
 */
export const useAccessCatalogStore = create<AccessCatalogState>((set, get) => ({
  departments: [],
  widgets: [],
  ready: false,

  reset: () => set({ departments: [], widgets: [], ready: false }),

  load: async () => {
    if (get().ready) return;
    const tenantId = getCurrentTenantId();
    const [deptRes, widgetRes] = await Promise.all([
      tenantId
        ? supabase
            .from("departments")
            .select("*")
            .eq("tenant_id", tenantId)
            .order("sort_order")
            .order("name_en")
        : Promise.resolve({ data: [], error: null }),
      supabase.from("dashboard_widgets").select("*").order("sort_order"),
    ]);

    set({
      departments: ((deptRes.data as DepartmentRow[] | null) ?? []).map((d) => ({
        id: d.id,
        tenantId: d.tenant_id,
        code: d.code,
        nameEn: d.name_en,
        nameUr: d.name_ur,
        sortOrder: d.sort_order,
        isSystem: d.is_system,
      })),
      widgets: ((widgetRes.data as WidgetRow[] | null) ?? []).map((w) => ({
        key: w.key,
        module: w.module,
        labelEn: w.label_en,
        labelUr: w.label_ur,
        sortOrder: w.sort_order,
        defaultPermission: w.default_permission,
      })),
      ready: true,
    });
  },

  createDepartment: async ({ nameEn, nameUr }) => {
    const { data, error } = await supabase.rpc("create_department", {
      payload: { nameEn: nameEn.trim(), nameUr: nameUr?.trim() || undefined },
    });
    if (error) throw new Error(error.message);
    // Re-read rather than append: the row's label in the other language, its sort order
    // and its code are the server's to decide.
    set((s) => ({ departments: s.departments, ready: false }));
    await get().load();
    const created = get().departments.find((d) => d.id === (data as { id: string }).id);
    if (!created) throw new Error("DEPARTMENT_NOT_FOUND_OR_NOT_AUTHORIZED");
    return created;
  },
}));
