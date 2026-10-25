import { useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import PullToRefresh from "@/components/ui/PullToRefresh";
import { useProductsStore } from "@/stores/productsStore";
import {
  formatSmartDateTime,
  getStockStatus,
  getStockStatusLabel,
  getStockStatusColor,
} from "@/lib/formatters";
import type { Product } from "@/types";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useShellBase } from "@/lib/useShellBase";
import { ChevronRight, Plus, Package, Pencil } from "lucide-react";
import SearchBar from "@/components/ui/SearchBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import type { ProductCategory } from "@/types";
import { useShopStore } from "@/stores/shopStore";
import { draftMissingFields, loadProductDrafts, type DraftMissingField } from "@/lib/productDraft";
import { type I18nKey } from "@/lib/i18n";

// One row per category a product can actually be filed under. "Spray" is kept as an alias of
// pesticide so a row stored under the old name still labels and filters correctly (0162).
const CATEGORY_KEYS: Record<string, string> = {
  all: "products.all",
  pesticide: "category.pesticide",
  spray: "category.pesticide",
  seed: "category.seed",
  fertilizer: "category.fertilizer",
};

const CATEGORY_DOT: Record<string, string> = {
  pesticide: "#3b82f6", spray: "#3b82f6", seed: "#84cc16", fertilizer: "#f59e0b", other: "#8b5cf6",
};

/** The four things a draft can be waiting on, said in the shop's own words. */
const DRAFT_FIELD_KEYS: Record<DraftMissingField, I18nKey> = {
  name: "draft.field.name",
  supplier: "draft.field.supplier",
  size: "draft.field.size",
  price: "draft.field.price",
};

