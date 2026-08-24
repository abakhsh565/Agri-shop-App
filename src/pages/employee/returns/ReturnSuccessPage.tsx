import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { Home, RotateCcw, Receipt } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/formatters";

interface ReturnResult {
  refundAmount: number;
  resolution: "refund_cash" | "credit_note";
  customerName: string;
  saleId: string;
  saleNumber: string;
  itemsReturned: number;
  processedAt: string;
  processedBy: string;
}

export default function ReturnSuccessPage() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const result: ReturnResult | undefined = state?.result;

  if (!result) return <Navigate to="/employee/sales" replace />;

  const isCash = result.resolution === "refund_cash";

  const ROWS = [
    { label: "Customer", value: result.customerName },
    { label: "Sale #", value: result.saleNumber },
    { divider: true },
    { label: "Items Returned", value: `${result.itemsReturned} item${result.itemsReturned !== 1 ? "s" : ""}` },
    { label: "Refund Amount", value: formatCurrency(result.refundAmount), highlight: true },
    { label: "Resolution", value: isCash ? "Cash Refund" : "Credit Note Applied" },
    { divider: true },
    { label: "Processed by", value: result.processedBy },
    { label: "Date & Time", value: formatDateTime(result.processedAt) },
  ];

  return (
    <div
      className="flex flex-col items-start justify-between w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
    >
      {/* Body */}
      <div className="flex flex-col items-start w-full">
        {/* Minimal status bar */}
        <div className="h-[44px] w-full" />

        <div className="flex flex-col gap-[32px] items-center pb-[24px] pt-[32px] px-[24px] w-full">
          {/* Return icon — amber for return context */}
          <div
            className="animate-pop-in"
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              background: "#f59e0b",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 0 12px rgba(245, 158, 11, 0.15)",
            }}
          >
            <RotateCcw size={32} color="white" strokeWidth={2.5} />
          </div>

          {/* Headers */}
          <div className="flex flex-col gap-[8px] items-center text-center w-full animate-fade-in-up delay-150">
            <p className="font-bold text-[28px]" style={{ color: "var(--text-primary)" }}>
              Return Processed!
            </p>
            <p className="font-normal text-[14px]" style={{ color: "var(--text-secondary)" }}>
              {isCash
                ? `${formatCurrency(result.refundAmount)} refunded in cash`
                : `${formatCurrency(result.refundAmount)} credited to account`}
            </p>
          </div>

          {/* Resolution pill */}
          <div
            className="flex items-center gap-2 px-4 py-2 rounded-full animate-scale-in delay-225"
            style={{
              background: isCash ? "rgba(132,204,22,0.12)" : "rgba(59,130,246,0.12)",
              border: `1px solid ${isCash ? "rgba(132,204,22,0.4)" : "rgba(59,130,246,0.4)"}`,
            }}
          >
            <span
              className="font-semibold text-[13px]"
              style={{ color: isCash ? "var(--brand-dark)" : "#2563eb" }}
            >
              {isCash ? "✓ Cash Refund Issued" : "✓ Credit Note Applied to Account"}
            </span>
          </div>

          {/* Summary card */}
          <div
            className="flex flex-col gap-[16px] items-start p-[20px] rounded-[16px] w-full animate-fade-in-up delay-300"
            style={{ border: "1px solid var(--border-light)" }}
          >
            {ROWS.map((row, i) =>
              "divider" in row ? (
                <div key={i} className="w-full h-px" style={{ background: "var(--divider)" }} />
              ) : (
                <div key={i} className="flex items-start justify-between w-full text-[14px]">
                  <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
                  <span
                    className="font-bold"
                    style={{
                      color: "highlight" in row && row.highlight
                        ? isCash ? "var(--brand-dark)" : "#2563eb"
                        : "var(--text-primary)",
                      textAlign: "right",
                    }}
                  >
                    {row.value}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-[12px] items-center px-[24px] pb-[32px] pt-[8px] w-full animate-fade-in-up delay-375">
        <button
          onClick={() => navigate("/employee/dashboard", { replace: true })}
          className="flex h-[48px] items-center justify-center gap-2 rounded-[24px] w-full font-bold text-[14px] transition-transform active:scale-[0.97]"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          <Home size={16} strokeWidth={2.5} />
          Back to Dashboard
        </button>

        <button
          onClick={() => navigate(`/employee/sales/${result.saleId}`)}
          className="flex h-[48px] items-center justify-center gap-2 rounded-[24px] w-full font-bold text-[14px] transition-transform active:scale-[0.97]"
          style={{ border: "1px solid var(--border-light)", color: "var(--text-primary)" }}
        >
          <Receipt size={16} strokeWidth={2} />
          View Original Sale
        </button>
      </div>
    </div>
  );
}
