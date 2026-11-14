import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import {
  captureDataContext,
  getCachedData,
  isDataContextCurrent,
  setCachedData,
} from "@/lib/localCache";
import {
  rpcDeleteProductCategory,
  rpcDeleteProductUnit,
  rpcSaveProductCategory,
  rpcSaveProductUnit,
  type CatalogueDeleteResult,
  type CategoryClassificationInput,
} from "@/lib/db";
import type {
  CategoryClassification,
  ClassificationForm,
  ClassificationPreset,
  HandlingType,
  ProductCategory,
  ShopCategory,
  ShopUnit,
} from "@/types";

/**
 * The shop's own shelves and units.
 *
 * WHY A STORE. The catalogue is read by four screens — the Categories list, the category form,
 * the Units list and the Add Product form — and by the product page. Each of them needs the
 * whole, small list, and all of them must agree about it: a category created on one screen has
 * to be offered on the next without a reload, and a unit edited on one has to be the one a
 * product is filed under on another. One store is that agreement.
 *
 * Reads are direct table reads, guarded by RLS: the catalogue belongs to the shop, so the
 * database decides which rows a session may see. Writes are RPCs (0259), because a category can
 * be its own parent's parent and a unit can name a fourth measurement — the two things a
 * client-side insert cannot check.
 *
 * Nothing here is branch-specific. A shelf and a unit are names the whole business uses; only
 * the stock on the shelf belongs to a branch.
 */

const CACHE_KEY = "catalogue";

interface CategoryRow {
  id: string;
  parent_id: string | null;
  name: string;
  legacy_category: ProductCategory | null;
  is_system: boolean;
  sort_order: number;
}

interface UnitRow {
  id: string;
  name: string;
  symbol: string;
  base_unit: ShopUnit["baseUnit"];
  precision: number;
  is_system: boolean;
}

interface ClassificationRow {
  category_id: string;
  preset: ClassificationPreset;
  physical_forms: ClassificationForm[];
  handling_types: HandlingType[];
}

function categoryFromRow(r: CategoryRow): ShopCategory {
  return {
    id: r.id,
    parentId: r.parent_id,
    name: r.name,
    legacyCategory: r.legacy_category,
    isSystem: r.is_system,
    sortOrder: r.sort_order ?? 0,
  };
}

function unitFromRow(r: UnitRow): ShopUnit {
  return {
    id: r.id,
    name: r.name,
    symbol: r.symbol,
    baseUnit: r.base_unit,
    precision: r.precision ?? 0,
    isSystem: r.is_system,
  };
}

function classificationFromRow(r: ClassificationRow): CategoryClassification {
  return {
    categoryId: r.category_id,
    preset: r.preset,
    physicalForms: Array.isArray(r.physical_forms) ? r.physical_forms : [],
    handlingTypes: Array.isArray(r.handling_types) ? r.handling_types : [],
  };
}

