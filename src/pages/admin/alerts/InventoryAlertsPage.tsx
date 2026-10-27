import { useNavigate } from "react-router-dom";
import { AlertTriangle, Boxes, Package, PackageCheck } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import StockRow from "@/components/inventory/StockRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useProductsStore } from "@/stores/productsStore";
import { useShopStore } from "@/stores/shopStore";
import { getStockStatusColor, getStockStatusLabel } from "@/lib/formatters";
import { stockItems, unitWord } from "@/lib/inventoryView";

/**
 * Stock alerts: the packs that need a decision, worst first.
 *
 * RESHAPED (owner's reference, 2026-10-28). This screen used to carry three things at once — a
 * supplier-payables row, out-of-stock products and low-stock products — with the payables figure
 * belonging to Purchases & Suppliers, where the section already has its own "outstanding
 * payables" row. What is left is the job the row in Products & Inventory names: what has run out
 * and what is about to.
 *
 * A row is a PACK, not a product, and that is the change that makes this screen usable: "Green
 * Crop Spray is low" is not something anyone can act on when the product has three packs and only
 * one of them is nearly gone. The pack is what is counted, ordered and adjusted — so the pack is
 * what is listed, with the branch it sits in, and the two figures at the top count these same
 * rows rather than a different unit the list does not show.
 */
export default function InventoryAlertsPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const products = useProductsStore((s) => s.products);
  const ready = useProductsStore((s) => s.ready);
  const branch = useShopStore((s) => s.activeBranchName);

  const items = stockItems(products);
  const out = items.filter((item) => item.status === "out_of_stock");
  const low = items.filter((item) => item.status === "low_stock");
  const alerts = [...out, ...low];

  const figure = (label: string, count: number, tone: "error" | "warning") => {
    const lit = count > 0;
    return (
      <div
        className="flex-1 min-w-0 rounded-[var(--radius-card)] p-3.5"
        style={{ background: lit ? (tone === "error" ? "var(--error-bg)" : "var(--warning-bg)") : "var(--surface-2)" }}
      >
        <p className="ds-section-label truncate" style={{ color: "var(--text-secondary)" }}>
          {label}
        </p>
        <p
          className="text-20 font-bold mt-0.5"
          style={{ color: lit ? (tone === "error" ? "var(--error)" : "var(--warning)") : "var(--text-primary)" }}
          data-testid={tone === "error" ? "stock-alerts-out" : "stock-alerts-low"}
        >
          {ready ? count : "—"}
        </p>
      </div>
    );
  };

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="stock-alerts-page"
    >
      <StatusBar />
      <NavHeader title={t("settings.lowStockAlerts")} backTo={`${base}/settings/hub/inventory`} />

      <div className="flex gap-2.5 px-4 pt-3">
        {figure(t("products.lowStock"), low.length, "warning")}
        {figure(t("products.outOfStock"), out.length, "error")}
      </div>

      {!ready ? (
        <SkeletonList rows={5} tile />
      ) : alerts.length === 0 ? (
        <div className="px-4 pt-10 flex flex-col items-center gap-3">
          <div
            className="size-12 rounded-full flex items-center justify-center"
            style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
          >
            <PackageCheck size={20} />
          </div>
          <p className="text-13 font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("admin.inventoryHealthy")}
          </p>
          <p className="text-11 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("admin.noStockAlerts")}
          </p>
        </div>
      ) : (
        <div className="pb-8">
          <p className="text-15 font-bold px-4 mt-5 mb-2">{t("hub.inventory.stockItems")}</p>
          <ListCard className="mx-4">
            {alerts.map((item) => (
              <StockRow
                key={item.key}
                testId={`stock-alert-${item.key}`}
                icon={item.status === "out_of_stock" ? Package : AlertTriangle}
                title={item.productName}
                line={`${item.variantName} · ${item.qty} ${unitWord(item.baseUnit, t)}`}
                note={branch ?? undefined}
                statusLabel={getStockStatusLabel(item.status, t)}
                statusColor={getStockStatusColor(item.status)}
                onClick={() => navigate(`${base}/inventory/${item.productId}/adjust`)}
              />
            ))}
          </ListCard>
          {/* A shelf can be empty and still be stocked; this line says what "0" means here. */}
          <div className="px-4 pt-4 flex items-center gap-2">
            <Boxes size={14} style={{ color: "var(--text-tertiary)" }} />
            <p className="text-11" style={{ color: "var(--text-tertiary)" }}>
              {t("alerts.stockScopeNote", { branch: branch ?? t("hub.inventory.selectedBranch") })}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
