import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  Barcode,
  CalendarClock,
  ChevronRight,
  Download,
  Package,
  Plus,
  RefreshCw,
  Share2,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import SectionActionsSheet, { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import { csvFileName, exportCsv, exportText, toCsv } from "@/lib/exportData";
import { useUIStore } from "@/stores/uiStore";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { useProductsStore } from "@/stores/productsStore";
import { useShopStore } from "@/stores/shopStore";
import { hasPermission } from "@/lib/tenantContext";
import { inventoryCounts } from "@/lib/inventoryView";
import { hubSection } from "@/lib/settingsHub";
import { EXPIRY_WARNING_DAYS } from "@/lib/signalEngine";
import { formatCompactCurrency } from "@/lib/formatters";

/**
 * Products & Inventory, as one screen: what the shelf is worth, four figures about it, one way
 * to add to it, and the section's own doors.
 *
 * SHAPE (owner's reference, 2026-10-28): the two headline figures sit unboxed at the top — the
 * value of what the branch holds and how many products are listed; the four counts follow as one
 * plate; Add product is the single quick action; the shortcut rows close the screen. This is the
 * same anatomy as the Sales section screen, so the two parts of the business are read the same
 * way, while the figures are the ones a shopkeeper asks for about stock.
 *
 * THE VALUE IS THE SERVER'S, NOT A SUM THIS SCREEN INVENTS. The branch's `inventoryValue` is
 * calculated from the movement ledger, with `inventoryCostIncomplete` saying whether every pack
 * had a cost to value it at — so an incomplete shelf shows a floor (`≥`) rather than a smaller,
 * wrong number, exactly as the branch card and the business overview state it.
 *
 * THE FOUR FIGURES ARE THE SCREEN'S OWN. Packs, low stock, out of stock and expiring are counted
 * by `lib/inventoryView`, which is also what the four screens behind these rows count — so a
 * figure and the list it opens can never disagree. Nothing here is estimated: the products are
 * the working branch's rows, already scoped by the read that loaded them.
 *
 * The rows come from `lib/settingsHub`, the same catalogue the Settings menu reads, so this
 * screen cannot offer a job the app does not have.
 */
export default function AdminInventorySectionPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  // Settings when opened from the menu, the Reports hub when opened from its Inventory tile.
  const returnTo = useReturnTo(`${base}/settings`);
  const products = useProductsStore((s) => s.products);
  const ready = useProductsStore((s) => s.ready);
  const branchName = useShopStore((s) => s.activeBranchName);
  const branches = useShopStore((s) => s.branches);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;

  const catalogue = hubSection("inventory")?.rows ?? [];
  const rowLabel = (id: string, fallbackKey: string) => {
    const row = catalogue.find((r) => r.id === id);
    return t(row?.labelKey ?? fallbackKey);
  };

  const counts = inventoryCounts(products);

  // What this branch's own stock is worth, at today's cost — never a figure summed here from a
  // price the screen happened to hold. NULL means the caller may not see inventory value.
  const inventoryValue = branchesLoaded ? activeBranch?.inventoryValue ?? null : null;
  const valueIncomplete = branchesLoaded && activeBranch?.inventoryCostIncomplete === true;
  const valueLabel =
    inventoryValue == null
      ? "—"
      : `${valueIncomplete ? "≥ " : ""}${formatCompactCurrency(inventoryValue)}`;

  const [menuOpen, setMenuOpen] = useState(false);
  const { addToast } = useUIStore();

  /** The figures this screen is showing, as rows — the same numbers the owner can see. */
  const figureRows = [
    { label: t("hub.inventory.totalValue"), value: valueLabel, note: branchName ?? "" },
    { label: t("hub.inventory.listedProducts"), value: ready ? String(counts.products) : "—", note: "" },
    { label: t("hub.inventory.packsCount"), value: ready ? String(counts.packs) : "—", note: t("hub.inventory.packsCaption") },
    { label: t("hub.inventory.lowStockCount"), value: ready ? String(counts.low) : "—", note: t("hub.inventory.lowStockCaption") },
    { label: t("hub.inventory.outOfStockCount"), value: ready ? String(counts.out) : "—", note: t("hub.inventory.outOfStockCaption") },
  ];

  async function exportFigures() {
    setMenuOpen(false);
    try {
      const csv = toCsv(
        [
          { label: t("hub.inventory.totalValue"), value: (r: (typeof figureRows)[number]) => r.label },
          { label: t("common.total"), value: (r: (typeof figureRows)[number]) => r.value },
        ],
        figureRows,
      );
      const outcome = await exportCsv(csvFileName("inventory"), csv, t("settings.menu.inventory"));
      addToast(outcome === "shared" ? t("data.exportedShared") : t("data.exported"), "success");
    } catch {
      addToast(t("data.exportFailed"), "error");
    }
  }

  async function shareFigures() {
    setMenuOpen(false);
    const text = figureRows.map((r) => `${r.label}: ${r.value}`).join("\n");
    try {
      const outcome = await exportText(text, t("settings.menu.inventory"));
      addToast(outcome === "shared" ? t("sales.reportShared") : t("sales.reportCopied"), "success");
    } catch {
      addToast(t("sales.shareFailed"), "error");
    }
  }

  const shortcuts: { id: string; icon: LucideIcon; title: string; hint: string; run: () => void }[] = [
    {
      id: "products",
      icon: Package,
      title: rowLabel("products", "hub.inventory.products"),
      hint: t("hub.inventory.productsHint"),
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

  /**
   * One of the four figures: its name, the count, and what the count actually measures. The
   * caption is the reference's second line under each count — in the mock it was a placeholder
   * ("Illustrative count"); here it says what the number counts, so "12 low" cannot be read as
   * twelve products when it is twelve packs.
   */
  const figure = (
    label: string,
    count: number,
    caption: string,
    tone?: "error" | "warning",
  ) => (
    <div className="min-w-0">
      <p className="text-12" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <p
        className="text-16 font-bold mt-0.5"
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
      <p className="text-10 mt-0.5" style={{ color: "var(--text-tertiary)" }}>{caption}</p>
    </div>
  );

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="inventory-hub-page"
    >
      <StatusBar />
      <NavHeader
        title={t("settings.menu.inventory")}
        backTo={returnTo}
        right={<SectionActionsButton onClick={() => setMenuOpen(true)} label={t("data.export")} testId="inventory-actions" />}
      />

      <SectionActionsSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t("settings.menu.inventory")}
        actions={[
          { id: "export", icon: Download, title: t("data.export"), description: t("data.exportHint"), onClick: () => { void exportFigures(); } },
          { id: "share", icon: Share2, title: t("sales.shareReport"), description: t("sales.shareReportHint"), onClick: () => { void shareFigures(); } },
        ]}
      />

      {/* The two headline figures, unboxed, as the reference draws them: what the shelf is
          worth and how many products are listed on it. */}
      <div className="px-4 pt-2 flex items-start gap-5">
        <div className="min-w-0 flex-1">
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {t("hub.inventory.totalValue")}
          </p>
          <p
            className="text-22 font-bold mt-1 leading-none break-words"
            style={{ color: "var(--text-primary)" }}
            data-testid="inventory-hub-value"
          >
            {valueLabel}
          </p>
          {valueIncomplete && inventoryValue != null && (
            <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>
              {t("shop.inventoryValueIncomplete")}
            </p>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {t("hub.inventory.listedProducts")}
          </p>
          <p
            className="text-22 font-bold mt-1 leading-none"
            style={{ color: "var(--text-primary)" }}
            data-testid="inventory-hub-products"
          >
            {ready ? counts.products : "—"}
          </p>
        </div>
      </div>
      {branchName && (
        <p className="px-4 pt-2 text-10" style={{ color: "var(--text-tertiary)" }}>
          {t("products.stockInBranch", { branch: branchName })}
        </p>
      )}

      <div className="px-4 pt-4">
        <div
          className="rounded-[var(--radius-card)] p-4 grid grid-cols-2 gap-x-4 gap-y-4"
          style={{ background: "var(--surface)" }}
        >
          {figure(
            t("hub.inventory.packsCount"),
            counts.packs,
            t("hub.inventory.packsCaption"),
          )}
          {figure(
            t("hub.inventory.lowStockCount"),
            counts.low,
            t("hub.inventory.lowStockCaption"),
            "warning",
          )}
          {figure(
            t("hub.inventory.outOfStockCount"),
            counts.out,
            t("hub.inventory.outOfStockCaption"),
            "error",
          )}
          {figure(
            t("hub.inventory.expiryCount"),
            counts.expiring,
            t("hub.inventory.expiryCaption", { days: EXPIRY_WARNING_DAYS }),
            "warning",
          )}
        </div>
      </div>

      {/* The one quick action: putting something new on the shelf. */}
      <div className="px-4 pt-3">
        <button
          type="button"
          onClick={() => navigate(`${base}/inventory/new`)}
          data-testid="hub-row-new-product"
          className="w-full flex items-center gap-3 rounded-[var(--radius-card)] p-3 text-start active:opacity-70"
          style={{ background: "var(--surface)" }}
        >
          <span
            className="size-10 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
            style={{ background: "var(--surface-2)" }}
          >
            <Plus size={20} style={{ color: "var(--brand-dark)" }} />
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
      </div>

      {/* The section's doors, unboxed like the Sales hub: each row is a different place, so a
          card around them would draw a second edge without grouping anything. */}
      <div className="pt-4 pb-6">
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
        {/* One quiet line for the case the shelf is empty: four zeroes with no explanation read as
            a broken screen. */}
        {ready && counts.products === 0 && (
          <p className="px-4 pt-4 text-12" style={{ color: "var(--text-secondary)" }}>
            {t("hub.inventory.emptyShelf")}
          </p>
        )}
      </div>
    </div>
  );
}
