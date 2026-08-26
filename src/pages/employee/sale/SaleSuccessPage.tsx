import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { ShoppingCart, Share2, Download, Receipt } from "lucide-react";
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

// ─── Canvas helpers ────────────────────────────────────────────────────────
function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function roundRectTop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Render the receipt onto a canvas and return it as a PNG Blob */
function renderReceiptBlob(s: {
  saleNumber: string; customerName: string; customerPhone: string;
  employeeName: string; paymentMethod: string; paymentType: string;
  createdAt: string; totalAmount: number; amountPaid: number;
  outstandingBalance: number; subtotal: number;
  items: { productName: string; variantName: string; qty: number; unitPrice: number }[];
}): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d")!;
      const W = 400;
      canvas.width = W;

      const lineHeight = 28;
      const headerHeight = 120;
      const sectionStart = headerHeight + 20;

      const detailLines = [
        { label: "Sale #", value: s.saleNumber },
        { label: "Date", value: formatDateLong(s.createdAt) },
        { label: "Time", value: formatTime12(s.createdAt) },
        { label: "Customer", value: s.customerName },
        { label: "Phone", value: s.customerPhone || "N/A" },
        { label: "Sold by", value: s.employeeName },
        { label: "Method", value: s.paymentMethod === "cash" ? "Cash" : "Bank Transfer" },
        { label: "Payment", value: s.paymentType === "full" ? "Full Payment" : "Partial / Credit" },
      ];

      const itemsHeight = s.items.length * 26 + 40;
      const summaryHeight = 140;
      const totalHeight = sectionStart + detailLines.length * lineHeight + itemsHeight + summaryHeight + 80;
      canvas.height = totalHeight;

      ctx.fillStyle = "#f0f0f0";
      ctx.fillRect(0, 0, W, totalHeight);

      const cardMargin = 16;
      const cardW = W - cardMargin * 2;
      ctx.fillStyle = "#ffffff";
      roundRect(ctx, cardMargin, 10, cardW, totalHeight - 30, 16);
      ctx.fill();

      const grad = ctx.createLinearGradient(cardMargin, 10, cardMargin + cardW, 10);
      grad.addColorStop(0, "#a855f7");
      grad.addColorStop(0.5, "#ec4899");
      grad.addColorStop(1, "#f59e0b");
      ctx.fillStyle = grad;
      roundRectTop(ctx, cardMargin, 10, cardW, headerHeight, 16);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 22px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Sale Receipt", W / 2, 55);
      ctx.font = "13px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(`${formatDateLong(s.createdAt)}  •  ${formatTime12(s.createdAt)}`, W / 2, 78);
      ctx.font = "bold 11px monospace";
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(s.saleNumber, W / 2, 100);

      let y = sectionStart + 10;
      ctx.textAlign = "left";
      for (const line of detailLines) {
        ctx.font = "12px sans-serif";
        ctx.fillStyle = "#888888";
        ctx.fillText(line.label, cardMargin + 24, y);
        ctx.font = "bold 13px sans-serif";
        ctx.fillStyle = "#1a1a1a";
        ctx.textAlign = "right";
        ctx.fillText(line.value, W - cardMargin - 24, y);
        ctx.textAlign = "left";
        y += lineHeight;
      }

      y += 8;
      ctx.strokeStyle = "#e5e5e5"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(cardMargin + 24, y); ctx.lineTo(W - cardMargin - 24, y); ctx.stroke();
      y += 12;

      ctx.font = "bold 12px sans-serif"; ctx.fillStyle = "#888888";
      ctx.fillText("ITEMS", cardMargin + 24, y);
      y += 18;

      for (const item of s.items) {
        ctx.font = "12px sans-serif"; ctx.fillStyle = "#1a1a1a";
        ctx.fillText(`${item.productName} (${item.variantName})`, cardMargin + 24, y);
        ctx.textAlign = "right";
        ctx.fillText(`${item.qty} × ${formatCurrency(item.unitPrice)}`, W - cardMargin - 24, y);
        ctx.textAlign = "left";
        y += 26;
      }

      y += 8;
      ctx.strokeStyle = "#e5e5e5";
      ctx.beginPath(); ctx.moveTo(cardMargin + 24, y); ctx.lineTo(W - cardMargin - 24, y); ctx.stroke();
      y += 20;

      const summaryItems = [
        { label: "Subtotal", value: formatCurrency(s.subtotal) },
        { label: "Paid", value: formatCurrency(s.amountPaid), color: "#22c55e" },
        ...(s.outstandingBalance > 0
          ? [{ label: "Outstanding", value: formatCurrency(s.outstandingBalance), color: "#ef4444" }]
          : []),
      ];
      for (const si of summaryItems) {
        ctx.font = "13px sans-serif"; ctx.fillStyle = "#888888";
        ctx.fillText(si.label, cardMargin + 24, y);
        ctx.font = "bold 14px sans-serif"; ctx.fillStyle = (si as any).color || "#1a1a1a";
        ctx.textAlign = "right";
        ctx.fillText(si.value, W - cardMargin - 24, y);
        ctx.textAlign = "left";
        y += 30;
      }

      ctx.strokeStyle = "#e5e5e5";
      ctx.beginPath(); ctx.moveTo(cardMargin + 24, y); ctx.lineTo(W - cardMargin - 24, y); ctx.stroke();
      y += 24;
      ctx.font = "bold 14px sans-serif"; ctx.fillStyle = "#1a1a1a";
      ctx.fillText("TOTAL", cardMargin + 24, y);
      ctx.font = "bold 20px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(formatCurrency(s.totalAmount), W - cardMargin - 24, y);
      ctx.textAlign = "left";
      y += 40;

      ctx.font = "11px sans-serif"; ctx.fillStyle = "#aaa"; ctx.textAlign = "center";
      ctx.fillText("Powered by AgriShop • agrishop.app", W / 2, y);

      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
}

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

    // Convert blob to base64 data URL for Capacitor Share plugin
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(blob);
    });

    // Try Capacitor native share first (opens Android share sheet with image)
    try {
      const { Share } = await import("@capacitor/share");
      await Share.share({
        title: "AgriShop Receipt",
        dialogTitle: "Share Receipt",
        url: dataUrl,
      });
      return;
    } catch {
      // Capacitor Share not available — fall through
    }

    // Try Web Share API with file (works on Android Chrome)
    const file = new File([blob], `receipt-${s.saleNumber}.png`, { type: "image/png" });
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
    a.download = `receipt-${s.saleNumber}.png`;
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
        <div className="flex flex-col gap-[24px] items-center pb-[24px] pt-[32px] px-[24px] w-full">
          {/* Success icon */}
          <div
            className="animate-pop-in"
            style={{
              width: 72, height: 72, borderRadius: 36,
              background: "var(--brand)",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: "0 0 0 12px rgba(132, 204, 22, 0.15)",
            }}
          >
            <svg fill="none" height="32" viewBox="0 0 32 32" width="32">
              <path d="M8 16.5L13 21.5L24 10.5" stroke="white" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" style={{ animation: "checkDraw 0.4s 0.3s ease both" }} />
            </svg>
          </div>

          {/* Title */}
          <div className="flex flex-col gap-[6px] items-center text-center w-full animate-fade-in-up delay-150">
            <p className="font-bold text-[26px]" style={{ color: "var(--text-primary)" }}>Sale Completed!</p>
            <p className="font-normal text-[13px]" style={{ color: "var(--text-secondary)" }}>
              {s.saleNumber} • Receipt generated
            </p>
          </div>

          {/* Receipt card */}
          <div className="w-full rounded-[20px] overflow-hidden animate-fade-in-up delay-225" style={{ border: "1px solid var(--border-light)", background: "var(--surface)" }}>
            <div className="px-5 py-5 text-white" style={{ background: "linear-gradient(135deg, #a855f7 0%, #ec4899 50%, #f59e0b 100%)" }}>
              <p className="text-[20px] font-bold">Sale Receipt</p>
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

          {/* Items summary */}
          {s.items.length > 0 && (
            <div className="w-full rounded-[16px] p-4 animate-fade-in-up delay-300" style={{ background: "var(--surface-2)" }}>
              <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>Items in this sale</p>
              {s.items.map((item, i) => (
                <div key={i} className="flex items-center justify-between py-1.5" style={{ borderBottom: i < s.items.length - 1 ? "1px solid var(--divider)" : "none" }}>
                  <span className="text-[12px]" style={{ color: "var(--text-primary)" }}>{item.productName} ({item.variantName})</span>
                  <span className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>{item.qty} × {formatCurrency(item.unitPrice)}</span>
                </div>
              ))}
            </div>
          )}
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
          <Download size={16} strokeWidth={2} /> Download Receipt (PNG)
        </button>
        <button onClick={() => navigate(`${base}/sales/${s.id}`)} className="flex h-[48px] items-center justify-center gap-2 rounded-[24px] w-full font-bold text-[14px] transition-transform active:scale-[0.97]" style={{ border: "1px solid var(--border-light)", color: "var(--text-primary)" }}>
          <Receipt size={16} strokeWidth={2} /> View Receipt
        </button>
      </div>
    </div>
  );
}
