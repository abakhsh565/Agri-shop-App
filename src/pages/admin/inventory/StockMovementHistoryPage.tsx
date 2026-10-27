import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownToLine, ArrowUpFromLine, Package, RefreshCw, Undo2, type LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useProductsStore } from "@/stores/productsStore";
import { useSalesStore } from "@/stores/salesStore";
import { useShopStore } from "@/stores/shopStore";
import { fetchPurchases } from "@/lib/db";
import { useInventoryMovements, type MovementType } from "@/lib/inventoryMovements";
import { signedQty, unitWord } from "@/lib/inventoryView";
import { formatSmartDateTime } from "@/lib/formatters";
import { useCurrentTime } from "@/lib/useCurrentTime";
import type { BaseUnit } from "@/types";

/**
 * Stock movements: everything that moved a quantity, in the order it moved.
 *
 * REBUILT ON THE LEDGER (owner's reference, 2026-10-28). This screen used to derive its rows
 * from the sales the app had loaded, which meant it could only ever show one of the four things
 * that move stock — a goods-received against a purchase and a counted adjustment were simply
 * missing — and only for sales still inside the loaded window. The database keeps every movement
 * (`inventory_movements`), so the screen reads that.
 *
 * WHAT A ROW SAYS: what happened, which pack it happened to, when, and against which document —
 * a purchase, a sale, a return — so a figure can be traced back to the paper it came from. The
 * quantity carries its sign and its unit ("+20 liters", "−3 bottles") because the direction IS
 * the information.
 *
 * The per-type labels are translated, unlike the hardcoded English this screen used to print.
 */
const TYPE_LABEL_KEY: Record<string, string> = {
  purchase: "moves.purchase",
  sale: "moves.sale",
  adjustment: "moves.adjustment",
  return: "moves.return",
  transfer: "moves.transfer",
};

const TYPE_ICON: Record<string, LucideIcon> = {
  purchase: ArrowDownToLine,
  sale: ArrowUpFromLine,
  adjustment: RefreshCw,
  return: Undo2,
  transfer: RefreshCw,
};

export default function StockMovementHistoryPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const now = useCurrentTime();
  const products = useProductsStore((s) => s.products);
  const sales = useSalesStore((s) => s.sales);
  const branch = useShopStore((s) => s.activeBranchName);
  const { movements, ready } = useInventoryMovements();
  // Spelled `loading`, because that is the gate the skeleton-coverage guard pins for this
  // screen: it waits for its own movement read before it says the shelf has never moved.
  const loading = !ready;
  /** Purchase numbers, so a goods-received row can name the purchase it came from. */
  const [purchaseNumbers, setPurchaseNumbers] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    fetchPurchases()
      .then((rows) => {
        if (!active) return;
        setPurchaseNumbers(Object.fromEntries(rows.map((p) => [p.id, p.purchaseNumber])));
      })
      .catch(() => {
        // A purchase list this account may not read is not an error worth a screen: the row
        // then says what it knows and no more.
      });
    return () => {
      active = false;
    };
  }, []);

  /** The pack a movement is about, from the catalogue the app already holds. */
  function packOf(movementType: MovementType, variantId: string, productId: string) {
    const product = products.find((p) => p.id === productId);
    const variant = product?.variants.find((v) => v.id === variantId);
    return {
      productName: product?.name ?? t("moves.unknownItem"),
      variantName: variant?.name ?? "",
      baseUnit: (product?.baseUnit ?? "piece") as BaseUnit,
    };
  }

  /** The document behind a movement, when it can be named. */
  function referenceOf(movementType: MovementType, referenceType: string, referenceId: string): string {
    if (referenceType === "sale") {
      const sale = sales.find((s) => s.id === referenceId);
      return sale ? t("moves.saleRef", { number: sale.saleNumber }) : "";
    }
    if (referenceType === "purchase") {
      const number = purchaseNumbers[referenceId];
      return number ? t("moves.purchaseRef", { number }) : "";
    }
    if (referenceType === "return") return t("moves.returnRef");
    return "";
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="stock-movements-page"
    >
      <StatusBar />
      <NavHeader title={t("hub.inventory.movements")} backTo={`${base}/settings/hub/inventory`} />

      <div className="px-4 pt-1">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-16 font-bold">{t("hub.inventory.movements")}</p>
              <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>
                {t("moves.subtitle")}
              </p>
            </div>
            <RefreshCw size={20} style={{ color: "var(--brand-dark)" }} className="shrink-0" />
          </div>
        </div>
      </div>

      {loading ? (
        <SkeletonList rows={5} tile />
      ) : movements.length === 0 ? (
        <div className="px-4 py-14 flex flex-col items-center gap-2">
          <Package size={26} style={{ color: "var(--text-tertiary)" }} />
          <p className="text-13 font-semibold text-center" style={{ color: "var(--text-primary)" }}>
            {t("admin.noStockMovements")}
          </p>
          <p className="text-11 text-center" style={{ color: "var(--text-secondary)" }}>
            {t("moves.appearAfter")}
          </p>
        </div>
      ) : (
        <div className="pb-8">
          <ListCard className="mx-4 mt-4">
            {movements.map((movement) => {
              const pack = packOf(movement.type, movement.variantId, movement.productId);
              const unit = unitWord(pack.baseUnit, t);
              const reference = referenceOf(movement.type, movement.referenceType, movement.referenceId);
              const stockIn = movement.qtyChange > 0;
              const Icon = TYPE_ICON[movement.type] ?? RefreshCw;
              return (
                <ListRow
                  key={movement.id}
                  testId={`movement-${movement.id}`}
                  icon={Icon}
                  onClick={movement.productId ? () => navigate(`${base}/products/${movement.productId}`) : undefined}
                  trailing={
                    <div className="text-end shrink-0">
                      <p
                        className="text-13 font-bold whitespace-nowrap"
                        style={{ color: stockIn ? "var(--brand-dark)" : "var(--error)" }}
                      >
                        {signedQty(movement.qtyChange, unit)}
                      </p>
                      <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        {formatSmartDateTime(movement.createdAt, now, t)}
                      </p>
                    </div>
                  }
                >
                  <div className="flex flex-col gap-0.5">
                    <p className="text-13 font-bold truncate" style={{ color: "var(--text-primary)" }}>
                      {t(TYPE_LABEL_KEY[movement.type] ?? "moves.adjustment")}
                    </p>
                    <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                      {pack.productName}
                      {pack.variantName ? ` · ${pack.variantName}` : ""}
                    </p>
                    {(reference || movement.notes) && (
                      <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-tertiary)" }}>
                        {[reference, movement.notes].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                </ListRow>
              );
            })}
          </ListCard>
          <p className="px-4 pt-3 text-11" style={{ color: "var(--text-tertiary)" }}>
            {t("moves.scopeNote", { branch: branch ?? t("hub.inventory.selectedBranch") })}
          </p>
        </div>
      )}
    </div>
  );
}
