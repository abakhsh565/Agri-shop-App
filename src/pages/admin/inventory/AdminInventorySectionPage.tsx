import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Barcode,
  CalendarClock,
  ChevronRight,
  Layers,
  Package,
  PackagePlus,
  Plus,
  RefreshCw,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import SearchBar from "@/components/ui/SearchBar";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useProductsStore } from "@/stores/productsStore";
import { useShopStore } from "@/stores/shopStore";
import { hasPermission } from "@/lib/tenantContext";
import { inventoryCounts } from "@/lib/inventoryView";
import { hubSection } from "@/lib/settingsHub";

/**
 * Products & Inventory, as one screen: the shelf in four figures, one way to add to it, and the
 * section's own doors.
 *
 * SHAPE (owner's reference, 2026-10-28): the section's header card, Add product as the one quick
 * action, the four counts, the search field, then the shortcut rows — the same anatomy as the
 * Sales section screen, so the two parts of the business are read the same way.
 *
 * THE FOUR FIGURES ARE THE SCREEN'S OWN. Products, low stock, out of stock and expiring are
 * counted by `lib/inventoryView`, which is also what the four screens behind these rows count —
 * so a figure and the list it opens can never disagree. Nothing here is estimated: the products
 * are the working branch's rows, already scoped by the read that loaded them.
 *
 * The rows come from `lib/settingsHub`, the same catalogue the Settings menu reads, so this
 * screen cannot offer a job the app does not have.
 */
