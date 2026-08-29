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

/**
 * Draw a Code128 barcode onto a canvas context.
 * Self-contained implementation — no external library needed.
 */
function drawCode128(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, w: number, h: number) {
  // Code128 encoding tables
  const PATTERNS: string[] = [
    "11011001100","11001101100","11001100110","10010011000","10010001100",
    "10001001100","10011001000","10011000100","10001100100","11001001000",
    "11001000100","11000100100","10110011100","10011011100","10011001110",
    "10111001100","10011101100","10011100110","11001110010","11001011100",
    "11001001110","11011100100","11001110100","11101101110","11101001100",
    "11100101100","11100100110","11101100100","11100110100","11100110010",
    "11011011000","11011000110","11000110110","10100011000","10001011000",
    "10001000110","10110001000","10001101000","10001100010","11010001000",
    "11000101000","11000100010","10110111000","10110001110","10001101110",
    "10111011000","10111000110","10001110110","11101110110","11010001110",
    "11000101110","11011101000","11011100010","11011101110","11101011000",
    "11101000110","11100010110","11101101000","11101100010","11100011010",
    "11101111010","11001000010","11110001010","10100110000","10100001100",
    "10010110000","10010000110","10000101100","10000100110","10110010000",
    "10110000100","10011010000","10011000010","10000110100","10000110010",
    "11000010010","11001010000","11110111010","11000010100","10001111010",
    "10100111100","10010111100","10010011110","10111100100","10011110100",
    "10011110010","11110100100","11110010100","11110010010","11011011110",
    "11011110110","11110110110","10101111000","10100011110","10001011110",
    "10111101000","10111100010","11110101000","11110100010","10111011110",
    "10111101110","11101011110","11110101110","11010000100","11010010000",
    "11010011100","11000111010","11010111000","11001011100","11001110100",
    "11011110100","11101011000","11101001100","11101000110","11100101100",
    "11100100110","11101101000","11101100010","11100011010","11101111010",
    "11001000010","11110001010","11000010010","10100110000","10100001100",
    "10010110000","10010000110","10000101100","10000100110","10110010000",
    "10110000100","10011010000","10011000010","10000110100","10000110010",
    "11000010010","11001010000","11110111010",
  ];

  // Calculate checksum
  let checksum = 104; // START-B
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 32;
    if (code < 0 || code > 94) continue;
    checksum += code * (i + 1);
  }
  checksum = checksum % 103;

  // Build binary pattern
  let binary = PATTERNS[104]; // START-B
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) - 32;
    if (code >= 0 && code <= 94) {
      binary += PATTERNS[code];
    }
  }
  binary += PATTERNS[checksum];
  binary += PATTERNS[106]; // STOP

  // Draw bars
  const barWidth = w / binary.length;
  ctx.fillStyle = "#000000";
  for (let i = 0; i < binary.length; i++) {
    if (binary[i] === "1") {
      const bx = x + i * barWidth;
      // Every other bar is narrow (1 module), every other is wide (varies)
      const isNarrow = i % 2 === 0;
      ctx.fillRect(bx, y, isNarrow ? Math.max(barWidth, 0.5) : barWidth * 1.5, h);
    }
  }
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
      const barcodeHeight = 80; // Space for barcode + text
      const totalHeight = sectionStart + detailLines.length * lineHeight + itemsHeight + summaryHeight + barcodeHeight + 80;
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

      // ── Barcode ──
      ctx.strokeStyle = "#e5e5e5";
      ctx.beginPath(); ctx.moveTo(cardMargin + 24, y); ctx.lineTo(W - cardMargin - 24, y); ctx.stroke();
      y += 16;

      // Draw barcode using self-contained Code128 renderer
      const barcodeW = W - cardMargin * 2 - 48;
      const barcodeX = cardMargin + 24;
      const barcodeH = 40;
      drawCode128(ctx, s.saleNumber.replace(/[^A-Za-z0-9]/g, ""), barcodeX, y, barcodeW, barcodeH);
      y += barcodeH + 6;

      // Human-readable barcode text
      ctx.font = "bold 12px monospace";
      ctx.fillStyle = "#1a1a1a";
      ctx.textAlign = "center";
      ctx.fillText(s.saleNumber, W / 2, y);
      ctx.textAlign = "left";
      y += 24;

      // Footer
      ctx.font = "11px sans-serif"; ctx.fillStyle = "#aaa"; ctx.textAlign = "center";
      ctx.fillText("Powered by AgriShop • agrishop.app", W / 2, y);

      canvas.toBlob((blob) => resolve(blob), "image/png");
    } catch {
      resolve(null);
    }
  });
}
