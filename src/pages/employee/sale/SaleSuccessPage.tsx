import { useEffect } from "react";
import { useNavigate, useLocation, Navigate } from "react-router-dom";
import { Share2, Home, Check, Printer, ShoppingCart } from "lucide-react";
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
import ConfettiBurst from "@/components/ui/ConfettiBurst";
import SaleReceipt from "@/components/sales/SaleReceipt";
import { playConfirmation } from "@/lib/feedback";

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


  // Sound, once, when the screen appears. Not on every render: this is the confirmation of a
  // single event. If the browser has not had a gesture yet it simply stays silent (see
  // lib/feedback.ts — a missing chime must never affect the confirmations).
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => { playConfirmation(); }, []);

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
    <div className="relative flex flex-col w-full flex-1 min-h-0" style={{ background: "var(--background)", color: "var(--text-primary)" }}>
      <StatusBar />
      {/* Decoration only: hidden under reduced-motion, removed when it lands. */}
      <ConfettiBurst />

      {/* Everything above the actions is centred in the space that is left, so the screen reads
          as one page rather than a page with a gap at the bottom. */}
      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col justify-center px-4 py-2">
        <div className="w-full max-w-[420px] mx-auto">
          {/* Result */}
          <div className="flex flex-col items-center text-center mb-3 animate-pop-in">
            {/* The halo: two rings breathing out from behind the tick, so the moment has some
                life to it before anything is read. Pure decoration — gone under reduced-motion. */}
            <div className="relative flex items-center justify-center">
              <span className="ds-ring" style={{ animationDelay: "0s" }} />
              <span className="ds-ring" style={{ animationDelay: "1.3s" }} />
              <div
                className="relative w-12 h-12 rounded-full flex items-center justify-center"
                style={{ background: "var(--brand)", boxShadow: "0 0 0 8px rgba(132,204,22,0.16)" }}
              >
                <Check size={26} strokeWidth={2.5} style={{ color: "#0a0a0a" }} />
              </div>
            </div>
            {/* The amount used to be repeated here as well as on the receipt below — one line
                said twice, and the second one made the screen feel like it was filling space. */}
            <p className="text-lg font-bold mt-3">{t("saleSuccess.saleComplete")}</p>
          </div>

          {/* The receipt itself is one component now, shared with a past sale's detail
              screen: two hand-drawn copies of the same document is how one of them ended up
              printing something else. */}
          <SaleReceipt
            facts={{
              saleNumber: s.saleNumber,
              createdAt: s.createdAt,
              customerName: s.customerName,
              customerPhone: s.customerPhone || undefined,
              soldBy: s.employeeName === user?.name ? t("saleSuccess.you") : s.employeeName,
              paymentMethod: s.paymentMethod,
              itemCount: s.items.length,
              totalAmount: s.totalAmount,
              amountPaid: s.amountPaid,
              outstandingBalance: s.outstandingBalance,
            }}
          />
        </div>
      </div>

      {/*
        Four actions, in the order this screen is actually used:

          1. **New Sale** — the reason the person is standing here; a queue does not end with one
             sale. It is the only primary, and the only large target.
          2. **Share** — the receipt's usual destination now that it is a picture.
          3. **Print** — needed at the counter, not needed by everyone, so it is equal to Share
             and smaller than New Sale.
          4. **Home** — the quiet way out for someone who is done for the day.

        Download was dropped: `Share` already hands the same image to the system, which offers
        Save, and a fifth button made the row pretend there were five equally likely next steps.
      */}
      <div className="shrink-0 px-4 pb-5 pt-3 flex flex-col gap-2 animate-fade-in-up">
        <div className="w-full max-w-[420px] mx-auto flex flex-col gap-2">
          <Button
            variant="primary"
            size="lg"
            fullWidth
            onClick={() => { clearNav(); navigate(`${base}/sale`, { replace: true }); }}
          >
            <ShoppingCart size={16} strokeWidth={2.5} className="me-1.5" /> {t("saleSuccess.newSale")}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" size="md" className="flex-1" onClick={handleShare}>
              <Share2 size={15} strokeWidth={2.5} className="me-1.5" /> {t("saleSuccess.share")}
            </Button>
            <Button variant="outline" size="md" className="flex-1" onClick={handlePrint}>
              <Printer size={15} strokeWidth={2} className="me-1.5" /> {t("saleSuccess.print")}
            </Button>
          </div>
          <button
            type="button"
            onClick={() => { clearNav(); navigate(`${base}/dashboard`, { replace: true }); }}
            className="ds-pressable mx-auto inline-flex items-center gap-1.5 h-9 px-3 text-13 font-semibold"
            style={{ color: "var(--text-secondary)" }}
          >
            <Home size={14} strokeWidth={2} /> {t("saleSuccess.home")}
          </button>
        </div>
      </div>
    </div>
  );
}
