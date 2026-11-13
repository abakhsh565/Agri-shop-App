import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { Home, RotateCcw, Receipt } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";

interface ReturnResult {
  refundAmount: number;
  resolution: "refund_cash" | "credit_note";
  reason?: string;
  customerName: string;
  saleId: string;
  saleNumber: string;
  itemsReturned: number;
  processedAt: string;
  processedBy: string;
}

export default function AdminReturnSuccessPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();
  const { state } = useLocation();
  const result: ReturnResult | undefined = state?.result;

  if (!result) return <Navigate to={`${base}/sales`} replace />;

  const isCash = result.resolution === "refund_cash";

  const ROWS = [
    { label: t("saleSuccess.customer"), value: result.customerName },
    { label: t("sales.saleNumber"), value: result.saleNumber },
    ...(result.reason ? [{ label: t("saleDetail.reason"), value: result.reason }] : []),
    { divider: true as const },
    { label: t("return.itemsReturned"), value: `${result.itemsReturned} ${t("common.items")}` },
    { label: t("return.refundAmount"), value: formatCurrency(result.refundAmount), highlight: true },
    { label: t("return.resolution"), value: isCash ? t("return.cashRefundApplied") : t("return.creditNoteApplied") },
    { divider: true as const },
    { label: t("return.processedBy"), value: result.processedBy },
    { label: t("saleSuccess.dateTime"), value: formatDateTime(result.processedAt) },
  ];

  return (
    <div className="flex flex-col items-start justify-between w-full min-h-full" style={{ background: "var(--background)", color: "var(--text-primary)" }}>
      <div className="flex flex-col items-start w-full">
        <div className="h-[44px] w-full" />
        <div className="flex flex-col gap-[32px] items-center pb-[24px] pt-[32px] px-[24px] w-full">
          <div className="animate-pop-in" style={{ width: 80, height: 80, borderRadius: 40, background: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 0 0 12px rgba(245, 158, 11, 0.15)" }}>
            <RotateCcw size={32} color="white" strokeWidth={2.5} />
          </div>
          <div className="flex flex-col gap-[8px] items-center text-center w-full animate-fade-in-up delay-150">
            <p className="font-bold text-28" style={{ color: "var(--text-primary)" }}>{t("returns.success")}</p>
            <p className="font-normal text-14" style={{ color: "var(--text-secondary)" }}>
              {isCash ? `${formatCurrency(result.refundAmount)} ${t("return.refundedCash")}` : `${formatCurrency(result.refundAmount)} ${t("return.creditedToAccount")}`}
            </p>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 rounded-full animate-scale-in delay-225"
            style={{ background: isCash ? "rgba(132,204,22,0.12)" : "rgba(59,130,246,0.12)", border: `1px solid ${isCash ? "rgba(132,204,22,0.4)" : "rgba(59,130,246,0.4)"}` }}>
            <span className="font-semibold text-13" style={{ color: isCash ? "var(--brand-dark)" : "#2563eb" }}>
              {isCash ? t("return.cashRefundIssued") : t("return.creditNoteIssued")}
            </span>
          </div>
          <div className="flex flex-col gap-[16px] items-start p-[20px] rounded-[var(--radius-card)] w-full animate-fade-in-up delay-300" style={{ border: "1px solid var(--border-light)" }}>
            {ROWS.map((row, i) =>
              "divider" in row ? (
                <div key={i} className="w-full h-px" style={{ background: "var(--divider)" }} />
              ) : (
                <div key={i} className="flex items-start justify-between w-full text-14">
                  <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
                  <span className="font-bold" style={{ color: "highlight" in row && row.highlight ? (isCash ? "var(--brand-dark)" : "#2563eb") : "var(--text-primary)", textAlign: "right" }}>
                    {row.value}
                  </span>
                </div>
              )
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-[12px] items-center px-[24px] pb-[32px] pt-[8px] w-full animate-fade-in-up delay-375">
        <button onClick={() => navigate(`${base}/dashboard`, { replace: true })}
          className="flex h-[48px] items-center justify-center gap-2 rounded-[var(--radius-input)] w-full font-bold text-14 transition-transform active:scale-[0.97]"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}>
          <Home size={16} strokeWidth={2.5} /> {t("returns.backDashboard")}
        </button>
        <button onClick={() => navigate(`${base}/sales/${result.saleId}`)}
          className="flex h-[48px] items-center justify-center gap-2 rounded-[var(--radius-input)] w-full font-bold text-14 transition-transform active:scale-[0.97]"
          style={{ border: "1px solid var(--border-light)", color: "var(--text-primary)" }}>
          <Receipt size={16} strokeWidth={2} /> {t("returns.viewSale")}
        </button>
      </div>
    </div>
  );
}
