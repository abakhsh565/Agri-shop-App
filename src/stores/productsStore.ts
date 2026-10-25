import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import { getCachedData, setCachedData, captureDataContext, isDataContextCurrent } from "@/lib/localCache";
import { rpcResolveProductBarcode } from "@/lib/db";
import { applyBranchStock, filterProductsForBranch } from "@/lib/branchStock";
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
  /**
   * The owner's farmer-marketplace decision for this product.
   *
   * Read here rather than left out because the edit form is where the switch is shown, and a
   * form that cannot see the stored value shows every listed product as unlisted — which, on a
   * screen that saves the whole product, would unlist it the next time anything was edited.
   */
  marketplace_listed: boolean | null;
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
    const context = captureDataContext();
    if (!isDataContextCurrent(context)) return;
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

    const isAdmin = ["admin"].includes(
      useAuthStore.getState().user?.role ?? ""
    );

    try {
      const [{ data: prods, error: pErr }, { data: vars, error: vErr }, branchStock, branchCatalogue] =
        await Promise.all([
          supabase.from("products").select("*").eq("is_active", true).order("name"),
          isAdmin
            ? supabase.from("product_variants").select("*").eq("is_active", true)
            : supabase.from("product_variants_public").select("*"),
          // The shelf is the branch's, not the shop's (0238). A failure here is not a reason
          // to blank the catalogue: `applyBranchStock(null)` keeps the loaded shop quantities,
          // which is the pre-0238 behaviour until the database carries the read.
          supabase.rpc("get_branch_variant_stock"),
          // Which of these products this branch carries at all (0240). A new branch has no
          // rows, so its catalogue is empty rather than the whole shop at zero. A failed
          // read falls back to the loaded catalogue, never to an empty screen.
          supabase.rpc("get_branch_product_ids"),
        ]);

      if (!isDataContextCurrent(context)) return;
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
      if (!isDataContextCurrent(context)) return;
      const companyMap = new Map(companyRows.map((c: any) => [c.id, c.name]));

      const mapped: Product[] = ((prods as ProductRow[]) ?? []).map((p) => {
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
          // Absent from the row means the column is not there at all (an older cached payload),
          // which must read as "not listed" rather than as "listed".
          marketplaceListed: p.marketplace_listed === true,
          variants,
        };
      });

      // The branch read is authoritative when it answered. An empty answer is a real answer
      // (this branch holds nothing), so only an error falls back to the shop quantities.
      const branchQty = branchStock.error
        ? null
        : new Map<string, number>(
            ((branchStock.data as { variant_id: string; qty: number | string }[] | null) ?? [])
              .map((row) => [row.variant_id, Number(row.qty)]),
          );

      // PostgREST returns a `setof uuid` as bare strings; accept the named-object shape too,
      // so a client built against a different PostgREST version does not silently see nothing.
      const branchProductIds = branchCatalogue.error
        ? null
        : new Set<string>(
            ((branchCatalogue.data as unknown[] | null) ?? [])
              .map((row) =>
                typeof row === "string"
                  ? row
                  : (row as { get_branch_product_ids?: string })?.get_branch_product_ids,
              )
              .filter((id): id is string => Boolean(id)),
          );

      const products = applyBranchStock(filterProductsForBranch(mapped, branchProductIds), branchQty);

      // Save to cache. The cache is owned per shop+user+branch (localCache), so a list
      // filtered for Malik agro cannot paint in Main Branch.
      setCachedData(CACHE_KEY, products);
      set({ products, loading: false, ready: true });
    } catch {
      if (!isDataContextCurrent(context)) return;
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
