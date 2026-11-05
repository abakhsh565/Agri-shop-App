import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Layers, Plus } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useCatalogueStore } from "@/stores/catalogueStore";
import { useProductsStore } from "@/stores/productsStore";
import { hasPermission } from "@/lib/tenantContext";
import {
  categoryDisplayName,
  categoryItemCount,
  orderedCategories,
  subcategoryCount,
} from "@/lib/catalogue";
import type { ShopCategory } from "@/types";

/**
 * The shop's shelves, one level deep.
 *
 * The reference draws a quiet list: a search field, a plus in the header, and one row per shelf
 * with its name, how many shelves sit under it, and how many products are on it. That is the
 * whole screen — opening a row is editing it, and the plus is the only other verb. A shopkeeper
 * does not need a page that explains categories; they need to see theirs.
 *
 * CHILDREN ARE SHOWN UNDER THEIR PARENT. The reference hides them behind the parent's own
 * screen; this list indents them instead, because there is no second category screen here and a
 * shelf that exists in the picker but nowhere in the list is how a mistyped subcategory becomes
 * invisible. The meta line says which shelf it belongs to.
 *
 * THE COUNTS ARE THE PRODUCTS' OWN. A parent counts its children's products too, through
 * `categoryItemCount`, so "12 items" on Pesticide includes what sits on its subcategories —
 * otherwise the parent would look emptier than the shelf it describes.
 */
export default function CategoriesPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const categories = useCatalogueStore((s) => s.categories);
  const ready = useCatalogueStore((s) => s.ready);
  const products = useProductsStore((s) => s.products);
  const [query, setQuery] = useState("");

  const canEdit = hasPermission("products.edit");

  const needle = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const lines = orderedCategories(categories);
    if (!needle) return lines;
    return lines.filter((line) => {
      const name = categoryDisplayName(line.category, t).toLowerCase();
      const parent = line.parent ? categoryDisplayName(line.parent, t).toLowerCase() : "";
      return name.includes(needle) || parent.includes(needle);
    });
    // `t` is stable for a language; the list is rebuilt when the shop's shelves change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, needle]);

  /** The reference's initials tile: the first letters of the shelf's own name. */
  function initials(category: ShopCategory): string {
    const words = categoryDisplayName(category, t).trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "?";
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  /** "1 subcategory" reads differently from "3 subcategories", and both are said out loud. */
  const subcategoriesLabel = (count: number) =>
    count === 1 ? t("categories.subcategoryOne") : t("categories.subcategories", { count: String(count) });
  const itemsLabel = (count: number) =>
    count === 1 ? t("categories.itemOne") : t("categories.items", { count: String(count) });

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="categories-page"
    >
      <StatusBar />
      <NavHeader
        title={t("categories.title")}
        backTo={`${base}/inventory/catalogue`}
        right={
          canEdit ? (
            <button
              type="button"
              onClick={() => navigate(`${base}/inventory/categories/new`)}
              aria-label={t("categories.add")}
              data-testid="categories-add"
              className="size-9 rounded-full flex items-center justify-center active:opacity-70"
              style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
            >
              <Plus size={18} />
            </button>
          ) : undefined
        }
      />

      <div className="px-4 pt-1 pb-3">
        <SearchBar
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder={t("categories.searchHint")}
          aria-label={t("categories.searchHint")}
          data-testid="categories-search"
        />
      </div>

      {ready && categories.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t("categories.emptyTitle")}
          subtitle={t("categories.emptyBody")}
          action={
            canEdit
              ? {
                  label: t("categories.add"),
                  onClick: () => navigate(`${base}/inventory/categories/new`),
                }
              : undefined
          }
        />
      ) : (
        <div className="pb-6">
          {/* No card around the shelves: the reference draws them straight on the page, with a
              hairline between rows. The rows keep that rule; the box around them was ours. */}
          <ListCard variant="plain">
            {visible.map(({ category, parent }) => (
              <ListRow
                key={category.id}
                testId={`category-row-${category.id}`}
                tile={
                  <span
                    className="size-11 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0 text-13 font-bold"
                    style={{
                      background: parent ? "var(--surface-2)" : "var(--tone-card)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {initials(category)}
                  </span>
                }
                title={categoryDisplayName(category, t)}
                meta={
                  parent
                    ? `${t("categories.under", { name: categoryDisplayName(parent, t) })} · ${subcategoriesLabel(
                        subcategoryCount(category, categories),
                      )}`
                    : subcategoriesLabel(subcategoryCount(category, categories))
                }
                value={itemsLabel(categoryItemCount(category, categories, products))}
                trailing={
                  <ChevronRight
                    size={16}
                    style={{ color: "var(--text-secondary)" }}
                    className="shrink-0"
                  />
                }
                onClick={
                  canEdit
                    ? () => navigate(`${base}/inventory/categories/${category.id}`)
                    : undefined
                }
                className={parent ? "ps-8" : ""}
              />
            ))}
          </ListCard>

          {ready && visible.length === 0 && (
            <p className="pt-6 text-center text-13" style={{ color: "var(--text-secondary)" }}>
              {t("categories.noMatch", { query: query.trim() })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
