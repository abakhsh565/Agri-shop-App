import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { ShoppingCart, Share2, Download, Receipt, CheckCircle } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import type { Sale } from "@/types";
import { useShellBase } from "@/lib/useShellBase";
import svgPaths from "@/imports/SaleSuccess-2/svg-l3ilx2qnpm";

function StatusBar() {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  return (
    <div className="flex h-[44px] items-center justify-between px-[24px] shrink-0 w-full">
      <p className="font-bold leading-normal text-[14px] text-[var(--text-primary)] whitespace-nowrap">{time}</p>
      <div className="flex gap-[6px] items-center">
        <svg fill="none" height="20" viewBox="0 0 20 20" width="20">
          <path clipRule="evenodd" d={svgPaths.p2bb6eb80} fill="currentColor" fillRule="evenodd" />
        </svg>
        <svg fill="none" height="20" viewBox="0 0 20 20" width="20">
          <path clipRule="evenodd" d={svgPaths.p646c5c0} fill="currentColor" fillRule="evenodd" />
        </svg>
        <svg fill="none" height="20" viewBox="0 0 28 20" width="28">
          <path d={svgPaths.p66c9640} fill="currentColor" />
        </svg>
      </div>
    </div>
  );
}

export default function SaleSuccessPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const { state } = useLocation();
  const sale: Sale | undefined = state?.sale;

  if (!sale) return <Navigate to={`${base}/dashboard`} replace />;

  function handleShare() {
    const text = `AgriShop Receipt\nCustomer: ${sale!.customerName}\nTotal: ${formatCurrency(sale!.totalAmount)}\nPaid: ${formatCurrency(sale!.amountPaid)}\nDate: ${formatDateTime(sale!.createdAt)}`;
    if (navigator.share) {
      navigator.share({ title: "Sale Receipt", text }).catch(() => {});
    } else {
      navigator.clipboard.writeText(text).then(() => alert("Receipt copied to clipboard!")).catch(() => {});
    }
  }

  function handleDownload() {
    const rows = [
      ["Customer", sale!.customerName],
      ["Sale #", sale!.saleNumber],
      ["Total", formatCurrency(sale!.totalAmount)],
      ["Paid", formatCurrency(sale!.amountPaid)],
      ["Outstanding", formatCurrency(sale!.outstandingBalance)],
      ["Method", sale!.paymentMethod === "cash" ? "Cash" : "Bank Transfer"],
      ["Date", formatDateTime(sale!.createdAt)],
      ["Sold by", sale!.employeeName],
    ];
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt-${sale!.saleNumber}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const ROWS = [
    { label: "Customer", value: sale.customerName, bold: true },
    { divider: true },
    { label: "Total Amount", value: formatCurrency(sale.totalAmount), bold: true },
    { label: "Paid", value: formatCurrency(sale.amountPaid), bold: true },
    ...(sale.outstandingBalance > 0
      ? [{ label: "Outstanding", value: formatCurrency(sale.outstandingBalance), bold: true, highlight: true }]
      : []),
    { divider: true },
    { label: "Payment Method", value: sale.paymentMethod === "cash" ? "Cash" : "Bank Transfer", bold: true },
    { label: "Date & Time", value: formatDateTime(sale.createdAt), bold: false },
    { label: "Sold by", value: sale.employeeName, bold: true },
  ];

  return (
    <div
      className="flex flex-col items-start justify-between w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
    >
      {/* Body */}
      <div className="flex flex-col items-start shrink-0 w-full">
        <StatusBar />

        <div className="flex flex-col gap-[32px] items-center pb-[24px] pt-[40px] px-[24px] w-full">
          {/* Success icon — lime green with pop-in */}
          <div
            className="animate-pop-in"
            style={{
              width: 80,
              height: 80,
              borderRadius: 40,
              background: "var(--brand)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 0 12px rgba(132, 204, 22, 0.15)",
            }}
          >
            <svg fill="none" height="32" viewBox="0 0 32 32" width="32">
              <path
                d={svgPaths.p24ddc900}
                stroke="white"
                strokeLinecap="round"
                strokeWidth="3"
                strokeDasharray="40"
                strokeDashoffset="0"
                style={{ animation: "checkDraw 0.4s 0.3s ease both" }}
              />
            </svg>
          </div>

          {/* Headers */}
          <div className="flex flex-col gap-[8px] items-center text-center w-full animate-fade-in-up delay-150">
            <p className="font-bold text-[28px]" style={{ color: "var(--text-primary)" }}>
              Sale Completed!
            </p>
            <p className="font-normal text-[14px]" style={{ color: "var(--text-secondary)" }}>
              Receipt generated successfully
            </p>
          </div>

          {/* Receipt summary card */}
          <div
            className="flex flex-col gap-[16px] items-start p-[20px] rounded-[16px] w-full animate-fade-in-up delay-225"
            style={{ border: "1px solid var(--border-light)" }}
          >
            {ROWS.map((row, i) =>
              "divider" in row ? (
                <div key={i} className="w-full h-px" style={{ background: "var(--divider)" }} />
              ) : (
                <div key={i} className="flex items-start justify-between w-full text-[14px]">
                  <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
                  <span
                    className={row.bold ? "font-bold" : "font-medium"}
                    style={{
                      color: "highlight" in row && row.highlight ? "var(--warning)" : "var(--text-primary)",
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
      <div className="flex flex-col gap-[12px] items-center px-[24px] pb-[32px] pt-[8px] w-full animate-fade-in-up delay-300">
        {/* New Sale — lime green (positive contextual CTA) */}
        <button
          onClick={() => navigate(`${base}/sale`, { replace: true })}
          className="flex h-[48px] items-center justify-center gap-2 rounded-[24px] w-full font-bold text-[14px] transition-transform active:scale-[0.97]"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          <ShoppingCart size={16} strokeWidth={2.5} />
          New Sale
        </button>

        {/* Share */}
        <button
          onClick={handleShare}
          className="flex h-[48px] items-center justify-center gap-2 rounded-[24px] w-full font-bold text-[14px] transition-transform active:scale-[0.97]"
          style={{ border: "1px solid var(--border-light)", color: "var(--text-primary)" }}
        >
          <Share2 size={16} strokeWidth={2} />
          Share via WhatsApp / SMS
        </button>

        {/* Download */}
        <button
          onClick={handleDownload}
          className="flex h-[48px] items-center justify-center gap-2 rounded-[24px] w-full font-bold text-[14px] transition-transform active:scale-[0.97]"
          style={{ border: "1px solid var(--border-light)", color: "var(--text-primary)" }}
        >
          <Download size={16} strokeWidth={2} />
          Download Receipt
        </button>

        {/* View Receipt */}
        <button
          onClick={() => navigate(`${base}/sales/${sale.id}`)}
          className="flex h-[48px] items-center justify-center gap-2 rounded-[24px] w-full font-bold text-[14px] transition-transform active:scale-[0.97]"
          style={{ border: "1px solid var(--border-light)", color: "var(--text-primary)" }}
        >
          <Receipt size={16} strokeWidth={2} />
          View Receipt
        </button>
      </div>
    </div>
  );
}
