import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import type { LedgerPayment } from "@/lib/paymentLedger";

/**
 * One recorded payment, as both Finance screens draw it.
 *
 * The hub's "Recent financial activity" and the cash screen's "Recent movements" are the same
 * list of the same rows, so the row is written once here: in on the left with a green `+`, out
 * on the right with a red `−`, the counterparty and the moment under it. Colour is the only
 * thing that says direction, so the sign is printed too — a reader who cannot tell lime from
 * red still reads "+" and "−".
 */
export default function FinanceMovementRow({
  entry,
  testId,
}: {
  entry: LedgerPayment;
  testId?: string;
}) {
  const t = useT();
  const incoming = entry.direction === "in";

  return (
    <div className="flex items-start gap-3 py-3" data-testid={testId}>
      <span
        className="size-9 rounded-full flex items-center justify-center shrink-0"
        style={{ background: "var(--surface-2)" }}
      >
        {incoming
          ? <ArrowDownLeft size={15} style={{ color: "var(--success)" }} />
          : <ArrowUpRight size={15} style={{ color: "var(--error)" }} />}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-13 font-semibold truncate">
          {incoming ? t("payments.customerPayment") : t("payments.supplierPayment")}
        </p>
        <p className="text-11 truncate" style={{ color: "var(--text-secondary)" }}>
          {entry.counterparty || "—"}
        </p>
        <p className="text-10 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
          {formatSmartDateTime(entry.createdAt, undefined, t)}
        </p>
      </div>
      <p
        className="text-13 font-bold tabular-nums shrink-0"
        style={{ color: incoming ? "var(--success)" : "var(--error)" }}
      >
        {incoming ? "+" : "−"} {formatCurrency(entry.amount)}
      </p>
    </div>
  );
}
