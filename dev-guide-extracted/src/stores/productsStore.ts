import { create } from "zustand";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/authStore";
import type { Product, ProductVariant, ProductCategory } from "@/types";

// Products live in two tables: `products` (catalogue) + `product_variants`
// (pricing/stock). Employees must never see cost_price, so non-admins read the
// `product_variants_public` VIEW (no cost column) while admins read the base
// table. RLS enforces this server-side too; here we just pick the right source.

interface ProductRow {
  id: string;
  name: string;
  company: string;
  category: ProductCategory;
  image_url: string | null;
}

interface VariantRow {
  id: string;
  product_id: string;
  name: string;
  sku: string | null;
  selling_price: number;
  cost_price?: number; // present only on the admin (base-table) read
  stock_qty: number;
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
    stockQty: r.stock_qty,
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
}

let channel: ReturnType<typeof supabase.channel> | null = null;

export const useProductsStore = create<ProductsState>((set, get) => ({
  products: [],
  loading: false,
  ready: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    const isAdmin = ["admin", "co_admin"].includes(
      useAuthStore.getState().user?.role ?? ""
    );

    const [{ data: prods, error: pErr }, { data: vars, error: vErr }] =
      await Promise.all([
        supabase.from("products").select("*").eq("is_active", true).order("name"),
        isAdmin
          ? supabase.from("product_variants").select("*")
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
