import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { ShoppingCart, Share2, Download } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import type { Sale } from "@/types";
import { useShellBase } from "@/lib/useShellBase";
import { useUIStore } from "@/stores/uiStore";

function StatusBar() {
  const now = new Date();
  const time = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  return (
    <div className="flex h-[44px] items-center justify-between px-[24px] shrink-0 w-full">
      <p className="font-bold leading-normal text-[14px] text-[var(--text-primary)] whitespace-nowrap">{time}</p>
    </div>
  );
}

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
}

function formatTime12(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: true });
}


import { renderReceiptBlob } from "@/lib/receiptRenderer";

// ─── Page ──────────────────────────────────────────────────────────────────

export default function SaleSuccessPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const { state } = useLocation();
  const sale: Sale | undefined = state?.sale;
  const { addToast } = useUIStore();

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

    // Convert blob to base64
    const base64 = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(",")[1]); // strip data:image/png;base64, prefix
      };
      reader.readAsDataURL(blob);
    });

    const fileName = `receipt-${s.saleNumber}.png`;

    // Try Capacitor native share — write blob to cache, share the file path
    try {
      const { Filesystem, Directory } = await import("@capacitor/filesystem");
      await Filesystem.writeFile({
        path: fileName,
        data: base64,
        directory: Directory.Cache,
        recursive: true,
      });
      const fileUri = await Filesystem.getUri({
        path: fileName,
        directory: Directory.Cache,
      });

      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: "AgriShop Receipt",
        dialogTitle: "Share Receipt",
        url: fileUri.uri,
        files: [fileUri.uri],
      });
      return;
    } catch {
      // Capacitor not available — fall through to web
    }

    // Try Web Share API with file (works on Android Chrome)
    const file = new File([blob], fileName, { type: "image/png" });
    if (navigator.share && navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ title: "AgriShop Receipt", files: [file] });
        return;
      } catch {
        // User cancelled
      }
    }

    // Fallback: download the image
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    addToast("Receipt image saved — share it manually", "success");
  }

  async function handleDownload() {
    const blob = await renderReceiptBlob(s);
    if (!blob) { addToast("Failed to generate receipt image", "error"); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `receipt-${s.saleNumber}.png`;
    a.click();
    URL.revokeObjectURL(url);
    addToast("Receipt downloaded", "success");
  }

  const ROWS = [
    { label: "Customer", value: s.customerName, bold: true },
    ...(s.customerPhone ? [{ label: "Phone", value: s.customerPhone, bold: false }] : []),
    { divider: true },
    { label: "Total Amount", value: formatCurrency(s.totalAmount), bold: true },
    { label: "Paid", value: formatCurrency(s.amountPaid), bold: true },
    ...(s.outstandingBalance > 0
      ? [{ label: "Outstanding", value: formatCurrency(s.outstandingBalance), bold: true, highlight: true }]
      : []),
    { divider: true },
    { label: "Payment Method", value: s.paymentMethod === "cash" ? "Cash" : "Bank Transfer", bold: true },
    { label: "Items", value: `${s.items.length} product(s)`, bold: false },
    { label: "Date & Time", value: formatDateTime(s.createdAt), bold: false },
    { label: "Sold by", value: s.employeeName, bold: true },
  ];

  return (
    <div
      className="flex flex-col items-start justify-between w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
    >
      <div className="flex flex-col items-start shrink-0 w-full">
        <StatusBar />
        <div className="flex flex-col gap-[16px] items-center pb-[16px] pt-[12px] px-[24px] w-full">
          {/* Receipt card */}
          <div className="w-full rounded-[20px] overflow-hidden animate-fade-in-up delay-225" style={{ border: "1px solid var(--border-light)", background: "var(--surface)" }}>
            <div className="px-5 py-5 text-white" style={{ background: "linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #f59e0b 100%)" }}>
              <p className="text-[20px] font-bold">{s.saleNumber}</p>
              <p className="text-[12px] opacity-85 mt-0.5">{formatDateLong(s.createdAt)} • {formatTime12(s.createdAt)}</p>
            </div>
            <div className="px-5 py-4 flex flex-col gap-[14px]">
              {ROWS.map((row, i) =>
                "divider" in row && row.divider ? (
                  <div key={i} className="w-full h-px" style={{ background: "var(--divider)" }} />
                ) : (
                  <div key={i} className="flex items-start justify-between w-full text-[13px]">
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
            <div className="flex justify-center px-5 pb-4">
              <div className="w-full border-t border-dashed" style={{ borderColor: "var(--divider)" }} />
            </div>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderTop: "1px solid var(--divider)" }}>
              <span className="text-[14px] font-bold" style={{ color: "var(--text-secondary)" }}>Total</span>
              <span className="text-[22px] font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(s.totalAmount)}</span>
            </div>
          </div>


        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-[10px] items-center px-[24px] pb-[32px] pt-[8px] w-full animate-fade-in-up delay-300">
        <button onClick={() => navigate(`${base}/sale`, { replace: true })} className="flex h-[48px] items-center justify-center gap-2 rounded-[24px] w-full font-bold text-[14px] transition-transform active:scale-[0.97]" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
          <ShoppingCart size={16} strokeWidth={2.5} /> New Sale
        </button>
        <button onClick={handleShare} className="flex h-[48px] items-center justify-center gap-2 rounded-[24px] w-full font-bold text-[14px] transition-transform active:scale-[0.97]" style={{ border: "1px solid var(--border-light)", color: "var(--text-primary)" }}>
          <Share2 size={16} strokeWidth={2} /> Share Receipt
        </button>
        <button onClick={handleDownload} className="flex h-[48px] items-center justify-center gap-2 rounded-[24px] w-full font-bold text-[14px] transition-transform active:scale-[0.97]" style={{ border: "1px solid var(--border-light)", color: "var(--text-primary)" }}>
          <Download size={16} strokeWidth={2} /> Download Receipt
        </button>
      </div>
    </div>
  );
}
