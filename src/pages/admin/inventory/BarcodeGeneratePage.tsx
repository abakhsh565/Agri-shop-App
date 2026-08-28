import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useProductsStore } from "@/stores/productsStore";
import { useUIStore } from "@/stores/uiStore";
import { barcodeToSvg, generateProductBarcode } from "@/lib/barcode";
import { formatCurrency } from "@/lib/formatters";
import { Download, Share2, Check, Package, Copy } from "lucide-react";

const CATEGORY_COLOR: Record<string, { bg: string; fg: string }> = {
  spray: { bg: "rgba(59,130,246,0.1)", fg: "#3b82f6" },
  seed: { bg: "rgba(132,204,22,0.1)", fg: "#65a30d" },
  fertilizer: { bg: "rgba(245,158,11,0.1)", fg: "#d97706" },
  other: { bg: "rgba(139,92,246,0.1)", fg: "#8b5cf6" },
};

export default function BarcodeGeneratePage() {
  const navigate = useNavigate();
  const products = useProductsStore((s) => s.products);
  const { addToast } = useUIStore();
  const printRef = useRef<HTMLDivElement>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [step, setStep] = useState<"select" | "preview">("select");

  // Products without barcodes are eligible for generation
  const eligibleProducts = products.filter((p) => !p.barcode);
  const maxEligible = eligibleProducts.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < maxEligible) next.add(id);
      else addToast(`Max ${maxEligible} barcodes can be generated (products without existing barcodes)`, "warning");
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(eligibleProducts.map((p) => p.id)));
  }

  function getQty(_id: string) {
    return 1;
  }

  function generate() {
    if (selected.size === 0) {
      addToast("Select at least one product", "warning");
      return;
    }
    setStep("preview");
  }

  // Build label list with auto-generated barcodes
  const labels: { product: typeof products[0]; barcode: string; copies: number; isNew: boolean }[] = [];
  for (const p of products) {
    if (!selected.has(p.id)) continue;
    const barcode = p.barcode || generateProductBarcode(p.name);
    labels.push({ product: p, barcode, copies: getQty(p.id), isNew: !p.barcode });
  }

  async function copyBarcode(barcode: string) {
    try {
      await navigator.clipboard.writeText(barcode);
      addToast(`Copied ${barcode}`, "success");
    } catch {
      addToast("Copy failed", "error");
    }
  }

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
    } catch {}
  }

  function printLabels() {
    if (!printRef.current) return;
    const win = window.open("", "_blank");
    if (!win) { addToast("Pop-up blocked", "error"); return; }
    win.document.write(`<html><head><title>Print Barcodes</title>
      <style>body{font-family:monospace;margin:20px}.label{border:1px solid #ccc;padding:12px;margin:8px;display:inline-block;text-align:center;width:200px}.label svg{max-width:100%;height:auto}.name{font-size:11px;margin-top:4px}.price{font-size:10px;color:#666}@media print{.label{break-inside:avoid}}</style></head><body>`);
    for (const { product, barcode, copies } of labels) {
      const svg = barcodeToSvg(barcode, { height: 50, showText: true });
      for (let i = 0; i < copies; i++) {
        win.document.write(`<div class="label">${svg}<div class="name">${product.name}</div><div class="price">${formatCurrency(product.variants[0]?.sellingPrice ?? 0)}</div></div>`);
      }
    }
    win.document.write("</body></html>");
    win.document.close();
    setTimeout(() => win.print(), 500);
    addToast("Opening print dialog…", "info");
  }

  // ── Step 1: Select Products ──
  if (step === "select") {
    return (
      <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title="Generate Barcodes" />

        {/* Info banner */}
        <div className="mx-4 mt-2 rounded-xl p-3" style={{ background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)" }}>
          <p className="text-xs font-semibold" style={{ color: "#3b82f6" }}>
            {eligibleProducts.length} product{eligibleProducts.length !== 1 ? "s" : ""} without barcodes — select to generate 1 barcode each
          </p>
          {maxEligible === 0 && (
            <p className="text-xs mt-1" style={{ color: "var(--text-secondary)" }}>
              All products already have barcodes
            </p>
          )}
        </div>

        <div className="px-4 pb-2 flex items-center gap-2 pt-2">
          <button onClick={selectAll} className="h-8 px-4 rounded-full text-xs font-medium"
            style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
            Select All ({maxEligible})
          </button>
          <span className="text-xs" style={{ color: "var(--text-secondary)" }}>
            {selected.size} selected
          </span>
        </div>

        <div className="flex flex-col px-4 gap-2 pb-24">
          {eligibleProducts.map((p) => {
            const catColor = CATEGORY_COLOR[p.category] ?? CATEGORY_COLOR.other;
            const isSelected = selected.has(p.id);
            const autoBarcode = generateProductBarcode(p.name);
            return (
              <div key={p.id} className="flex items-center gap-3 p-3 rounded-[14px]" style={{ background: "var(--surface-2)" }}>
                <button onClick={() => toggle(p.id)} className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: isSelected ? "var(--brand)" : "transparent", border: isSelected ? "none" : "2px solid var(--divider)" }}>
                  {isSelected && <Check size={14} color="#0a0a0a" strokeWidth={3} />}
                </button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{p.name}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: catColor.bg, color: catColor.fg }}>
                      {p.category}
                    </span>
                  </div>
                  <p className="text-[11px] font-mono" style={{ color: "var(--brand-dark)" }}>
                    → {autoBarcode}
                  </p>
                </div>

              </div>
            );
          })}

          {eligibleProducts.length === 0 && (
            <div className="flex flex-col items-center py-16 gap-2">
              <Package size={40} style={{ color: "var(--text-secondary)" }} />
              <p className="text-sm" style={{ color: "var(--text-secondary)" }}>All products already have barcodes</p>
              <button onClick={() => navigate(-1)} className="text-sm font-bold" style={{ color: "var(--brand)" }}>Go back</button>
            </div>
          )}
        </div>

        {/* Generate button */}
        {selected.size > 0 && (
          <div className="fixed bottom-20 left-0 right-0 px-4 z-40">
            <button onClick={generate}
              className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.97]"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}>
              Generate {selected.size} Barcode{selected.size !== 1 ? "s" : ""} (1 per product)
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Step 2: Preview & Print ──
  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
      <StatusBar />
      <NavHeader title="Barcode Preview" onBack={() => setStep("select")} />

      <div ref={printRef} className="flex flex-col px-4 gap-3 pb-4">
        {labels.map(({ product, barcode, copies }) => {
          const catColor = CATEGORY_COLOR[product.category] ?? CATEGORY_COLOR.other;
          const svg = barcodeToSvg(barcode, { height: 60, showText: true });
          return (
            <div key={product.id + barcode} className="rounded-[14px] p-4" style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{product.name}</p>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: catColor.bg, color: catColor.fg }}>
                  {product.category}
                </span>

              </div>
              <div className="flex justify-center bg-white rounded-lg p-3 mb-3">
                <div dangerouslySetInnerHTML={{ __html: svg }} />
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs font-mono" style={{ color: "var(--text-secondary)" }}>{barcode}</p>
                <div className="flex gap-2">
                  <button onClick={() => copyBarcode(barcode)} className="p-2 rounded-full" style={{ background: "var(--surface)" }}>
                    <Copy size={14} style={{ color: "var(--text-primary)" }} />
                  </button>
                  <button onClick={() => downloadSvg(barcode, product.name)} className="p-2 rounded-full" style={{ background: "var(--surface)" }}>
                    <Download size={14} style={{ color: "var(--text-primary)" }} />
                  </button>
                  <button onClick={() => shareBarcode(barcode, product.name)} className="p-2 rounded-full" style={{ background: "var(--surface)" }}>
                    <Share2 size={14} style={{ color: "var(--text-primary)" }} />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="fixed bottom-20 left-0 right-0 px-4 z-40">
        <button onClick={printLabels}
          className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.97]"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}>
          Print All Labels
        </button>
      </div>
    </div>
  );
}
