import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import type { Product, ProductVariant, ProductCategory, BaseUnit } from "@/types";

// Products: `products` table holds catalogue + stockQty (one source of truth).
// `product_variants` holds sellable unit definitions (pricing, unitSize, qtyStep).
// Employees must never see cost_price, so non-admins read the
// `product_variants_public` VIEW while admins read the base table.

interface ProductRow {
  id: string;
  name: string;
  company: string;
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
}

let channel: ReturnType<typeof supabase.channel> | null = null;

export const useProductsStore = create<ProductsState>((set, get) => ({
  products: [],
  loading: false,
  ready: false,
  error: null,

  findByBarcode: (barcode: string) => {
    const normalized = barcode.trim().toUpperCase();
    return get().products.find((p) => p.barcode?.toUpperCase() === normalized);
  },

  load: async () => {
    set({ loading: true, error: null });
    const isAdmin = ["admin", "co_admin"].includes(
      useAuthStore.getState().user?.role ?? ""
    );

    const [{ data: prods, error: pErr }, { data: vars, error: vErr }] =
      await Promise.all([
        supabase.from("products").select("*").eq("is_active", true).order("name"),
        isAdmin
          ? supabase.from("product_variants").select("*").eq("is_active", true)
          : supabase.from("product_variants_public").select("*"),
      ]);

    if (pErr || vErr) {
      set({ loading: false, ready: true, error: (pErr ?? vErr)!.message });
      return;
    }

    const byProduct = new Map<string, ProductVariant[]>();
    for (const v of (vars as VariantRow[]) ?? []) {
      const list = byProduct.get(v.product_id) ?? [];
      list.push(variantFromRow(v));
      byProduct.set(v.product_id, list);
    }

    const products: Product[] = ((prods as ProductRow[]) ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      company: p.company,
      category: p.category,
      imageUrl: p.image_url ?? undefined,
      barcode: p.barcode ?? undefined,
      baseUnit: (p.base_unit as BaseUnit) ?? "piece",
      stockQty: Number(p.stock_qty ?? 0),
      variants: byProduct.get(p.id) ?? [],
    }));

    set({ products, loading: false, ready: true });
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
