import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import { useProductsStore } from "@/stores/productsStore";
import { getStockStatus, getStockStatusLabel, getStockStatusColor } from "@/lib/formatters";
import type { Product } from "@/types";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { ChevronRight, Search } from "lucide-react";
import type { ProductCategory } from "@/types";

const CATEGORY_KEYS: Record<string, "products.all" | "products.spray" | "products.seed" | "products.fertilizer"> = {
  all: "products.all",
  spray: "products.spray",
  seed: "products.seed",
  fertilizer: "products.fertilizer",
};

const CATEGORY_DOT: Record<string, string> = {
  spray: "#3b82f6", seed: "#84cc16", fertilizer: "#f59e0b", other: "#8b5cf6",
};

export default function ProductsListPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const products = useProductsStore((s) => s.products);
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

  function productStatus(p: Product) {
    const statuses = p.variants.map((v) => getStockStatus(v.stockQty, v.lowStockThreshold));
    if (statuses.every((s) => s === "out_of_stock")) return "out_of_stock" as const;
    if (statuses.some((s) => s === "low_stock"))     return "low_stock" as const;
    return "in_stock" as const;
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />

      {/* Header */}
      <div className="flex items-center justify-center h-11">
        <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{t("products.title")}</p>
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

      {/* Product list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-2">
          <p className="text-3xl">📦</p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No products found</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {filtered.map((p, i) => {
            const status = productStatus(p);
            const totalVariants = p.variants.length;
            const dotColor = CATEGORY_DOT[p.category] ?? "#888";
            return (
              <button
                key={p.id}
                onClick={() => navigate(`${base}/products/${p.id}`)}
                className="flex items-center justify-between px-4 py-4 text-left transition-opacity active:opacity-70"
                style={{ borderBottom: i < filtered.length - 1 ? "1px solid var(--divider)" : "none" }}
              >
                <div className="flex items-center gap-3">
                  {/* Category dot avatar */}
                  <div
                    className="size-9 rounded-[10px] shrink-0 flex items-center justify-center text-white text-[11px] font-bold"
                    style={{ background: dotColor + "22", color: dotColor }}
                  >
                    {p.name.charAt(0)}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{p.company}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ background: dotColor + "20", color: dotColor }}
                      >
                        {t(CATEGORY_KEYS[p.category] ?? "products.all")}
                      </span>
                      <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
                        {totalVariants} {totalVariants > 1 ? t("products.variants") : t("products.variant")}
                      </span>
                      <span
                        className="text-[10px] font-semibold"
                        style={{ color: getStockStatusColor(status) }}
                      >
                        {getStockStatusLabel(status)}
                      </span>
                    </div>
                  </div>
                </div>
                <ChevronRight size={18} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
