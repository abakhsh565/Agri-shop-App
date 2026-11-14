import { useNavigate } from "react-router-dom";
import { Ban, ChevronRight, Undo2 } from "lucide-react";
import Sheet from "@/components/ui/Sheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useCurrentTime } from "@/lib/useCurrentTime";
import { useReturns, useVoidedSales } from "@/lib/salesActivity";
import { useSalesStore } from "@/stores/salesStore";

export type SalesActivityKind = "returns" | "voided";

/**
 * Returns and voided sales, as a popup rather than two more screens (owner's instruction,
 * 2026-10-28).
 *
 * Both are the same job — look something up in a ledger that already exists and get back to
 * selling — so neither earns a screen of its own, and neither is a dead end: every row opens the
 * sale it is about, which is where a return or a void is actually read, corrected or printed.
 *
 * A sheet that is closed is not mounted, so a shop that never opens one never pays for the read.
 */
export default function SalesActivitySheet({
  kind,
  open,
  onClose,
}: {
  kind: SalesActivityKind;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const now = useCurrentTime();
  const sales = useSalesStore((s) => s.sales);
  const { returns, ready: returnsReady } = useReturns();
  const { voided, ready: voidedReady } = useVoidedSales();

  function openSale(saleId: string) {
    onClose();
    if (saleId) navigate(`${base}/sales/${saleId}`);
  }

  const refundedTotal = returns.reduce((sum, r) => sum + r.totalRefund, 0);
  const voidedTotal = voided.reduce((sum, v) => sum + v.totalAmount, 0);
  const ready = kind === "returns" ? returnsReady : voidedReady;
  const count = kind === "returns" ? returns.length : voided.length;
  const value = kind === "returns" ? refundedTotal : voidedTotal;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t(kind === "returns" ? "hub.sales.returns" : "hub.sales.voided")}
      actionIcon={kind === "returns" ? Undo2 : Ban}
      actionLabel={t(kind === "returns" ? "sales.returnsValue" : "sales.voidedValue")}
    >
      <div className="px-4 pt-1 flex gap-2">
        <div
          className="flex-1 rounded-[var(--radius-tile)] p-3 flex flex-col gap-1"
          style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
        >
          <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
            {t(kind === "returns" ? "sales.returnsCount" : "sales.voidedCount")}
          </p>
          <p className="text-16 font-bold" style={{ color: "var(--text-primary)" }} data-testid="sales-activity-count">
            {ready ? count : "—"}
          </p>
        </div>
        <div
          className="flex-1 rounded-[var(--radius-tile)] p-3 flex flex-col gap-1"
          style={{ background: "var(--surface)", border: "1px solid var(--border-light)" }}
        >
          <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>
            {t(kind === "returns" ? "sales.returnsValue" : "sales.voidedValue")}
          </p>
          <p
            className="text-16 font-bold"
            style={{ color: kind === "returns" ? "#ef4444" : "var(--text-primary)" }}
            data-testid="sales-activity-value"
          >
            {ready ? formatCurrency(value) : "—"}
          </p>
        </div>
      </div>

      {!ready ? (
        <SkeletonList rows={3} tile />
      ) : count === 0 ? (
        <div className="px-4 py-10 flex flex-col items-center gap-2">
          {kind === "returns" ? (
            <Undo2 size={26} style={{ color: "var(--text-tertiary)" }} />
          ) : (
            <Ban size={26} style={{ color: "var(--text-tertiary)" }} />
          )}
          <p className="text-13 font-semibold text-center" style={{ color: "var(--text-primary)" }}>
            {t(kind === "returns" ? "sales.noReturns" : "sales.noVoided")}
          </p>
        </div>
      ) : (
        <ListCard className="mx-4 mt-4">
          {kind === "returns"
            ? returns.map((r) => {
                // The sale the goods came back from, so a row reads in the same words the sales
                // list uses. A return whose sale is not in this reader's window falls back to its
                // own number rather than showing a blank.
                const saleNumber = sales.find((s) => s.id === r.saleId)?.saleNumber;
                const resolution =
                  r.resolution === "refund_cash"
                    ? t("saleDetail.cashRefund")
                    : r.resolution === "credit_note"
                      ? t("saleDetail.creditNote")
                      : "";
                const meta = [r.customerName, resolution].filter(Boolean).join(" · ");
                return (
                  <ListRow
                    key={r.id}
                    icon={Undo2}
                    title={saleNumber ?? r.returnNumber}
                    meta={meta}
                    value={formatCurrency(r.totalRefund)}
                    trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
                    testId={`sales-activity-row-${r.id}`}
                    onClick={() => openSale(r.saleId)}
                  />
                );
              })
            : voided.map((v) => (
                <ListRow
                  key={v.id}
                  icon={Ban}
                  title={v.saleNumber}
                  meta={`${v.customerName} · ${formatSmartDateTime(v.voidedAt ?? v.createdAt, now, t)}`}
                  value={formatCurrency(v.totalAmount)}
                  trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
                  testId={`sales-activity-row-${v.id}`}
                  onClick={() => openSale(v.id)}
                />
              ))}
        </ListCard>
      )}
    </Sheet>
  );
}
