import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { getCachedData, setCachedData } from "@/lib/localCache";
import { rpcResolveProductBarcode } from "@/lib/db";
import type { Product, ProductVariant, ProductCategory, BaseUnit } from "@/types";

const CACHE_KEY = "products";

// Products: `products` table holds catalogue + stockQty (one source of truth).
// `product_variants` holds sellable unit definitions (pricing, unitSize, qtyStep).
// Employees must never see cost_price, so non-admins read the
// `product_variants_public` VIEW while admins read the base table.

interface ProductRow {
  id: string;
  name: string;
  company: string | null;
  company_id: string | null;
  category: ProductCategory;
  image_url: string | null;
  barcode: string | null;
  base_unit: string | null;
  stock_qty: number;
}

interface VariantRow {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  selling_price: number;
  cost_price?: number;
  stock_qty: number;
  unit_size: number | null;
  qty_step: number | null;
  low_stock_threshold: number;
  expiry_date: string | null;
}

function variantFromRow(r: VariantRow): ProductVariant {
  return {
    id: r.id,
    productId: r.product_id,
    name: r.name,
    sku: r.sku ?? undefined,
    sellingPrice: Number(r.selling_price),
    costPrice: Number(r.cost_price ?? 0),
    stockQty: Number(r.stock_qty ?? 0),
    unitSize: Number(r.unit_size ?? 1),
    qtyStep: Number(r.qty_step ?? 1),
    lowStockThreshold: r.low_stock_threshold,
    expiryDate: r.expiry_date ?? undefined,
  };
}

interface ProductsState {
  products: Product[];
  loading: boolean;
  ready: boolean;
  error: string | null;
  load: () => Promise<void>;
  subscribe: () => () => void;
  findByBarcode: (barcode: string) => Product | undefined;
  /**
   * The same question, answered by the database when this device cannot answer it.
   *
   * `findByBarcode` matches against what has been loaded, which is right almost always and
   * silently wrong when it is not: a product added on another phone, or one created since
   * this screen last refreshed, simply would not be found and the scan would be reported as
   * an unknown code. The database holds the code, scoped to the shop (0158), so it decides.
   */
  resolveByCode: (code: string) => Promise<Product | undefined>;
  /** Drop every row: the app is about to read a different shop. */
  reset: () => void;
}

let channel: ReturnType<typeof supabase.channel> | null = null;

export const useProductsStore = create<ProductsState>((set, get) => ({
  products: [],
  loading: false,
  ready: false,
  error: null,

  // The active shop changed. Nothing fetched for the previous shop may render for the
  // next one, not even for the frame before the reload lands.
  reset: () => set({ products: [], loading: false, ready: false, error: null }),

  findByBarcode: (barcode: string) => {
    const normalized = barcode.trim().toUpperCase();
    return get().products.find((p) => p.barcode?.toUpperCase() === normalized);
  },

  resolveByCode: async (code: string) => {
    // The loaded list first: it is instant, it works offline, and it is the same answer.
    const local = get().findByBarcode(code);
    if (local) return local;

    try {
      const found = await rpcResolveProductBarcode(code);
      if (!found) return undefined;
      const known = get().products.find((p) => p.id === found.productId);
      if (known) return known;
      // The code is the shop's but the row is not loaded yet — the product was added on
      // another device. Refresh once and look again rather than calling it unknown.
      await get().load();
      return get().products.find((p) => p.id === found.productId);
    } catch {
      // Offline, or the lookup itself failed. The local answer was already tried, so the
      // honest result is "not found" rather than a thrown error on a scan.
      return undefined;
    }
  },

  load: async () => {
    set({ loading: true, error: null });

    // Stale-while-revalidate: render the cache immediately, then ALWAYS revalidate.
    // Skipping the fetch while the cache was still "fresh" made every write invisible
    // on screen for up to 5 minutes: a purchase did not move stock, a product created
    // from the Add Product screen did not appear, realtime events were swallowed and
    // pull-to-refresh did nothing. The cache is a render hint, never the authority.
    const cached = getCachedData<Product[]>(CACHE_KEY);
    if (cached) {
      set({ products: cached, loading: false, ready: true });
    }

    const isAdmin = ["admin", "co_admin"].includes(
      useAuthStore.getState().user?.role ?? ""
    );

    try {
      const [{ data: prods, error: pErr }, { data: vars, error: vErr }] =
        await Promise.all([
          supabase.from("products").select("*").eq("is_active", true).order("name"),
          isAdmin
            ? supabase.from("product_variants").select("*").eq("is_active", true)
            : supabase.from("product_variants_public").select("*"),
        ]);

      if (pErr || vErr) {
        // Network error — keep cached data if available, just report error
        if (!cached) {
          set({ loading: false, ready: true, error: (pErr ?? vErr)!.message });
        }
        return;
      }

      const byProduct = new Map<string, ProductVariant[]>();
      for (const v of (vars as VariantRow[]) ?? []) {
        const list = byProduct.get(v.product_id) ?? [];
        list.push(variantFromRow(v));
        byProduct.set(v.product_id, list);
      }

      // Resolve company names for products (company_id → company name)
      const companyRows = (await supabase.from("companies").select("id, name")).data ?? [];
      const companyMap = new Map(companyRows.map((c: any) => [c.id, c.name]));

      const products: Product[] = ((prods as ProductRow[]) ?? []).map((p) => {
        const variants = byProduct.get(p.id) ?? [];
        // Compute total stock from variants (not from products.stock_qty which may be stale)
        const computedStockQty = variants.length > 0
          ? variants.reduce((sum, v) => sum + (v.stockQty ?? 0), 0)
          : Number(p.stock_qty ?? 0);
        // Resolve company name: prefer company_id lookup, fallback to legacy company column
        const companyName = p.company_id ? companyMap.get(p.company_id) ?? p.company : p.company ?? "";
        return {
          id: p.id,
          name: p.name,
          company: companyName,
          category: p.category,
          imageUrl: p.image_url ?? undefined,
          barcode: p.barcode ?? undefined,
          baseUnit: (p.base_unit as BaseUnit) ?? "piece",
          stockQty: computedStockQty,
          variants,
        };
      });

      // Save to cache
      setCachedData(CACHE_KEY, products);
      set({ products, loading: false, ready: true });
    } catch {
      // Complete network failure — show cached data if available
      if (!cached) {
        set({ loading: false, ready: true, error: "Offline — showing cached data" });
      }
    }
  },

  subscribe: () => {
    if (channel) return () => {};
    channel = supabase
      .channel("products-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "product_variants" },
        async () => { await get().load(); }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "products" },
        async () => { await get().load(); }
      )
      .subscribe();
    return () => {
      if (channel) { supabase.removeChannel(channel); channel = null; }
    };
  },
}));
