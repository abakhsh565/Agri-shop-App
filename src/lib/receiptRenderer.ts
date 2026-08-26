import { formatCurrency } from "@/lib/formatters";

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

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
}

function formatTime12(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: true });
}

export function renderReceiptBlob(s: {
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
      ctx.fillText(s.saleNumber, W / 2, 55);
      ctx.font = "13px sans-serif";
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      ctx.fillText(`${formatDateLong(s.createdAt)}  •  ${formatTime12(s.createdAt)}`, W / 2, 78);

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
