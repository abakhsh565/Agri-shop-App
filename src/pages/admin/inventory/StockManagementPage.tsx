import { useNavigate } from "react-router-dom";
import { Boxes, Warehouse } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import StockRow from "@/components/inventory/StockRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useProductsStore } from "@/stores/productsStore";
import { useShopStore } from "@/stores/shopStore";
import { hasPermission } from "@/lib/tenantContext";
import { formatCurrency, getStockStatusColor, getStockStatusLabel } from "@/lib/formatters";
import { stockItems, unitWord } from "@/lib/inventoryView";

/**
 * Stock management: what the branch is holding, and what it is worth.
 *
 * SHAPE (owner's reference, 2026-10-28): the branch the figures belong to, the inventory value,
 * then one row per pack — the pack, how much of it is on the shelf, and whether that is healthy,
 * low or empty. A row opens the pack's own place: the adjust screen when this account may change
 * a quantity, otherwise the product, where the shelf's history is.
 *
 * WHY IT IS ITS OWN SCREEN. "What do I have and what is it worth" is asked on its own, not only
 * while reordering: the reorder list (`/inventory/reorder`) is the buying decision that follows
 * this answer, and it keeps its own screen and its supply buttons.
 *
 * THE VALUE IS THE ONE NUMBER THIS SCREEN DOES NOT CALCULATE. It is the branch's own
 * `inventoryValue` from the server, with `inventoryCostIncomplete` saying whether every pack had
 * a cost to value it at — shown as "≥" rather than silently valued at zero, the same way the
 * branch card and the business overview state it.
 */
export default function StockManagementPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const products = useProductsStore((s) => s.products);
  const ready = useProductsStore((s) => s.ready);
  const branch = useShopStore((s) => s.activeBranchName);
  // The branch's own figures, read the way the branch card reads them: the value is the server's
  // `inventoryValue`, and `inventoryCostIncomplete` says whether every pack had a cost to value
  // it at — which is the difference between a figure and a floor.
  const branches = useShopStore((s) => s.branches);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const inventoryValue = branchesLoaded ? activeBranch?.inventoryValue ?? null : null;
  const valueIncomplete = branchesLoaded && activeBranch?.inventoryCostIncomplete === true;
  const canAdjust = hasPermission("inventory.adjust");

  const items = stockItems(products);
  const valueLabel =
    inventoryValue == null
      ? "—"
      : `${valueIncomplete ? "≥ " : ""}${formatCurrency(inventoryValue)}`;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="stock-management-page"
    >
      <StatusBar />
      <NavHeader title={t("hub.inventory.stock")} backTo={`${base}/settings/hub/inventory`} />

      <div className="px-4 pt-1">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
        >
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-16 font-bold">{t("hub.inventory.stock")}</p>
            <p className="text-12 shrink-0 text-end" style={{ color: "var(--text-secondary)" }}>
              {branch ?? t("hub.inventory.selectedBranch")}
            </p>
          </div>

          <div className="mt-3">
            <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
              {t("overview.inventoryValue")}
            </p>
            <p className="text-20 font-bold mt-1" style={{ color: "var(--text-primary)" }} data-testid="stock-inventory-value">
              {ready ? valueLabel : "—"}
            </p>
            {valueIncomplete && inventoryValue != null && (
              <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                {t("shop.inventoryValueIncomplete")}
              </p>
            )}
          </div>
        </div>
      </div>

      <p className="text-15 font-bold px-4 mt-5 mb-2">{t("hub.inventory.stockItems")}</p>

      {!ready ? (
        <SkeletonList rows={5} tile />
      ) : items.length === 0 ? (
        <div className="px-4 py-12 flex flex-col items-center gap-2">
          <Warehouse size={26} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-13 font-semibold text-center" style={{ color: "var(--text-primary)" }}>
            {t("hub.inventory.noStockItems")}
          </p>
        </div>
      ) : (
        <div className="pb-8">
          <ListCard className="mx-4">
            {items.map((item) => (
              <StockRow
                key={item.key}
                testId={`stock-item-${item.key}`}
                icon={Boxes}
                title={item.productName}
                line={`${item.variantName} · ${item.qty} ${unitWord(item.baseUnit, t)}`}
                note={branch ?? undefined}
                statusLabel={getStockStatusLabel(item.status, t)}
                statusColor={getStockStatusColor(item.status)}
                onClick={() =>
                  navigate(
                    canAdjust ? `${base}/inventory/${item.productId}/adjust` : `${base}/products/${item.productId}`,
                  )
                }
              />
            ))}
          </ListCard>
          {!canAdjust && (
            <p className="px-4 pt-3 text-11" style={{ color: "var(--text-tertiary)" }}>
              {t("hub.inventory.adjustNotAllowed")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
