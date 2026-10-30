import { useNavigate } from "react-router-dom";
import { ChevronRight, Layers, Package, Ruler } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";

/**
 * Products, as the shop keeps them: every product, the shelves they sit on, and the units they
 * are sold in.
 *
 * WHY THIS SCREEN EXISTS. The inventory hub used to have one door called "Products" that opened
 * the product list. The owner's reference draws that door as a small menu of its own — All
 * items, Categories, Units — because those three are the same subject and each answers a
 * different question: what do I sell, how is it grouped, and how is it measured. This is that
 * menu, and nothing else: no figure is repeated from the hub, and no row does two things.
 *
 * ALL PRODUCTS IS THE LIST THAT ALREADY EXISTS. It opens the product screen rather than a
 * second rendering of the same rows, so there is one place where a product is edited and one
 * place where a search is written.
 */
export default function InventoryCataloguePage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  // Settings when opened from the menu, the Reports hub when opened from its Inventory tile.
  const returnTo = useReturnTo(`${base}/settings/hub/inventory`);

  // No counts on these rows. "7" at the end of a line, with no noun, read as a stray number
  // rather than as information, and the number is already on the screen behind each door.
  const rows = [
    {
      id: "all-products",
      icon: Package,
      title: t("catalogue.allProducts"),
      hint: t("catalogue.allProductsHint"),
      to: `${base}/products`,
    },
    {
      id: "categories",
      icon: Layers,
      title: t("catalogue.categories"),
      hint: t("catalogue.categoriesHint"),
      to: `${base}/inventory/categories`,
    },
    {
      id: "units",
      icon: Ruler,
      title: t("catalogue.units"),
      hint: t("catalogue.unitsHint"),
      to: `${base}/inventory/units`,
    },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="inventory-catalogue-page"
    >
      <StatusBar />
      <NavHeader title={t("catalogue.title")} backTo={returnTo} />

      <div className="px-4 pt-2">
        <p className="text-13" style={{ color: "var(--text-secondary)" }}>
          {t("catalogue.hint")}
        </p>
      </div>

      <div className="pt-5 pb-6">
        {/* The rows are separated by their hairline, not wrapped in a card: three doors on an
            otherwise empty page read better on the page itself than inside a box drawn around
            them (owner's correction, 2026-10-31). */}
        <ListCard variant="plain">
          {rows.map((row) => (
            <ListRow
              key={row.id}
              testId={`catalogue-row-${row.id}`}
              icon={row.icon}
              title={row.title}
              description={row.hint}
              trailing={
                <ChevronRight
                  size={16}
                  style={{ color: "var(--text-secondary)" }}
                  className="shrink-0"
                />
              }
              onClick={() => navigate(row.to)}
            />
          ))}
        </ListCard>
      </div>
    </div>
  );
}
