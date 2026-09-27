import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { Share2, Download, Home, Check, Printer, ShoppingCart } from "lucide-react";
import { formatCurrency } from "@/lib/formatters";
import type { Sale } from "@/types";
import { useShellBase } from "@/lib/useShellBase";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useT } from "@/lib/i18n";
import { renderReceiptBlob } from "@/lib/receiptRenderer";
import { clearNav } from "@/lib/navContext";
import StatusBar from "@/components/ui/StatusBar";
import Button from "@/components/ui/Button";

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-PK", { day: "numeric", month: "long", year: "numeric" });
}

function formatTime12(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit", hour12: true });
}

/**
 * The end of a sale: one screen, one glance.
 *
 * Shape of the screen, and why:
 *
 *   • **Nothing scrolls.** The tick, the receipt and every action sit inside a single
 *     viewport on a normal phone, because this is the moment someone is holding a queue
 *     and a customer's change. The content column is vertically centred, so a tall screen
 *     does not leave the card stranded at the top and a short one does not push the buttons
 *     off the bottom (`overflow-y-auto` is kept only as a last resort for a very short
 *     landscape window).
 *   • **`StatusBar` is rendered here like every other screen.** Without it the tick was drawn
 *     underneath the OS status bar on the phone — the one element that says the sale worked.
 *   • **The receipt reads like a receipt:** a band naming what it is and when, the few fields
 *     that matter, a perforation, then the amount on its own line. That ordering is the whole
 *     point of the format: the number you say out loud is the last thing on the card.
 *   • **The band is the app's own brand tone, not a borrowed gradient.** It is the same
 *     primary colour as the buttons beneath it, with the same near-black label, so the screen
 *     belongs to this design system rather than to the reference it was drawn from.
 *   • **Print is a real print**, not a screenshot: the same receipt image the share sheet
 *     sends is put in a hidden frame and sent to the platform's print dialog, with a fallback
 *     to opening the image when the WebView has no print support.
 */
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

  const paidInFull = s.outstandingBalance <= 0;
  const isCredit = s.paymentType !== "full" || !paidInFull;

  async function handleShare() {
    const blob = await renderReceiptBlob(s, t);
    if (!blob) { addToast(t("saleSuccess.failedGenerate"), "error"); return; }
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
    const blob = await renderReceiptBlob(s, t);
    if (!blob) { addToast(t("saleSuccess.failedGenerate"), "error"); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `receipt-${s.saleNumber}.png`; a.click();
    URL.revokeObjectURL(url);
    addToast(t("saleSuccess.receiptDownloaded"), "success");
  }

  async function handlePrint() {
    const blob = await renderReceiptBlob(s, t);
    if (!blob) { addToast(t("saleSuccess.failedGenerate"), "error"); return; }
    const url = URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.style.position = "fixed";
    frame.style.width = "0";
    frame.style.height = "0";
    frame.style.border = "0";
    document.body.appendChild(frame);
    const cleanup = () => {
      frame.remove();
      URL.revokeObjectURL(url);
    };
    const doc = frame.contentDocument;
    if (!doc || typeof frame.contentWindow?.print !== "function") {
      // No print dialog in this WebView (Android's, on some devices): hand the image to the
      // system instead of pretending the receipt was printed.
      frame.remove();
      window.open(url, "_blank");
      addToast(t("copy.openingPrint"), "info");
      return;
    }
    doc.write(
      `<!doctype html><html><head><meta charset="utf-8"><title>${s.saleNumber}</title>` +
      `<style>@page{margin:8mm}html,body{margin:0;background:#fff}img{width:100%;max-width:420px;display:block;margin:0 auto}</style>` +
      `</head><body><img src="${url}" alt="" onload="setTimeout(function(){window.focus();window.print();},50)"></body></html>`
    );
    doc.close();
    addToast(t("copy.openingPrint"), "info");
    // Long enough for the dialog to have taken the image, then release the frame and the URL.
    setTimeout(cleanup, 60_000);
  }

  const rows: Array<{ label: string; value: string; bold?: boolean }> = [
    { label: t("saleSuccess.customer"), value: s.customerName, bold: true },
    ...(s.customerPhone ? [{ label: t("saleSuccess.phone"), value: s.customerPhone }] : []),
    { label: t("saleSuccess.payment"), value: s.paymentMethod === "cash" ? t("sale.cash") : t("sale.bankTransfer") },
    { label: t("saleSuccess.items"), value: `${s.items.length} ${t("common.items")}` },
    { label: t("saleSuccess.soldBy"), value: s.employeeName === user?.name ? t("saleSuccess.you") : s.employeeName },
  ];

  return (
    /* `flex-1`, not `h-full` and not `min-h-full`: the shell hands the page a flex-grown column
       whose own height is auto, so a percentage height resolves against nothing and collapses to
       content height — which is exactly how the card ended up pinned to the top with empty black
       space beneath it on a tall screen. Growing into the space that is there is what makes the
       centring below real. */
    <div className="flex flex-col w-full flex-1 min-h-0" style={{ background: "var(--background)", color: "var(--text-primary)" }}>
      <StatusBar />

      {/* Everything above the actions is centred in the space that is left, so the screen reads
          as one page rather than a page with a gap at the bottom. */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-center px-4 py-2">
        <div className="w-full max-w-[420px] mx-auto">
          {/* Result */}
          <div className="flex flex-col items-center text-center mb-3 animate-pop-in">
            <div
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ background: "var(--brand)", boxShadow: "0 0 0 8px rgba(132,204,22,0.16)" }}
            >
              <Check size={26} strokeWidth={2.5} style={{ color: "#0a0a0a" }} />
            </div>
            <p className="text-lg font-bold mt-2.5">{t("saleSuccess.saleComplete")}</p>
            <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>
              {formatCurrency(s.totalAmount)} {paidInFull ? t("saleSuccess.received") : t("saleSuccess.booked")}
            </p>
          </div>

          {/* Receipt */}
          <div
            className="w-full rounded-[var(--radius-card)] overflow-hidden animate-fade-in-up"
            style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
          >
            {/* Band: what this is, which sale, and when — the three things read first on paper. */}
            <div className="px-4 py-3" style={{ background: "var(--brand)", color: "#0a0a0a" }}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-bold">{t("saleSuccess.saleReceipt")}</p>
                <p className="text-11 font-mono opacity-80">{s.saleNumber}</p>
              </div>
              <p className="text-11 opacity-80 mt-0.5">
                {formatDateLong(s.createdAt)} • {formatTime12(s.createdAt)}
              </p>
            </div>

            {/* Fields */}
            <div className="px-4 py-1">
              {rows.map((row, i) => (
                <div
                  key={row.label}
                  className="flex items-center justify-between gap-4 py-2 text-xs"
                  style={{ borderBottom: i < rows.length - 1 ? "1px solid var(--divider)" : "none" }}
                >
                  <span style={{ color: "var(--text-secondary)" }}>{row.label}</span>
                  <span
                    className={row.bold ? "font-bold text-end" : "font-medium text-end"}
                    style={{ color: "var(--text-primary)" }}
                  >
                    {row.value}
                  </span>
                </div>
              ))}
            </div>

            {/* Perforation: two notches and a dashed rule, the tear-line of a paper receipt. */}
            <div className="relative h-5 flex items-center">
              <div className="w-full border-t border-dashed mx-4" style={{ borderColor: "var(--divider)" }} />
              <div
                className="absolute w-5 h-5 rounded-full"
                style={{ insetInlineStart: -10, background: "var(--background)" }}
              />
              <div
                className="absolute w-5 h-5 rounded-full"
                style={{ insetInlineEnd: -10, background: "var(--background)" }}
              />
            </div>

            {/* The amount, on its own. */}
            <div className="px-4 pb-4 pt-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-bold" style={{ color: "var(--text-secondary)" }}>
                  {t("saleSuccess.totalAmount")}
                </span>
                <span className="text-2xl font-bold tabular-nums">{formatCurrency(s.totalAmount)}</span>
              </div>
              {isCredit && (
                <div className="flex items-center justify-between gap-3 mt-1.5 text-11">
                  <span style={{ color: "var(--text-secondary)" }}>
                    {t("saleSuccess.paid")} {formatCurrency(s.amountPaid)}
                  </span>
                  <span className="font-semibold" style={{ color: "var(--warning)" }}>
                    {t("saleSuccess.outstanding")} {formatCurrency(s.outstandingBalance)}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Actions — the app's own Button, so the shapes and colours match every other screen. */}
      <div className="shrink-0 px-4 pb-5 pt-3 flex flex-col gap-2 animate-fade-in-up">
        <div className="w-full max-w-[420px] mx-auto flex flex-col gap-2">
          <div className="flex gap-2">
            <Button variant="outline" size="sm" className="flex-1" onClick={handleShare}>
              <Share2 size={14} strokeWidth={2.5} className="me-1.5" /> {t("saleSuccess.share")}
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={handlePrint}>
              <Printer size={14} strokeWidth={2} className="me-1.5" /> {t("saleSuccess.print")}
            </Button>
            <Button variant="outline" size="sm" className="flex-1" onClick={handleDownload}>
              <Download size={14} strokeWidth={2} className="me-1.5" /> {t("saleSuccess.download")}
            </Button>
          </div>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => { clearNav(); navigate(`${base}/sale`, { replace: true }); }}
          >
            <ShoppingCart size={15} strokeWidth={2.5} className="me-1.5" /> {t("saleSuccess.newSale")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            fullWidth
            onClick={() => { clearNav(); navigate(`${base}/dashboard`, { replace: true }); }}
          >
            <Home size={14} strokeWidth={2} className="me-1.5" /> {t("saleSuccess.home")}
          </Button>
        </div>
      </div>
    </div>
  );
}