interface CatalogueState {
  categories: ShopCategory[];
  units: ShopUnit[];
  classifications: CategoryClassification[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  load: () => Promise<void>;
  subscribe: () => () => void;
  saveCategory: (input: {
    id?: string;
    name: string;
    parentId?: string | null;
    classification?: CategoryClassificationInput | null;
  }) => Promise<ShopCategory>;
  saveUnit: (input: { id?: string; name: string; symbol: string; baseUnit: string; precision: number }) => Promise<ShopUnit>;
  /** Remove a shelf, or report the active products/subcategories still using it. */
  deleteCategory: (id: string) => Promise<CatalogueDeleteResult>;
  /** Remove a unit, or report the active products still using it. */
  deleteUnit: (id: string) => Promise<CatalogueDeleteResult>;
  /** Drop every row: the app is about to read a different shop. */
  reset: () => void;
}

let channel: ReturnType<typeof supabase.channel> | null = null;

export const useCatalogueStore = create<CatalogueState>((set, get) => ({
  categories: [],
  units: [],
  classifications: [],
  loading: false,
  ready: false,
  error: null,

  reset: () => set({
    categories: [],
    units: [],
    classifications: [],
    loading: false,
    ready: false,
    error: null,
  }),

  load: async () => {
    const context = captureDataContext();
    if (!isDataContextCurrent(context)) return;

    // The catalogue changes rarely, so a cached paint is right far more often than not — but it
    // is still only a hint: the reads below always run, or a shelf created on another phone
    // would never arrive on this one.
    const cached = getCachedData<{
      categories: ShopCategory[];
      units: ShopUnit[];
      classifications?: CategoryClassification[];
    }>(CACHE_KEY);
    if (cached) {
      set({
        categories: cached.categories ?? [],
        units: cached.units ?? [],
        classifications: cached.classifications ?? [],
        ready: true,
      });
    }

    set({ loading: true, error: null });
    const [categories, units, classifications] = await Promise.all([
      supabase
        .from("product_categories")
        .select("id,parent_id,name,legacy_category,is_system,sort_order")
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      supabase
        .from("product_units")
        .select("id,name,symbol,base_unit,precision,is_system")
        .eq("is_active", true)
        .order("sort_order")
        .order("name"),
      supabase
        .from("product_classification_profiles")
        .select("category_id,preset,physical_forms,handling_types")
        .order("category_id"),
    ]);

    if (!isDataContextCurrent(context)) return;

    if (categories.error || units.error || classifications.error) {
      // A failed read keeps whatever the cache painted. Reporting the error without a list is
      // what makes an Add Product form look like the shop has no categories at all.
      set({
        loading: false,
        ready: true,
        error: (categories.error ?? units.error ?? classifications.error)!.message,
      });
      return;
    }

    const next = {
      categories: ((categories.data as CategoryRow[] | null) ?? []).map(categoryFromRow),
      units: ((units.data as UnitRow[] | null) ?? []).map(unitFromRow),
      classifications: ((classifications.data as ClassificationRow[] | null) ?? []).map(
        classificationFromRow,
      ),
    };
    setCachedData(CACHE_KEY, next);
    set({ ...next, loading: false, ready: true });
  },

  subscribe: () => {
    if (channel) return () => {};
    channel = supabase
      .channel("catalogue-feed")
      .on("postgres_changes", { event: "*", schema: "public", table: "product_categories" }, async () => {
        await get().load();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "product_units" }, async () => {
        await get().load();
      })
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_classification_profiles" },
        async () => {
          await get().load();
        },
      )
      .subscribe();
    return () => {
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
    };
  },

  saveCategory: async (input) => {
    const saved = await rpcSaveProductCategory({
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      parentId: input.parentId ?? null,
      classification: input.classification,
    });
    const row: ShopCategory = get().categories.find((c) => c.id === saved.id) ?? {
      id: saved.id,
      parentId: saved.parentId,
      name: saved.name,
      legacyCategory: saved.legacyCategory,
      isSystem: saved.isSystem,
      sortOrder: 0,
    };
    // Publish the row the server just confirmed BEFORE re-reading. The reload can be skipped or
    // fail (it refuses to publish into a shop context that changed while the save was in flight),
    // and that used to leave a shelf that was genuinely created invisible on the list the form
    // had just navigated to — a "saved" toast over a missing row. The read below still runs so a
    // rename's translated/system state comes from the server.
    if (!get().categories.some((c) => c.id === saved.id)) {
      set((state) => ({ categories: [...state.categories, row] }));
    }
    // The server is the answer, and the list is rebuilt from it: a rename can change whether the
    // shelf is still a translated one, which no local patch knows on its own.
    await get().load();
    return get().categories.find((c) => c.id === saved.id) ?? row;
  },

  saveUnit: async (input) => {
    const saved = await rpcSaveProductUnit({
      ...(input.id ? { id: input.id } : {}),
      name: input.name,
      symbol: input.symbol,
      baseUnit: input.baseUnit,
      precision: input.precision,
    });
    const row: ShopUnit = get().units.find((u) => u.id === saved.id) ?? {
      id: saved.id,
      name: saved.name,
      symbol: saved.symbol,
      baseUnit: saved.baseUnit,
      precision: saved.precision,
      isSystem: saved.isSystem,
    };
    if (!get().units.some((u) => u.id === saved.id)) {
      set((state) => ({ units: [...state.units, row] }));
    }
    await get().load();
    return get().units.find((u) => u.id === saved.id) ?? row;
  },

  deleteCategory: async (id) => {
    const result = await rpcDeleteProductCategory(id);
    // A refusal leaves the list untouched; only a real deletion needs the reload.
    if (result.deleted) await get().load();
    return result;
  },

  deleteUnit: async (id) => {
    const result = await rpcDeleteProductUnit(id);
    if (result.deleted) await get().load();
    return result;
  },
}));
