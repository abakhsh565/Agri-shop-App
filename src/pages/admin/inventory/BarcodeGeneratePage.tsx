import { useState, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useProductsStore } from "@/stores/productsStore";
import { useUIStore } from "@/stores/uiStore";
import { barcodeToSvg } from "@/lib/barcode";
import { formatCurrency } from "@/lib/formatters";
import { Download, Share2, Printer, Check, Minus, Plus, Package, Copy } from "lucide-react";

const CATEGORY_COLOR: Record<string, { bg: string; fg: string }> = {
  spray: { bg: "rgba(59,130,246,0.1)", fg: "#3b82f6" },
  seed: { bg: "rgba(132,204,22,0.1)", fg: "#65a30d" },
  fertilizer: { bg: "rgba(245,158,11,0.1)", fg: "#d97706" },
  other: { bg: "rgba(139,92,246,0.1)", fg: "#8b5cf6" },
};

function initColor(name: string) {
  const colors = ["#3b82f6","#84cc16","#f59e0b","#8b5cf6","#06b6d4","#ec4899"];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[h % colors.length];
}

export default function BarcodeGeneratePage() {
  const navigate = useNavigate();
  const products = useProductsStore((s) => s.products);
  const { addToast } = useUIStore();
  const printRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState<Record<string, number>>({});
  const [step, setStep] = useState<"select" | "preview">("select");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(products.map((p) => p.id)));
  }

  function getQty(id: string) {
    return qty[id] ?? 1;
  }

  function setQtyFor(id: string, v: number) {
    setQty((prev) => ({ ...prev, [id]: Math.max(1, Math.min(50, v)) }));
  }

  function generate() {
    if (selected.size === 0) {
      addToast("Select at least one product", "warning");
      return;
    }
    setStep("preview");
  }

  // Build label list for preview
  const labels: { product: typeof products[0]; barcode: string; copies: number }[] = [];
  for (const p of products) {
    if (!selected.has(p.id)) continue;
    if (!p.barcode) continue;
    labels.push({ product: p, barcode: p.barcode, copies: getQty(p.id) });
  }

  // Copy barcode text to clipboard
  async function copyBarcode(barcode: string) {
    try {
      await navigator.clipboard.writeText(barcode);
      addToast(`Copied ${barcode}`, "success");
    } catch {
      addToast("Copy failed", "error");
    }
  }

  // Download as SVG
  function downloadSvg(barcode: string, productName: string) {
    const svg = barcodeToSvg(barcode, { height: 60, showText: true });
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `barcode-${productName.replace(/\s+/g, "-")}-${barcode}.svg`;
    a.click();
    URL.revokeObjectURL(url);
    addToast(`Downloaded barcode for ${productName}`, "success");
  }

  // Share via Web Share API
  async function shareBarcode(barcode: string, productName: string) {
    if (!navigator.share) {
      addToast("Sharing not supported on this device", "warning");
      return;
    }
    const svg = barcodeToSvg(barcode, { height: 60, showText: true });
    const blob = new Blob([svg], { type: "image/svg+xml" });
    const file = new File([blob], `barcode-${barcode}.svg`, { type: "image/svg+xml" });
    try {
      await navigator.share({ title: `Barcode: ${productName}`, files: [file] });
    } catch {
      // user cancelled
    }
  }

  // Print labels
  function printLabels() {
    if (!printRef.current) return;
    const win = window.open("", "_blank");
    if (!win) {
      addToast("Pop-up blocked — allow pop-ups to print", "error");
      return;
    }
    win.document.write(`
      <html><head><title>Print Barcodes</title>
      <style>
        body { font-family: monospace; margin: 20px; }
        .label { border: 1px solid #ccc; padding: 12px; margin: 8px; display: inline-block; text-align: center; width: 200px; }
        .label svg { max-width: 100%; height: auto; }
        .name { font-size: 11px; margin-top: 4px; }
        .price { font-size: 10px; color: #666; }
        @media print { .label { break-inside: avoid; } }
      </style></head><body>
    `);
    for (const { product, barcode, copies } of labels) {
      const svg = barcodeToSvg(barcode, { height: 50, showText: true });
      for (let i = 0; i < copies; i++) {
        win.document.write(`<div class="label">${svg}<div class="name">${product.name}</div><div class="price">${formatCurrency(product.variants[0]?.sellingPrice ?? 0)}</div></div>`);
      }
    }
    win.document.write("</body></html>");
    win.document.close();
    setTimeout(() => { win.print(); }, 500);
    addToast("Opening print dialog…", "info");
  }

  // ── Step 1: Select Products ──
  if (step === "select") {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title="Generate Barcodes" />

        <div className="px-4 pb-2 flex items-center gap-2">
          <button
            onClick={selectAll}
            className="h-8 px-4 rounded-full text-xs font-medium"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
          >
            Select All
          </button>
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {selected.size} selected
          </span>
        </div>

        <div className="flex flex-col px-4 gap-2 pb-24">
          {products.filter(p => p.barcode).map((p) => {
            const catColor = CATEGORY_COLOR[p.category] ?? CATEGORY_COLOR.other;
            const isSelected = selected.has(p.id);
            return (
              <div key={p.id} className="flex items-center gap-3 p-3 rounded-[14px]" style={{ background: "var(--surface-2)" }}>
                {/* Checkbox */}
                <button
                  onClick={() => toggle(p.id)}
                  className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                  style={{
                    background: isSelected ? "var(--brand)" : "transparent",
                    border: isSelected ? "none" : "2px solid var(--divider)",
                  }}
                >
                  {isSelected && <Check size={14} color="#0a0a0a" strokeWidth={3} />}
                </button>

                {/* Product info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: catColor.bg, color: catColor.fg }}>
                      {p.category}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono" style={{ color: "var(--text-secondary)" }}>{p.barcode}</p>
                </div>

                {/* Quantity stepper */}
                {isSelected && (
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => setQtyFor(p.id, getQty(p.id) - 1)}
                      className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ background: "var(--divider)" }}
                    >
                      <Minus size={12} />
                    </button>
                    <span className="text-sm font-bold w-6 text-center" style={{ color: "var(--text-primary)" }}>
                      {getQty(p.id)}
                    </span>
                    <button
                      onClick={() => setQtyFor(p.id, getQty(p.id) + 1)}
                      className="w-7 h-7 rounded-full flex items-center justify-center"
                      style={{ background: "var(--brand)" }}
                    >
                      <Plus size={12} color="#0a0a0a" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {products.filter(p => p.barcode).length === 0 && (
            <div className="flex flex-col items-center py-16 gap-3">
              <Package size={40} style={{ color: "var(--text-secondary)" }} />
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No products with barcodes yet. Add barcodes to products first.</p>
            </div>
          )}
        </div>

        {/* Generate button */}
        {selected.size > 0 && (
          <div className="fixed left-0 right-0 bottom-20 max-w-[480px] mx-auto px-4 z-40">
            <button
              onClick={generate}
              className="w-full h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              Generate {labels.length > 0 ? labels.reduce((s, l) => s + l.copies, 0) : 0} Barcodes
            </button>
          </div>
        )}
      </div>
    );
  }

  // Download all barcodes as individual PNGs
  async function downloadAllPng() {
    for (const { product, barcode, copies } of labels) {
      for (let i = 0; i < copies; i++) {
        const svg = barcodeToSvg(barcode, { height: 80, showText: true });
        const blob = new Blob([svg], { type: "image/svg+xml" });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.src = url;
        await new Promise<void>((resolve) => { img.onload = () => resolve(); });
        const canvas = document.createElement("canvas");
        canvas.width = img.width * 2;
        canvas.height = img.height * 2;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const pngBlob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
        const a = document.createElement("a");
        a.href = URL.createObjectURL(pngBlob);
        a.download = `barcode-${product.name.replace(/\s+/g, "-")}-${barcode}${copies > 1 ? `-${i + 1}` : ""}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    }
    addToast(`Downloaded ${labels.reduce((s, l) => s + l.copies, 0)} barcode images`, "success");
  }

  // ── Step 2: Preview & Actions ──
  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title="Barcode Labels" backTo={undefined} onBack={() => setStep("select")} />

      {/* Action buttons */}
      <div className="flex gap-2 px-4 pb-3 overflow-x-auto">
        <button
          onClick={printLabels}
          className="flex items-center gap-1.5 h-9 px-4 rounded-full text-xs font-semibold shrink-0"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          <Printer size={13} /> Print All
        </button>
        <button
          onClick={() => {
            for (const l of labels) downloadSvg(l.barcode, l.product.name);
          }}
          className="flex items-center gap-1.5 h-9 px-4 rounded-full text-xs font-semibold shrink-0"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
        >
          <Download size={13} /> SVGs
        </button>
        <button
          onClick={downloadAllPng}
          className="flex items-center gap-1.5 h-9 px-4 rounded-full text-xs font-semibold shrink-0"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
        >
          <Download size={13} /> PNGs
        </button>
        <button
          onClick={() => {
            if (labels.length === 1) shareBarcode(labels[0].barcode, labels[0].product.name);
            else addToast("Select a single barcode to share", "info");
          }}
          className="flex items-center gap-1.5 h-9 px-4 rounded-full text-xs font-semibold shrink-0"
          style={{ background: "var(--surface-2)", color: "var(--text-primary)", border: "1px solid var(--divider)" }}
        >
          <Share2 size={13} /> Share
        </button>
      </div>

      {/* Labels grid */}
      <div ref={printRef} className="flex flex-wrap gap-3 px-4 pb-24 justify-center">
        {labels.map(({ product, barcode, copies }) =>
          Array.from({ length: copies }).map((_, i) => {
            const svg = barcodeToSvg(barcode, { height: 60, showText: true });
            return (
              <div
                key={`${product.id}-${i}`}
                className="flex flex-col items-center p-3 rounded-[12px] gap-1"
                style={{ background: "#fff", border: "1px solid var(--divider)", width: 170 }}
                dangerouslySetInnerHTML={{ __html: svg }}
              >
                <p className="text-[10px] font-bold text-center truncate w-full" style={{ color: "#000" }}>
                  {product.name}
                </p>
                <p className="text-[9px]" style={{ color: "#666" }}>
                  {formatCurrency(product.variants[0]?.sellingPrice ?? 0)}
                </p>
                <div className="flex gap-1.5 mt-1">
                  <button
                    onClick={() => copyBarcode(barcode)}
                    className="p-1 rounded-full"
                    style={{ background: "var(--surface-2)" }}
                    title="Copy barcode"
                  >
                    <Copy size={11} style={{ color: "var(--text-primary)" }} />
                  </button>
                  <button
                    onClick={() => downloadSvg(barcode, product.name)}
                    className="p-1 rounded-full"
                    style={{ background: "var(--surface-2)" }}
                    title="Download SVG"
                  >
                    <Download size={11} style={{ color: "var(--text-primary)" }} />
                  </button>
                  <button
                    onClick={() => shareBarcode(barcode, product.name)}
                    className="p-1 rounded-full"
                    style={{ background: "var(--surface-2)" }}
                    title="Share"
                  >
                    <Share2 size={11} style={{ color: "var(--text-primary)" }} />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