export default function ProductsListPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const products = useProductsStore((s) => s.products);
  const ready = useProductsStore((s) => s.ready);
  // Half-finished products, read from this device and only for the branch being looked at —
  // a draft is not a product, so it cannot arrive from the products store with the rest.
  const activeShopId = useShopStore((s) => s.activeShopId);
  const activeBranchName = useShopStore((s) => s.activeBranchName);
  const drafts = loadProductDrafts(activeShopId);
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<"all" | ProductCategory>("all");

  const FILTERS: { key: "all" | ProductCategory }[] = [
    { key: "all" }, { key: "pesticide" }, { key: "seed" }, { key: "fertilizer" },
  ];

  const filtered = products.filter((p) => {
    const matchSearch =
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.company.toLowerCase().includes(search.toLowerCase());
    // "Pesticide" also answers rows still filed under the old "spray" name, so the filter
    // cannot report an empty shelf that is full.
    const matchCat =
      cat === "all" ||
      p.category === cat ||
      (cat === "pesticide" && p.category === "spray");
    return matchSearch && matchCat;
  });

  function productStatus(p: Product) {
    const statuses = p.variants.map((v) => getStockStatus(v.stockQty, v.lowStockThreshold));
    if (statuses.every((s) => s === "out_of_stock")) return "out_of_stock" as const;
    if (statuses.some((s) => s === "low_stock"))     return "low_stock" as const;
    return "in_stock" as const;
  }

  async function handleRefresh() {
    await useProductsStore.getState().load();
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />

      {/* Header */}
      <div className="flex items-center justify-center h-11">
        <p className="text-base font-bold" style={{ color: "var(--text-primary)" }}>{t("products.title")}</p>
      </div>
      {activeBranchName && (
        <p className="text-10 text-center pb-2" style={{ color: "var(--text-secondary)" }}>
          {t("products.stockInBranch", { branch: activeBranchName })}
        </p>
      )}

      {/* Search */}
      <div className="px-4 pb-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder={t("products.search")}
        />
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

      {/* Drafts: work someone started and has not finished. Above the shelf on purpose —
          unfinished work is the thing that gets forgotten, and the finished stock is not. */}
      {drafts.length > 0 && (
        <div className="px-4 pb-3">
          <p className="ds-section-label mb-2 px-1">{t("draft.section")}</p>
          <ListCard>
            {drafts.map((d) => {
              const missing = draftMissingFields(d);
              return (
                <ListRow
                  key={d.id}
                  testId={`draft-row-${d.id}`}
                  onClick={() => navigate(`${base}/inventory/new?draft=${d.id}`)}
                  tile={
                    <div
                      className="size-10 rounded-[var(--radius-tile)] shrink-0 flex items-center justify-center"
                      style={{ background: "var(--surface-2)" }}
                    >
                      <Pencil size={16} style={{ color: "var(--text-secondary)" }} />
                    </div>
                  }
                  title={d.name.trim() || t("draft.untitled")}
                  meta={formatSmartDateTime(d.updatedAt, undefined, t)}
                  /* What is still missing gets its own line rather than riding along after the
                     time: on one line it was ellipsized to "Still missing: sup…", which is
                     exactly the part that tells the owner where to pick up. This line wraps. */
                  description={
                    missing.length > 0
                      ? t("draft.missing", {
                          fields: missing.map((f) => t(DRAFT_FIELD_KEYS[f])).join(", "),
                        })
                      : t("draft.ready")
                  }
                  trailing={
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className="text-10 font-bold px-2 py-0.5 rounded-full whitespace-nowrap"
                        style={{ background: "var(--warning-bg)", color: "var(--warning)" }}
                      >
                        {t("draft.chip")}
                      </span>
                      <ChevronRight size={18} style={{ color: "var(--text-secondary)" }} />
                    </div>
                  }
                />
              );
            })}
          </ListCard>
        </div>
      )}

      {/* Product list */}
      {!ready ? (
        <SkeletonList rows={5} tile />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 gap-2">
          <Package size={28} className="mx-auto block" style={{ color: "var(--text-tertiary)" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("admin.noProducts")}</p>
        </div>
      ) : (
        <div className="flex flex-col px-4 pb-8">
          <ListCard>
          {filtered.map((p) => {
            const status = productStatus(p);
            const totalVariants = p.variants.length;
            const dotColor = CATEGORY_DOT[p.category] ?? "#888";
            return (
              <ListRow
                key={p.id}
                onClick={() => navigate(`${base}/products/${p.id}`)}
                tile={p.imageUrl ? (
                  <img src={p.imageUrl} alt={p.name} className="size-10 rounded-[var(--radius-tile)] object-cover shrink-0" />
                ) : (
                  <div
                    className="size-10 rounded-[var(--radius-tile)] shrink-0 flex items-center justify-center text-11 font-bold"
                    style={{ background: dotColor + "22", color: dotColor }}
                  >
                    {p.name.charAt(0)}
                  </div>
                )}
                trailing={<ChevronRight size={18} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
              >
                  {/* Four facts and no more: what it is called, what kind of thing it is,
                      how many packs it comes in, and whether it can be sold. The supplier and
                      the barcode code were both on every row and neither decides anything from
                      a list — they are one tap away on the product itself. */}
                  <div className="flex flex-col gap-0.5">
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span
                        className="text-10 font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ background: dotColor + "20", color: dotColor }}
                      >
                        {t(CATEGORY_KEYS[p.category] ?? "products.all")}
                      </span>
                      <span className="text-10" style={{ color: "var(--text-secondary)" }}>
                        {totalVariants} {totalVariants > 1 ? t("products.variants") : t("products.variant")}
                      </span>
                      <span
                        className="text-10 font-semibold"
                        style={{ color: getStockStatusColor(status) }}
                      >
                        {getStockStatusLabel(status, t)}
                      </span>
                    </div>
                  </div>
              </ListRow>
            );
          })}
          </ListCard>
        </div>
      )}
    </div>
      {/* Floating Add Product (admin only) */}
      {base === "/admin" && (
        <div
          className="fixed start-0 end-0 max-w-[480px] mx-auto pointer-events-none z-40"
          style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}
        >
          <div className={`flex px-4 ${isUrdu ? "justify-start" : "justify-end"}`}>
            <button
              onClick={() => navigate("/admin/inventory/new")}
              className="pointer-events-auto h-13 ps-4 pe-5 rounded-full flex items-center gap-2 text-sm font-bold shadow-lg active:scale-95 transition-transform"
              style={{ background: "var(--brand)", color: "#0a0a0a", height: "52px", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
            >
              <Plus size={20} strokeWidth={2.5} /> {t("products.addButton")}
            </button>
          </div>
        </div>
      )}
    </PullToRefresh>
  );
}
