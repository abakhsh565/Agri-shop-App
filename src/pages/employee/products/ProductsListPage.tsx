import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
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
import { useShellBase } from "@/lib/useShellBase";
import { hasPermission } from "@/lib/tenantContext";
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
const CATEGORY_KEYS: Record<string, I18nKey> = {
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

/**
 * Products, as the reference draws it: search, the category chips, then one row per product —
 * its tile, its name, what kind of thing it is, how many packs it comes in, and whether it can
 * be sold. The floating Add product button is the one action, shown only to an account the
 * owner has granted `products.create`.
 *
 * DRAFTS ARE A CHIP, NOT A SECOND LIST. They still sit above the shelf when "All" is picked,
 * because unfinished work is the thing that gets forgotten and finished stock is not; the
 * "Draft" chip opens them on their own when the job is to finish one. A draft is not a product,
 * so it never appears in a category filter.
 *
 * A SEARCH STARTED ON PRODUCTS & INVENTORY lands here as `?q=`, where searching the shelf
 * actually happens — one search field, one implementation.
 */
type Filter = "all" | ProductCategory | "draft";

export default function ProductsListPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();

  const products = useProductsStore((s) => s.products);
  const ready = useProductsStore((s) => s.ready);
  // Half-finished products, read from this device and only for the branch being looked at —
  // a draft is not a product, so it cannot arrive from the products store with the rest.
  const activeShopId = useShopStore((s) => s.activeShopId);
  const activeBranchName = useShopStore((s) => s.activeBranchName);
  const drafts = loadProductDrafts(activeShopId);
  const { search: addressQuery } = useLocation();
  const [search, setSearch] = useState(() => new URLSearchParams(addressQuery).get("q") ?? "");
  const [filter, setFilter] = useState<Filter>("all");

  const FILTERS: { key: Filter; label: I18nKey }[] = [
    { key: "all", label: "products.all" },
    { key: "pesticide", label: "category.pesticide" },
    { key: "seed", label: "category.seed" },
    { key: "fertilizer", label: "category.fertilizer" },
    { key: "draft", label: "draft.chip" },
  ];

  const term = search.trim().toLowerCase();
  const matchesSearch = (name: string, company: string) =>
    !term || name.toLowerCase().includes(term) || company.toLowerCase().includes(term);

  const filtered = products.filter((p) => {
    // The Draft chip is not a category: it hides the shelf and shows the local drafts below.
    const matchCat =
      filter === "draft"
        ? false
        : filter === "all" ||
          p.category === filter ||
          (filter === "pesticide" && p.category === "spray");
    return matchesSearch(p.name, p.company) && matchCat;
  });

  const visibleDrafts = drafts.filter((d) => matchesSearch(d.name, ""));

  function productStatus(p: Product) {
    const statuses = p.variants.map((v) => getStockStatus(v.stockQty, v.lowStockThreshold));
    if (statuses.every((s) => s === "out_of_stock")) return "out_of_stock" as const;
    if (statuses.some((s) => s === "low_stock"))     return "low_stock" as const;
    return "in_stock" as const;
  }

  async function handleRefresh() {
    await useProductsStore.getState().load();
  }

  const draftCard = visibleDrafts.length > 0 && (
    <ListCard>
      {visibleDrafts.map((d) => {
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
  );

  return (
    <PullToRefresh onRefresh={handleRefresh}>
      <div
        className="flex flex-col w-full min-h-full"
        style={{ background: "var(--background)" }}
      >
        <StatusBar />
        {/* Products & Inventory is this screen's parent on the owner's side; an employee's own
            dashboard is theirs, because the section hub belongs to the admin shell. */}
        <NavHeader
          title={t("products.title")}
          backTo={base === "/admin" ? `${base}/settings/hub/inventory` : `${base}/dashboard`}
        />
        {activeBranchName && (
          <p className="text-10 text-center pb-2" style={{ color: "var(--text-secondary)" }}>
            {t("products.stockInBranch", { branch: activeBranchName })}
          </p>
        )}

        <div className="px-4 pb-3">
          <SearchBar
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onClear={() => setSearch("")}
            placeholder={t("products.search")}
          />
        </div>

        {/* One chip per way of looking at the shelf: the three categories it files products
            under, plus the unfinished work that is not on it yet. */}
        <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className="shrink-0 h-9 px-4 rounded-full text-12 font-semibold transition-colors active:opacity-70"
              style={{
                background: filter === key ? "var(--brand)" : "var(--surface-2)",
                color: filter === key ? "#0a0a0a" : "var(--text-secondary)",
              }}
            >
              {t(label)}
            </button>
          ))}
        </div>

        {/* On "All", drafts sit above the shelf: unfinished work is what gets forgotten. */}
        {filter === "all" && visibleDrafts.length > 0 && (
          <div className="px-4 pb-3">
            <p className="ds-section-label mb-2 px-1">{t("draft.section")}</p>
            {draftCard}
          </div>
        )}

        {filter === "draft" ? (
          visibleDrafts.length > 0 ? (
            <div className="px-4 pb-8">{draftCard}</div>
          ) : (
            <div className="flex flex-col items-center px-6 py-16 gap-2">
              <Pencil size={26} style={{ color: "var(--text-tertiary)" }} />
              <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>
                {t("draft.none")}
              </p>
            </div>
          )
        ) : !ready ? (
          <SkeletonList rows={5} tile />
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-16 gap-2">
            <Package size={28} style={{ color: "var(--text-tertiary)" }} />
            <p className="text-13 text-center" style={{ color: "var(--text-secondary)" }}>
              {term ? t("products.noResults") : t("admin.noProducts")}
            </p>
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
                      <p className="text-14 font-bold" style={{ color: "var(--text-primary)" }}>{p.name}</p>
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

      {/* Floating Add Product — shown wherever the owner granted `products.create`, which the
          Add Product screen's own guard checks too. It used to be tied to the admin shell, so
          an employee who was granted the permission saw no way to use it at all. */}
      {hasPermission("products.create") && (
        <div
          className="fixed start-0 end-0 max-w-[480px] mx-auto pointer-events-none z-40"
          style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}
        >
          <div className="flex px-4 justify-end">
            <button
              onClick={() => navigate(`${base}/inventory/new`)}
              className="pointer-events-auto ps-4 pe-5 rounded-full flex items-center gap-2 text-14 font-bold active:scale-95 transition-transform"
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