export default function AdminInventorySectionPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const products = useProductsStore((s) => s.products);
  const ready = useProductsStore((s) => s.ready);
  const branchName = useShopStore((s) => s.activeBranchName);
  const [query, setQuery] = useState("");

  const catalogue = hubSection("inventory")?.rows ?? [];
  const rowLabel = (id: string, fallbackKey: string) => {
    const row = catalogue.find((r) => r.id === id);
    return t(row?.labelKey ?? fallbackKey);
  };

  const counts = inventoryCounts(products);

  /** The search field hands its words to the products list, which owns searching the shelf. */
  function search() {
    const term = query.trim();
    navigate(term ? `${base}/products?q=${encodeURIComponent(term)}` : `${base}/products`);
  }

  const figure = (label: string, count: number, tone?: "error" | "warning") => (
    <div className="flex-1 min-w-0 flex flex-col gap-1">
      <p className="ds-section-label truncate" style={{ color: "var(--text-secondary)" }}>
        {label}
      </p>
      <p
        className="text-16 font-bold"
        style={{
          color:
            !ready || count === 0
              ? "var(--text-primary)"
              : tone === "error"
                ? "var(--error)"
                : tone === "warning"
                  ? "var(--warning)"
                  : "var(--text-primary)",
        }}
      >
        {ready ? count : "—"}
      </p>
    </div>
  );

  const shortcuts: { id: string; icon: LucideIcon; title: string; hint: string; run: () => void }[] = [
    {
      id: "products",
      icon: Package,
      title: rowLabel("products", "hub.inventory.products"),
      hint: t("hub.inventory.productsHint"),
      run: () => navigate(`${base}/products`),
    },
    {
      id: "variants",
      icon: Layers,
      title: rowLabel("variants", "hub.inventory.variants"),
      hint: t("hub.inventory.variantsHint"),
      run: () => navigate(`${base}/products`),
    },
    {
      id: "stock",
      icon: Warehouse,
      title: rowLabel("stock", "hub.inventory.stock"),
      hint: t("hub.inventory.stockHint"),
      run: () => navigate(`${base}/inventory/stock`),
    },
    {
      id: "movements",
      icon: RefreshCw,
      title: rowLabel("movements", "hub.inventory.movements"),
      hint: t("hub.inventory.movementsHint"),
      run: () => navigate(`${base}/inventory/movements`),
    },
    {
      id: "low-stock",
      icon: AlertTriangle,
      title: rowLabel("low-stock", "hub.inventory.lowStock"),
      hint: t("hub.inventory.lowStockHint"),
      run: () => navigate(`${base}/alerts/inventory`),
    },
    {
      id: "expiring",
      icon: CalendarClock,
      title: rowLabel("expiring", "hub.inventory.expiring"),
      hint: t("hub.inventory.expiringHint"),
      run: () => navigate(`${base}/alerts/expiry`),
    },
  ];
  // Barcodes are the printing half of the shelf and live in the same part of the business. Only
  // shown to someone who may actually print labels, so the row is never a dead end.
  if (hasPermission("products.create")) {
    shortcuts.push({
      id: "barcodes",
      icon: Barcode,
      title: t("hub.inventory.barcodes"),
      hint: t("hub.inventory.barcodesHint"),
      run: () => navigate(`${base}/inventory/barcodes`),
    });
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="inventory-hub-page"
    >
      <StatusBar />
      <NavHeader title={t("settings.menu.inventory")} backTo={`${base}/settings`} />

      <div className="px-4 pt-1">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-16 font-bold" style={{ color: "var(--text-primary)" }}>
                {t("settings.menu.inventory")}
              </p>
              <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>
                {t("hub.inventory.subtitle")}
              </p>
            </div>
            {/* The mark alone, as the reference draws it: the card's own title already says
                which part of the business this is. */}
            <Package size={20} style={{ color: "var(--brand-dark)" }} className="shrink-0" />
          </div>

          {/* The one quick action: putting something new on the shelf. */}
          <button
            type="button"
            onClick={() => navigate(`${base}/inventory/new`)}
            data-testid="hub-row-new-product"
            className="mt-3 w-full flex items-center gap-3 rounded-[var(--radius-tile)] p-3 text-start active:opacity-70"
            style={{ background: "var(--surface-2)" }}
          >
            <span
              className="size-10 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
              style={{ background: "var(--brand)" }}
            >
              <Plus size={20} style={{ color: "#0a0a0a" }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-14 font-bold" style={{ color: "var(--text-primary)" }}>
                {t("hub.inventory.addProduct")}
              </span>
              <span className="block text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {t("hub.inventory.addProductHint")}
              </span>
            </span>
            <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
          </button>

          <div className="flex gap-3 mt-4">
            {figure(t("hub.inventory.productsCount"), counts.products)}
            {figure(t("hub.inventory.lowStockCount"), counts.low, "warning")}
          </div>
          <div className="flex gap-3 mt-3">
            {figure(t("hub.inventory.outOfStockCount"), counts.out, "error")}
            {figure(t("hub.inventory.expiryCount"), counts.expiring, "warning")}
          </div>

          {branchName && (
            <p className="text-10 mt-3" style={{ color: "var(--text-tertiary)" }}>
              {t("products.stockInBranch", { branch: branchName })}
            </p>
          )}
        </div>
      </div>

      {/* Search hands off to the products list, which owns searching the shelf. */}
      <div className="px-4 pt-3">
        <SearchBar
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onClear={() => setQuery("")}
          onKeyDown={(e) => {
            if (e.key === "Enter") search();
          }}
          placeholder={t("products.search")}
        />
      </div>

      <p className="text-15 font-bold px-4 mt-5 mb-1">{t("hub.inventory.shortcuts")}</p>

      <div className="pb-6">
        {shortcuts.map((row) => (
          <ListRow
            key={row.id}
            testId={`hub-row-${row.id}`}
            icon={row.icon}
            title={row.title}
            description={row.hint}
            trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            onClick={row.run}
          />
        ))}
        {/* One quiet line for the case the shelf is empty: a new branch has nothing to count, and
            four zeroes with no explanation read as a broken screen. */}
        {ready && counts.products === 0 && (
          <div className="px-4 pt-5 flex items-center gap-2">
            <PackagePlus size={16} style={{ color: "var(--text-tertiary)" }} />
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>
              {t("hub.inventory.emptyShelf")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
