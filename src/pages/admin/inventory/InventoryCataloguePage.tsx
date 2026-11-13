import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Layers, Plus } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { useCatalogueStore } from "@/stores/catalogueStore";
import { useProductsStore } from "@/stores/productsStore";
import { hasPermission } from "@/lib/tenantContext";
import { categoryDisplayName, categoryItemCount, orderedCategories } from "@/lib/catalogue";
import { MEASUREMENT_FAMILIES } from "@/lib/classification";

/**
 * The catalogue: the shop's shelves, and the three measures every product is sold in.
 *
 * UNITS ARE NOT A SHOP SETTING. Weight, volume and count are the whole set the app can do
 * arithmetic in — pack sizes, stock and bills are all written in one of them — so a fourth unit
 * could never convert, and naming one "Bori" did not change what it measured. The three rows
 * here are therefore fixed and read-only: no name, no symbol, no add, no delete. A shelf says
 * which of the three it uses, and Add Product takes the unit from that answer.
 *
 * CATEGORIES ARE THE ONLY THING TO MANAGE. They are the owner's own words, one level deep, and
 * each one carries the measure its products use. The add row and each row's door live here.
 *
 * THE OLD ADDRESSES STILL WORK. `/inventory/categories` and `/inventory/units` render this same
 * screen (their page modules re-export it), so a bookmark, a form's back arrow or a deep link
 * lands on the one place that now owns the catalogue. Nothing was deleted; the lists were merged.
 */
export default function InventoryCataloguePage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const returnTo = useReturnTo(`${base}/settings/hub/inventory`);
  const categories = useCatalogueStore((s) => s.categories);
  const ready = useCatalogueStore((s) => s.ready);
  const products = useProductsStore((s) => s.products);
  const canEdit = hasPermission("products.edit");

  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();

  const visible = useMemo(() => {
    const lines = orderedCategories(categories);
    if (!needle) return lines;
    return lines.filter(({ category, parent }) => {
      const name = categoryDisplayName(category, t).toLowerCase();
      const parentName = parent ? categoryDisplayName(parent, t).toLowerCase() : "";
      return name.includes(needle) || parentName.includes(needle);
    });
    // `t` is stable for a language; the list is rebuilt when the shop's shelves change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, needle]);

  const itemsLabel = (count: number) =>
    count === 1 ? t("categories.itemOne") : t("categories.items", { count: String(count) });

  const chevron = (
    <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
  );

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="inventory-catalogue-page"
    >
      <StatusBar />
      <NavHeader title={t("catalogue.title")} backTo={returnTo} />

      <div className="px-4 pt-2">
        <SearchBar
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          placeholder={t("categories.searchHint")}
          aria-label={t("categories.searchHint")}
          data-testid="catalogue-search"
        />
      </div>

      {canEdit && (
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={() => navigate(`${base}/inventory/categories/new`)}
            data-testid="catalogue-add-category"
            className="ds-pressable w-full h-12 rounded-full flex items-center justify-center gap-2 text-14 font-bold"
            style={{ background: "#2c2c2a", color: "var(--brand)" }}
          >
            <Plus size={17} />
            {t("categories.add")}
          </button>
        </div>
      )}

      <div className="pb-6">
        <ListCard section={t("catalogue.categories")} variant="plain" separated={false} className="mt-4">
          {visible.map(({ category, parent }) => {
            const count = categoryItemCount(category, categories, products);
            return (
              <ListRow
                key={category.id}
                testId={`catalogue-category-${category.id}`}
                title={categoryDisplayName(category, t)}
                meta={parent ? t("categories.under", { name: categoryDisplayName(parent, t) }) : undefined}
                value={count > 0 ? itemsLabel(count) : undefined}
                trailing={canEdit ? chevron : undefined}
                onClick={canEdit ? () => navigate(`${base}/inventory/categories/${category.id}`) : undefined}
                className={parent ? "ps-8" : ""}
              />
            );
          })}
          {ready && categories.length === 0 && !needle && (
            <ListRow
              icon={Layers}
              title={t("categories.emptyTitle")}
              description={t("categories.emptyBody")}
            />
          )}
        </ListCard>

        {needle && visible.length === 0 ? (
          <p className="px-4 pt-6 text-center text-13" style={{ color: "var(--text-secondary)" }}>
            {t("categories.noMatch", { query: query.trim() })}
          </p>
        ) : null}

        <ListCard section={t("catalogue.units")} variant="plain" separated={false} className="mt-2">
          {MEASUREMENT_FAMILIES.map((option) => (
            <ListRow
              key={option.family}
              testId={`catalogue-unit-${option.family}`}
              title={t(option.labelKey)}
              description={t(option.hintKey)}
            />
          ))}
        </ListCard>
      </div>
    </div>
  );
}
