import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useProductsStore } from "@/stores/productsStore";
import { getStockStatusColor } from "@/lib/formatters";
import StatusBar from "@/components/ui/StatusBar";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { rpcDeleteProduct } from "@/lib/db";
import { useUIStore } from "@/stores/uiStore";
import { Search, Plus, ChevronRight } from "lucide-react";
import type { ProductCategory, Product } from "@/types";
import { barcodeToSvg } from "@/lib/barcode";

const CATEGORY_KEYS: Record<string, "products.all" | "products.spray" | "products.seed" | "products.fertilizer"> = {
  all: "products.all",
  spray: "products.spray",
  seed: "products.seed",
  fertilizer: "products.fertilizer",
};

const CATEGORY_DOT: Record<string, string> = {
  spray: "#3b82f6", seed: "#84cc16", fertilizer: "#f59e0b", other: "#8b5cf6",
};

export default function AdminInventoryPage() {
  const { language } = useThemeStore();
  const t = useT();
  const navigate = useNavigate();
  const isUrdu = language === "ur";
  const products = useProductsStore((s) => s.products);
  const ready = useProductsStore((s) => s.ready);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<"all" | ProductCategory>("all");

  const FILTERS: { key: "all" | ProductCategory }[] = [
    { key: "all" }, { key: "spray" }, { key: "seed" }, { key: "fertilizer" },
  ];

  const filtered = products.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.company.toLowerCase().includes(search.toLowerCase());
    const matchCat = cat === "all" || p.category === cat;
    return matchSearch && matchCat;
  });

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />

      {/* Header */}
      <div className="relative flex items-center justify-center h-11">
        <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{t("admin.inventory")}</p>
      </div>

      {/* Search */}
      <div className="px-4 pb-3">
        <div
          className="flex items-center gap-2 h-10 rounded-full px-3"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
        >
          <Search size={14} style={{ color: "var(--text-secondary)" }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("products.search")}
            className="flex-1 bg-transparent text-[13px] outline-none"
            style={{ color: "var(--text-primary)" }}
          />
          {search && (
            <button onClick={() => setSearch("")} style={{ color: "var(--text-secondary)" }}>×</button>
          )}
        </div>
      </div>

      {/* Category filters */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
        {FILTERS.map(({ key }) => (
          <button
            key={key}
            onClick={() => setCat(key)}
            className="shrink-0 h-8 px-4 rounded-full text-xs font-medium transition-colors"
            style={{
              background: cat === key ? "var(--brand)" : "var(--surface-2)",
              color: cat === key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {t(CATEGORY_KEYS[key])}
          </button>
        ))}
      </div>

      {/* Empty state */}
      {ready && filtered.length === 0 && (
        <div className="flex flex-col items-center py-16 gap-2">
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No products yet</p>
        </div>
      )}

      {/* Product list — clean cards */}
      <div className="flex flex-col mx-4 gap-3 pb-24">
        {filtered.map((p) => {
          const dotColor = CATEGORY_DOT[p.category] ?? "#888";
          // Compute total stock status
          const totalStock = p.stockQty;
          const hasVariants = p.variants.length > 0;
          const minThreshold = hasVariants
            ? Math.min(...p.variants.map((v) => v.lowStockThreshold))
            : 5;
          const status =
            totalStock === 0
              ? "out_of_stock"
              : totalStock <= minThreshold
              ? "low_stock"
              : "in_stock";
          const statusColor = getStockStatusColor(status);

          return (
            <button
              key={p.id}
              onClick={() => navigate(`/admin/products/${p.id}`)}
              className="rounded-[14px] overflow-hidden text-left active:scale-[0.98] transition-transform"
              style={{ border: "1px solid var(--divider)", background: "var(--surface)" }}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} className="size-11 rounded-[10px] object-cover shrink-0" />
                ) : (
                  <div
                    className="size-11 rounded-[10px] flex items-center justify-center text-[12px] font-bold shrink-0"
                    style={{ background: dotColor + "22", color: dotColor }}
                  >
                    {p.name.charAt(0)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                  <p className="text-[11px] truncate" style={{ color: "var(--text-secondary)" }}>{p.company}</p>
                  {p.barcode && (
                    <div className="mt-1 flex items-center gap-1.5">
                      <span className="text-[9px] font-mono" style={{ color: "var(--text-secondary)" }}>{p.barcode}</span>
                      <div dangerouslySetInnerHTML={{ __html: barcodeToSvg(p.barcode, { height: 16, showText: false, width: 50 }) }} className="shrink-0" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ color: statusColor, background: statusColor + "22" }}
                  >
                    {totalStock} {p.baseUnit}
                  </span>
                  <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} />
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Floating Add Product */}
      <div
        className="fixed left-0 right-0 max-w-[480px] mx-auto pointer-events-none z-40"
        style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}
      >
        <div className={`flex px-4 ${isUrdu ? "justify-start" : "justify-end"}`}>
          <button
            onClick={() => navigate("/admin/inventory/new")}
            className="pointer-events-auto h-13 pl-4 pr-5 rounded-full flex items-center gap-2 text-sm font-bold shadow-lg active:scale-95 transition-transform"
            style={{ background: "var(--brand)", color: "#0a0a0a", height: "52px", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
          >
            <Plus size={20} strokeWidth={2.5} /> Product
          </button>
        </div>
      </div>
    </div>
  );
}
