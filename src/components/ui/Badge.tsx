import type { PaymentType, StockStatus } from "@/types";
import { getStockStatusLabel, getStockStatusColor } from "@/lib/formatters";
import { formatCurrency } from "@/lib/formatters";

interface PaymentBadgeProps {
  type: PaymentType;
  outstandingBalance?: number;
}

export function PaymentBadge({ type, outstandingBalance }: PaymentBadgeProps) {
  if (type === "full") {
    return (
      <span
        className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase whitespace-nowrap"
        style={{
          background: "rgba(132,204,22,0.15)",
          color: "#65a30d",
          border: "1px solid rgba(132,204,22,0.35)",
        }}
      >
        PAID
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-bold uppercase whitespace-nowrap"
      style={{
        background: "rgba(245,158,11,0.12)",
        color: "#d97706",
        border: "1px solid rgba(245,158,11,0.35)",
      }}
    >
      {outstandingBalance ? `CREDIT · ${formatCurrency(outstandingBalance)}` : "CREDIT"}
    </span>
  );
}

interface StockBadgeProps {
  status: StockStatus;
  outline?: boolean;
}

export function StockBadge({ status, outline }: StockBadgeProps) {
  const color = getStockStatusColor(status);
  const label = getStockStatusLabel(status);

  if (outline) {
    return (
      <span
        className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap border"
        style={{ color, borderColor: color + "66", background: color + "18" }}
      >
        {label}
      </span>
    );
  }
  return (
    <span className="text-xs font-medium whitespace-nowrap" style={{ color }}>
      {label}
    </span>
  );
}

export function CategoryChip({ label }: { label: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase whitespace-nowrap"
      style={{ background: "var(--text-primary)", color: "var(--background)" }}
    >
      {label}
    </span>
  );
}

export function CreditHealthBadge({ health }: { health: "good" | "warning" | "over_limit" }) {
  const cfg = {
    good:       { label: "Good",       bg: "rgba(132,204,22,0.12)", color: "#65a30d", bd: "rgba(132,204,22,0.35)" },
    warning:    { label: "Warning",    bg: "rgba(245,158,11,0.12)", color: "#d97706", bd: "rgba(245,158,11,0.35)" },
    over_limit: { label: "Over Limit", bg: "rgba(239,68,68,0.12)",  color: "#dc2626", bd: "rgba(239,68,68,0.35)" },
  }[health];
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
      style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.bd}` }}
    >
      {cfg.label}
    </span>
  );
}
