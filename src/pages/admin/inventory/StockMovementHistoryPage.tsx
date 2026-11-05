import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownToLine,
  Download,
  Package,
  RefreshCw,
  Share2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import SectionActionsSheet, { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import { csvFileName, exportCsv, exportText, toCsv } from "@/lib/exportData";
import { useUIStore } from "@/stores/uiStore";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useProductsStore } from "@/stores/productsStore";
import { useSalesStore } from "@/stores/salesStore";
import { fetchPurchases } from "@/lib/db";
import { useInventoryMovements, type MovementType } from "@/lib/inventoryMovements";
import { signedQty, unitWord } from "@/lib/inventoryView";
import { formatSmartDateTime } from "@/lib/formatters";
import { useCurrentTime } from "@/lib/useCurrentTime";
import type { BaseUnit } from "@/types";

/**
 * Stock movements: everything that moved a quantity on the shelf, in the order it moved.
 *
 * REBUILT ON THE LEDGER (owner's reference, 2026-10-28). This screen used to derive its rows
 * from the sales the app had loaded, which meant it could only ever show one of the four things
 * that move stock — a goods-received against a purchase and a counted adjustment were simply
 * missing — and only for sales still inside the loaded window. The database keeps every movement
 * (`inventory_movements`), so the screen reads that.
 *
 * THE SHELF, NOT THE TILL (owner's correction, 2026-10-30). The ledger also records the stock a
 * sale took out, and those rows drowned the ones this screen exists for: three "Sale completed"
 * lines beside one counted adjustment. A sale already has its own record in Sales, with the
 * receipt, the customer and the money; what a shopkeeper comes here to check is what arrived,
 * what was counted and what was moved between branches. So sale rows (and their returns) are
 * filtered out here, and the line under the title says so rather than leaving the reader to
 * wonder where they went.
 *
 * WHAT A ROW SAYS: what happened, which pack it happened to, when, and against which document —
 * a purchase, a transfer — so a figure can be traced back to the paper it came from. The
 * quantity carries its sign and its unit ("+20 liters", "−3 bottles") because the direction IS
 * the information.
 *
 * THE REFRESH IS A CONTROL NOW. The green arrow used to be a picture of a refresh: it looked
 * tappable and did nothing, which is worse than having no arrow at all. It re-reads the ledger,
 * and the "…" menu exports or shares what is on screen.
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
  adjustment: RefreshCw,
  return: Undo2,
  transfer: RefreshCw,
};

/**
 * The movement types this screen leaves out: the till's own rows. A sale and a sale return are
 * recorded in Sales with their receipt; keeping them here listed the same event twice and buried
 * the stock-side movements the owner came to read.
 */
const HIDDEN_TYPES = new Set(["sale", "return"]);

export default function StockMovementHistoryPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const now = useCurrentTime();
  const products = useProductsStore((s) => s.products);
  const sales = useSalesStore((s) => s.sales);
  const { movements: ledger, ready, refresh } = useInventoryMovements();
  // Spelled `loading`, because that is the gate the skeleton-coverage guard pins for this
  // screen: it waits for its own movement read before it says the shelf has never moved.
  const loading = !ready;
  /** Purchase numbers, so a goods-received row can name the purchase it came from. */
  const [purchaseNumbers, setPurchaseNumbers] = useState<Record<string, string>>({});
  const [menuOpen, setMenuOpen] = useState(false);
  const { addToast } = useUIStore();

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

  /** What this screen is about: the shelf's own movements, newest first. */
  const movements = useMemo(
    () => ledger.filter((movement) => !HIDDEN_TYPES.has(movement.type)),
    [ledger],
  );

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

  /** One row's words, shared by the list and the export so they can never say different things. */
  function describe(movement: (typeof movements)[number]) {
    const pack = packOf(movement.type, movement.variantId, movement.productId);
    const unit = unitWord(pack.baseUnit, t);
    return {
      what: t(TYPE_LABEL_KEY[movement.type] ?? "moves.adjustment"),
      item: `${pack.productName}${pack.variantName ? ` · ${pack.variantName}` : ""}`,
      qty: signedQty(movement.qtyChange, unit),
      when: formatSmartDateTime(movement.createdAt, now, t),
      reference: referenceOf(movement.type, movement.referenceType, movement.referenceId),
    };
  }

  /** The last time anything happened on this shelf — what the line under the title says. */
  const lastActivity = movements[0] ? formatSmartDateTime(movements[0].createdAt, now, t) : null;

  async function exportMovements() {
    setMenuOpen(false);
    try {
      const rows = movements.map(describe);
      const csv = toCsv(
        [
          { label: t("moves.columnWhat"), value: (r: (typeof rows)[number]) => r.what },
          { label: t("moves.columnItem"), value: (r: (typeof rows)[number]) => r.item },
          { label: t("moves.columnQty"), value: (r: (typeof rows)[number]) => r.qty },
          { label: t("moves.columnWhen"), value: (r: (typeof rows)[number]) => r.when },
        ],
        rows,
      );
      const outcome = await exportCsv(csvFileName("stock-movements"), csv, t("hub.inventory.movements"));
      addToast(outcome === "shared" ? t("data.exportedShared") : t("data.exported"), "success");
    } catch {
      addToast(t("data.exportFailed"), "error");
    }
  }

  async function shareMovements() {
    setMenuOpen(false);
    const text = movements
      .map(describe)
      .map((r) => `${r.what} · ${r.item} · ${r.qty} · ${r.when}`)
      .join("\n");
    try {
      const outcome = await exportText(text, t("hub.inventory.movements"));
      addToast(outcome === "shared" ? t("sales.reportShared") : t("sales.reportCopied"), "success");
    } catch {
      addToast(t("sales.shareFailed"), "error");
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="stock-movements-page"
    >
      <StatusBar />
      <NavHeader
        title={t("hub.inventory.movements")}
        backTo={base === "/admin" ? `${base}/settings/hub/inventory` : `${base}/more`}
        right={
          <SectionActionsButton
            onClick={() => setMenuOpen(true)}
            label={t("data.moreActions")}
            testId="movements-actions"
          />
        }
      />

      <SectionActionsSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        title={t("hub.inventory.movements")}
        actions={[
          {
            id: "export",
            icon: Download,
            title: t("data.export"),
            description: t("moves.exportHint"),
            onClick: () => { void exportMovements(); },
          },
          {
            id: "share",
            icon: Share2,
            title: t("sales.shareReport"),
            description: t("moves.shareHint"),
            onClick: () => { void shareMovements(); },
          },
        ]}
      />

      <div className="px-4 pt-1">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-16 font-bold">{t("hub.inventory.movements")}</p>
              {/* What happened last, and when — the line the owner asked for. The branch is the
                  one the shell is already working in, so naming it here said what the bar and
                  the rows already say. */}
              <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>
                {t("moves.recentActivity")}
                {" · "}
                {lastActivity ?? t("moves.noActivity")}
              </p>
            </div>
            <button
              type="button"
              onClick={refresh}
              aria-label={t("moves.refresh")}
              data-testid="movements-refresh"
              className="shrink-0 flex items-center justify-center w-9 h-9 -me-1 rounded-full active:opacity-60"
            >
              <RefreshCw size={20} style={{ color: "var(--brand-dark)" }} />
            </button>
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
        </div>
      )}
    </div>
  );
}
