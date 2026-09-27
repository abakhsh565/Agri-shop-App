import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";

/**
 * The receipt card — one implementation, two screens.
 *
 * The sale success screen and a past sale's detail screen are looking at the same document
 * from two directions, so they render the same thing: a band naming what it is and when, the
 * few facts a receipt carries, a perforation, and the amount last — the number a shopkeeper
 * says out loud is the bottom line of the card. When the two screens each drew this by hand
 * they drifted, which is how the detail screen ended up printing a red/green cost breakdown
 * per line and no total worth reading.
 *
 * Deliberately *not* in here: profit, cost, margin, notes, returns. A receipt is the
 * customer's copy, and those are the shop's own numbers — they belong beside it, not on it.
 */
export interface SaleReceiptFacts {
  saleNumber: string;
  createdAt: string;
  customerName: string;
  customerPhone?: string;
  /** Already resolved to words, so an employee sees "You" where the shopkeeper sees a name. */
  soldBy: string;
  paymentMethod?: string;
  itemCount: number;
  totalAmount: number;
  amountPaid: number;
  outstandingBalance: number;
  /** Set for a sale that no longer stands, and the reason it does not. */
  voided?: { reason?: string } | null;
}

function formatDateLong(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
}

function formatTime12(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export default function SaleReceipt({ facts }: { facts: SaleReceiptFacts }) {
  const t = useT();
  const owes = facts.outstandingBalance > 0;

  const rows: Array<{ label: string; value: string; bold?: boolean }> = [
    { label: t("saleSuccess.customer"), value: facts.customerName, bold: true },
    ...(facts.customerPhone ? [{ label: t("saleSuccess.phone"), value: facts.customerPhone }] : []),
    {
      label: t("saleSuccess.payment"),
      value: facts.paymentMethod === "bank_transfer" ? t("sale.bankTransfer") : t("sale.cash"),
    },
    {
      label: t("saleSuccess.items"),
      // A receipt that says "1 items" reads as a machine's, not a shop's.
      value: facts.itemCount === 1 ? t("saleSuccess.oneItem") : `${facts.itemCount} ${t("common.items")}`,
    },
    { label: t("saleSuccess.soldBy"), value: facts.soldBy },
  ];

  return (
    <div
      className="w-full rounded-[var(--radius-card)] overflow-hidden animate-fade-in-up"
      style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
      data-testid="sale-receipt"
    >
      {/* Band: what this is, which sale, and when — the three things read first on paper. */}
      <div className="px-4 py-3" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-bold">{t("saleSuccess.saleReceipt")}</p>
          <p className="text-11 font-mono opacity-80">{facts.saleNumber}</p>
        </div>
        <p className="text-11 opacity-80 mt-0.5">
          {formatDateLong(facts.createdAt)} • {formatTime12(facts.createdAt)}
        </p>
      </div>

      {/* Fields: the label left, the fact right, a hairline between — drawn as a *top* border
          that the first row opts out of, so no row needs to know how many rows there are. */}
      <div className="px-4 py-1">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex items-center justify-between gap-4 py-2 text-xs border-t first:border-t-0"
            style={{ borderColor: "var(--divider)" }}
          >
            <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
            <span
              className={row.bold ? "font-bold text-end" : "font-medium text-end"}
              style={{ color: "var(--text-primary)" }}
            >
              {row.value}
            </span>
          </div>
        ))}
      </div>

      {/* Perforation: two notches and a dashed rule, the tear-line of a paper receipt. */}
      <div className="relative h-5 flex items-center">
        <div className="w-full border-t border-dashed mx-4" style={{ borderColor: "var(--divider)" }} />
        <div
          className="absolute w-5 h-5 rounded-full"
          style={{ insetInlineStart: -10, background: "var(--background)" }}
        />
        <div
          className="absolute w-5 h-5 rounded-full"
          style={{ insetInlineEnd: -10, background: "var(--background)" }}
        />
      </div>

      {/* The amount, on its own. */}
      <div className="px-4 pb-4 pt-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
            {t("saleSuccess.totalAmount")}
          </span>
          <span
            className="text-2xl font-bold tabular-nums"
            style={facts.voided ? { color: "var(--text-secondary)", textDecoration: "line-through" } : undefined}
          >
            {formatCurrency(facts.totalAmount)}
          </span>
        </div>
        {owes && (
          <div className="flex items-center justify-between gap-3 mt-1.5 text-11">
            <span style={{ color: "var(--text-secondary)" }}>
              {t("saleSuccess.paid")} {formatCurrency(facts.amountPaid)}
            </span>
            <span className="font-semibold" style={{ color: "var(--warning)" }}>
              {t("saleSuccess.outstanding")} {formatCurrency(facts.outstandingBalance)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
