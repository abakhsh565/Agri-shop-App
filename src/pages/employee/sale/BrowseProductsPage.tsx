import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { StockBadge } from "@/components/ui/Badge";
import { useCartStore } from "@/stores/cartStore";
import { useProductsStore } from "@/stores/productsStore";
import { useUIStore } from "@/stores/uiStore";
import { useShellBase } from "@/lib/useShellBase";
import { getStockStatus } from "@/lib/formatters";
import { ChevronRight } from "lucide-react";
import ScanButton from "@/components/ui/ScanButton";
import type { ProductCategory } from "@/types";

const FILTERS: { key: "all" | ProductCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "spray", label: "Sprays" },
  { key: "seed", label: "Seeds" },
  { key: "fertilizer", label: "Fertilizer" },
];

const CATEGORY_LABEL: Record<string, string> = {
  spray: "Sprays",
  seed: "Seeds",
  fertilizer: "Fertilizer",
  other: "Other",
};

const CATEGORY_COLOR: Record<string, { bg: string; fg: string }> = {
  spray: { bg: "rgba(59,130,246,0.1)", fg: "#3b82f6" },
  seed: { bg: "rgba(132,204,22,0.1)", fg: "#65a30d" },
  fertilizer: { bg: "rgba(245,158,11,0.1)", fg: "#d97706" },
  other: { bg: "rgba(139,92,246,0.1)", fg: "#8b5cf6" },
};

export default function BrowseProductsPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const { customer } = useCartStore();
  const { addToast } = useUIStore();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | ProductCategory>("all");
  const products = useProductsStore((s) => s.products);
  const findByBarcode = useProductsStore((s) => s.findByBarcode);

  function handleBarcodeScan(code: string) {
    const product = findByBarcode(code);
    if (!product) {
      addToast(`No product found for "${code}"`, "error");
      return;
    }
    if (product.stockQty <= 0) {
      addToast(`${product.name} is out of stock`, "warning");
      return;
    }
    const inStockVariants = product.variants.filter((v) => Math.floor(product.stockQty / v.unitSize) > 0);
    if (inStockVariants.length === 0) {
      addToast(`${product.name} is out of stock`, "warning");
      return;
    }
    if (inStockVariants.length === 1) {
      const v = inStockVariants[0];
      const maxU = Math.floor(product.stockQty / v.unitSize);
      const { addItem } = useCartStore.getState();
      addItem({
        productId: product.id,
        productName: product.name,
        variantId: v.id,
        variantName: v.name,
        qty: v.qtyStep,
        unitPrice: v.sellingPrice,
        lineTotal: v.sellingPrice * v.qtyStep,
        maxQty: maxU,
        qtyStep: v.qtyStep,
        unitSize: v.unitSize,
        baseUnit: product.baseUnit,
      });
      addToast(`${product.name} (${v.name}) added to cart`, "success");
    } else {
      navigate(`${base}/sale/products/${product.id}`);
    }
  }

  const filtered = products.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.company.toLowerCase().includes(search.toLowerCase());
    const matchCat = category === "all" || p.category === category;
    return matchSearch && matchCat;
  });

  const initColor = (name: string) => {
    const colors = ["#3b82f6","#84cc16","#f59e0b","#8b5cf6","#06b6d4","#ec4899"];
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
    return colors[h % colors.length];
  };

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title="Select Products" />

      {/* Customer strip */}
      {customer && (
        <div className="px-4 py-2.5" style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--divider)" }}>
          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
            Customer: <span className="font-medium" style={{ color: "var(--text-primary)" }}>{customer.name}</span>
          </p>
        </div>
      )}

      {/* Search — full width */}
      <div className="px-4 pt-3 pb-2">
        <SearchBar
          placeholder="Search products"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Category filters */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setCategory(f.key)}
            className="shrink-0 h-8 px-4 rounded-full text-xs font-medium transition-colors"
            style={{
              background: category === f.key ? "var(--brand)" : "var(--surface-2)",
              color: category === f.key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Product list */}
      {filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-16 gap-2">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {search ? "No products match your search" : "No products yet"}
          </p>
        </div>
      ) : (
        <div className="flex flex-col">
          {filtered.map((p, i) => {
            const catColor = CATEGORY_COLOR[p.category] ?? CATEGORY_COLOR.other;
            return (
              <button
                key={p.id}
                onClick={() => navigate(`${base}/sale/products/${p.id}`)}
                className="flex items-center gap-3 px-4 py-4 text-left"
                style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--divider)" : "none" }}
              >
                {/* Product image or initial */}
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 overflow-hidden"
                  style={{ background: p.imageUrl ? "transparent" : initColor(p.name) + "22" }}
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover" />
                  ) : (
                    <span style={{ color: initColor(p.name) }}>{p.name.charAt(0)}</span>
                  )}
                </div>

                {/* Product info */}
                <div className="flex-1 min-w-0 flex flex-col gap-1">
                  <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{p.company}</p>
                  <div className="flex items-center gap-2">
                    <span
                      className="self-start inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
                      style={{ background: catColor.bg, color: catColor.fg }}
                    >
                      {CATEGORY_LABEL[p.category] || p.category}
                    </span>
                    <StockBadge status={getStockStatus(p.stockQty, 5)} outline />
                  </div>

                </div>

                <ChevronRight size={18} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
              </button>
            );
          })}        </div>
      )}

      {/* Floating Scan button */}
      <div className="fixed left-0 right-0 max-w-[480px] mx-auto pointer-events-none z-40" style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}>
        <div className="flex px-4 justify-end pointer-events-auto">
          <ScanButton onScan={handleBarcodeScan} label="Scan" size="lg" />
        </div>
      </div>

    </div>
  );
}
