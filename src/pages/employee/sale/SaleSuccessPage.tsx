import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { ShoppingCart, Share2, Download, Home } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import type { Sale } from "@/types";
import { useShellBase } from "@/lib/useShellBase";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import { renderReceiptBlob } from "@/lib/receiptRenderer";
import { clearNav } from "@/lib/navContext";

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
}

function formatTime12(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export default function SaleSuccessPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const { state } = useLocation();
  const sale: Sale | undefined = state?.sale;
  const t = useT();
  const { addToast } = useUIStore();
  const { user } = useAuthStore();

  if (!sale) return <Navigate to={`${base}/dashboard`} replace />;

  const s = {
    ...sale,
    totalAmount: sale.totalAmount ?? 0,
    amountPaid: sale.amountPaid ?? 0,
    outstandingBalance: sale.outstandingBalance ?? 0,
    subtotal: sale.subtotal ?? sale.totalAmount ?? 0,
    items: sale.items ?? [],
    saleNumber: sale.saleNumber ?? "SALE-00000",
    customerName: sale.customerName ?? "Customer",
    customerPhone: sale.customerPhone ?? "",
    employeeName: sale.employeeName ?? "Staff",
    paymentMethod: sale.paymentMethod ?? "cash",
    paymentType: sale.paymentType ?? "full",
    createdAt: sale.createdAt ?? new Date().toISOString(),
    id: sale.id ?? "",
  };

  async function handleShare() {
    const blob = await renderReceiptBlob(s);
    if (!blob) { addToast("Failed to generate receipt image", "error"); return; }
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
      reader.readAsDataURL(blob);
    });
    const fileName = `receipt-${s.saleNumber}.png`;
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      await Filesystem.writeFile({ path: fileName, data: base64, directory: Directory.Cache, recursive: true });
      const fileUri = await Filesystem.getUri({ path: fileName, directory: Directory.Cache });
      const { Share } = await import("@capacitor/share");
      await Share.share({ title: t("saleSuccess.saleReceipt"), dialogTitle: t("saleSuccess.shareReceipt"), url: fileUri.uri, files: [fileUri.uri] });
      return;
    } catch {}
    const file = new File([blob], fileName, { type: "image/png" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ title: t("saleSuccess.saleReceipt"), files: [file] }); return; } catch {}
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = fileName; a.click();
    URL.revokeObjectURL(url);
    addToast(t("saleSuccess.receiptSaved"), "success");
  }

  async function handleDownload() {
    const blob = await renderReceiptBlob(s);
    if (!blob) { addToast(t("saleSuccess.failedGenerate"), "error"); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `receipt-${s.saleNumber}.png`; a.click();
    URL.revokeObjectURL(url);
    addToast(t("saleSuccess.receiptDownloaded"), "success");
  }

  const ROWS = [
    { label: t("saleSuccess.customer"), value: s.customerName, bold: true },
    ...(s.customerPhone ? [{ label: t("saleSuccess.phone"), value: s.customerPhone, bold: false }] : []),
    { divider: true },
    { label: t("saleSuccess.totalAmount"), value: formatCurrency(s.totalAmount), bold: true },
    { label: t("saleSuccess.paid"), value: formatCurrency(s.amountPaid), bold: true },
    ...(s.outstandingBalance > 0
      ? [{ label: t("saleSuccess.outstanding"), value: formatCurrency(s.outstandingBalance), bold: true, highlight: true }]
      : []),
    { divider: true },
    { label: t("saleSuccess.payment"), value: s.paymentMethod === "cash" ? t("sale.cash") : t("sale.bankTransfer"), bold: true },
    { label: t("saleSuccess.items"), value: `${s.items.length} ${t("common.items")}`, bold: false },
    { label: t("saleSuccess.dateTime"), value: formatDateTime(s.createdAt), bold: false },
    { label: t("saleSuccess.soldBy"), value: s.employeeName === user?.name ? t("saleSuccess.you") : s.employeeName, bold: true },
  ];

  return (
    <div
      className="flex flex-col w-full h-full overflow-hidden"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
    >
      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 sm:px-6 pt-3 sm:pt-4 pb-2">
          {/* Success icon */}
          <div className="flex justify-center mb-3 sm:mb-4 animate-pop-in">
            <div
              className="w-14 h-14 sm:w-16 sm:h-16 rounded-full flex items-center justify-center"
              style={{ background: "var(--brand)", boxShadow: "0 0 0 10px rgba(132,204,22,0.15)" }}
            >
              <span className="text-2xl sm:text-3xl">✓</span>
            </div>
          </div>

          {/* Title */}
          <div className="text-center mb-3 sm:mb-4 animate-fade-in-up">
            <p className="text-lg sm:text-xl font-bold" style={{ color: "var(--text-primary)" }}>{t("saleSuccess.saleComplete")}</p>
            <p className="text-xs sm:text-sm" style={{ color: "var(--text-secondary)" }}>
              {formatCurrency(s.totalAmount)} {s.paymentType === "full" ? t("saleSuccess.received") : t("saleSuccess.booked")}
            </p>
          </div>

          {/* Receipt card */}
          <div
            className="w-full rounded-xl sm:rounded-[20px] overflow-hidden animate-fade-in-up delay-225"
            style={{ border: "1px solid var(--border-light)", background: "var(--surface)" }}
          >
            {/* Gradient header */}
            <div className="px-3 sm:px-5 py-3 sm:py-4 text-white" style={{ background: "linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #f59e0b 100%)" }}>
              <div className="flex items-center justify-between">
                <p className="text-sm sm:text-lg font-bold">{t("saleSuccess.saleReceipt")}</p>
                <p className="text-[10px] sm:text-xs font-mono opacity-85">{s.saleNumber}</p>
              </div>
              <p className="text-[10px] sm:text-xs opacity-85 mt-0.5">{formatDateLong(s.createdAt)} • {formatTime12(s.createdAt)}</p>
            </div>

            {/* Rows */}
            <div className="px-3 sm:px-5 py-2.5 sm:py-3 flex flex-col gap-1.5 sm:gap-2.5">
              {ROWS.map((row, i) =>
                "divider" in row && row.divider ? (
                  <div key={i} className="w-full h-px" style={{ background: "var(--divider)" }} />
                ) : (
                  <div key={i} className="flex items-start justify-between w-full text-[11px] sm:text-[13px]">
                    <span style={{ color: "var(--text-secondary)" }}>{"label" in row ? row.label : ""}</span>
                    <span
                      className={"bold" in row && (row as any).bold ? "font-bold" : "font-medium"}
                      style={{ color: "highlight" in row && (row as any).highlight ? "var(--warning)" : "var(--text-primary)", textAlign: "right" }}
                    >
                      {"value" in row ? (row as any).value : ""}
                    </span>
                  </div>
                )
              )}
            </div>

            {/* Dashed divider */}
            <div className="flex justify-center px-3 sm:px-5 pb-2">
              <div className="w-full border-t border-dashed" style={{ borderColor: "var(--divider)" }} />
            </div>

            {/* Total */}
            <div className="px-3 sm:px-5 py-2.5 sm:py-3 flex items-center justify-between" style={{ borderTop: "1px solid var(--divider)" }}>
              <span className="text-xs sm:text-sm font-bold" style={{ color: "var(--text-secondary)" }}>{t("saleSuccess.total")}</span>
              <span className="text-base sm:text-xl font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(s.totalAmount)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Fixed actions at bottom */}
      <div className="shrink-0 px-3 sm:px-6 pb-4 sm:pb-6 pt-2 flex flex-col gap-1.5 sm:gap-2 animate-fade-in-up delay-300">
        <button
          onClick={handleShare}
          className="flex h-10 sm:h-11 items-center justify-center gap-2 rounded-full w-full font-bold text-xs sm:text-sm transition-transform active:scale-[0.97]"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          <Share2 size={14} strokeWidth={2.5} /> {t("saleSuccess.shareReceipt")}
        </button>
        <button
          onClick={handleDownload}
          className="flex h-10 sm:h-11 items-center justify-center gap-2 rounded-full w-full font-bold text-xs sm:text-sm transition-transform active:scale-[0.97]"
          style={{ border: "1px solid var(--border-light)", color: "var(--text-primary)" }}
        >
          <Download size={14} strokeWidth={2} /> {t("saleSuccess.downloadReceipt")}
        </button>
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => { clearNav(); navigate(`${base}/sale`, { replace: true }); }}
            className="flex-1 flex h-9 sm:h-10 items-center justify-center gap-1.5 rounded-full font-bold text-[11px] sm:text-xs transition-transform active:scale-[0.97]"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            <ShoppingCart size={13} strokeWidth={2.5} /> {t("saleSuccess.newSale")}
          </button>
          <button
            onClick={() => { clearNav(); navigate(`${base}/dashboard`, { replace: true }); }}
            className="flex-1 flex h-9 sm:h-10 items-center justify-center gap-1.5 rounded-full font-bold text-[11px] sm:text-xs transition-transform active:scale-[0.97]"
            style={{ border: "1px solid var(--border-light)", color: "var(--text-secondary)" }}
          >
            <Home size={13} strokeWidth={2} /> {t("saleSuccess.home")}
          </button>
        </div>
      </div>
    </div>
  );
}
