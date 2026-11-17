import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Printer, Share2 } from "lucide-react";
import NavHeader from "@/components/ui/NavHeader";
import StatusBar from "@/components/ui/StatusBar";
import Button from "@/components/ui/Button";
import { SkeletonList } from "@/components/ui/Skeleton";
import { displayDate } from "@/components/ui/DateField";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { loadBusinessProfile } from "@/lib/businessProfile";
import { resolveImageUrl } from "@/lib/storage";
import { useShopStore } from "@/stores/shopStore";
import { whatsappShareUrl } from "@/lib/appInvite";
import { getInvoice, INVOICE_DESIGNS, type Invoice, type InvoiceDesign } from "@/lib/invoices";
import InvoiceSheet, { type ShopIdentity } from "@/components/invoices/InvoiceSheet";

/**
 * The paper itself.
 *
 * The sheet is shared with the create form (it is the live preview there and the thumbnail on each
 * design card), so what a shop previews is what prints. Print goes through the browser's own sheet,
 * where the shop's printer settings apply; Share uses the phone's share sheet, falling back to the
 * customer's WhatsApp, and to the clipboard when there is neither.
 */
export default function InvoicePrintPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const t = useT();

  const activeShopId = useShopStore((s) => s.activeShopId);
  const activeShopName = useShopStore((s) => s.activeShopName);

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [shop, setShop] = useState<ShopIdentity | null>(null);
  const [design, setDesign] = useState<InvoiceDesign>("royal");
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) return;
    let alive = true;
    getInvoice(invoiceId)
      .then((inv) => {
        if (!alive) return;
        setInvoice(inv);
        setDesign(inv.design ?? "royal");
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [invoiceId]);

  // Read through the server-side profile function, never from `shops` directly: that table has one
  // SELECT policy for the branch being worked in, so a direct read prints a blank shop name.
  useEffect(() => {
    if (!activeShopId) return;
    let alive = true;
    loadBusinessProfile()
      .then((profile) => {
        if (!alive || !profile) return;
        setShop({
          name: profile.shop.name ?? activeShopName ?? "",
          phone: profile.shop.phone ?? profile.shop.whatsapp_phone ?? null,
          address: profile.shop.address ?? null,
          logoUrl: resolveImageUrl(profile.shop.logo_url) ?? null,
        });
      })
      .catch(() => {
        if (alive) setShop({ name: activeShopName ?? "", phone: null, address: null, logoUrl: null });
      });
    return () => {
      alive = false;
    };
  }, [activeShopId, activeShopName]);

  const shareText = useMemo(() => {
    if (!invoice) return "";
    const due = Math.max(invoice.total - invoice.amount_paid, 0);
    return [
      `${shop?.name ?? activeShopName ?? ""} — ${invoice.invoice_number}`,
      invoice.customer_name,
      `${t("invoice.total")}: ${formatCurrency(invoice.total)}`,
      due > 0 ? `${t("invoice.balanceDue")}: ${formatCurrency(due)}` : t("invoice.alreadyCleared"),
      invoice.due_date ? `${t("invoice.dueDate")}: ${displayDate(invoice.due_date)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }, [invoice, shop, activeShopName, t]);

  async function share() {
    if (!invoice) return;
    setNotice(null);
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: invoice.invoice_number, text: shareText });
        return;
      }
      if (invoice.customer_phone) {
        window.open(whatsappShareUrl(invoice.customer_phone, shareText), "_blank");
        return;
      }
      await navigator.clipboard.writeText(shareText);
      setNotice(t("invoice.copied"));
    } catch {
      // A dismissed share sheet is not a failure; saying nothing is the honest report.
    }
  }

  if (!invoice) {
    return (
      <div className="flex flex-col bg-background w-full min-h-full">
        <StatusBar />
        <NavHeader title={t("invoice.title")} />
        <SkeletonList rows={3} />
      </div>
    );
  }

  const identity: ShopIdentity = shop ?? { name: activeShopName ?? "", phone: null, address: null, logoUrl: null };

  return (
    <div className="flex flex-col bg-background w-full min-h-full pb-8">
      <style>{`
        @media print {
          @page { margin: 10mm; }
          body * { visibility: hidden; }
          .invoice-sheet, .invoice-sheet * { visibility: visible; }
          .invoice-sheet { position: fixed; inset: 0; margin: 0; border-radius: 0; box-shadow: none; }
          .no-print { display: none !important; }
        }
      `}</style>
      <div className="no-print">
        <StatusBar />
        <NavHeader title={t("invoice.preview")} />
      </div>

      <div className="no-print px-4 pt-1 pb-3">
        <div className="flex items-center gap-1 p-1 rounded-[var(--radius-tile)]" style={{ background: "var(--surface-2)" }}>
          {INVOICE_DESIGNS.map((kind) => (
            <button
              key={kind}
              onClick={() => setDesign(kind)}
              aria-pressed={design === kind}
              className="flex-1 py-2 rounded-[var(--radius-tile)] text-12 font-semibold transition-all"
              style={{
                color: design === kind ? "var(--text-primary)" : "var(--text-secondary)",
                background: design === kind ? "var(--background)" : "transparent",
                boxShadow: design === kind ? "0 1px 3px rgba(0,0,0,0.08)" : "none",
              }}
            >
              {kind === "atelier"
                ? t("invoice.designAtelier")
                : kind === "royal"
                  ? t("invoice.designRoyal")
                  : t("invoice.designAurora")}
            </button>
          ))}
        </div>
        <p className="text-11 mt-2" style={{ color: "var(--text-tertiary)" }}>{t("invoice.designHint")}</p>
      </div>

      <div className="px-3">
        <InvoiceSheet invoice={invoice} shop={identity} design={design} />
      </div>

      <div className="no-print px-4 pt-4 flex gap-2">
        <Button variant="cta" size="lg" fullWidth onClick={() => window.print()}>
          <span className="flex items-center justify-center gap-2">
            <Printer size={16} /> {t("invoice.print")}
          </span>
        </Button>
        <Button variant="outline" size="lg" fullWidth onClick={share}>
          <span className="flex items-center justify-center gap-2">
            <Share2 size={16} /> {t("invoice.share")}
          </span>
        </Button>
      </div>
      {notice && (
        <p className="no-print px-4 pt-2 text-12" style={{ color: "var(--text-secondary)" }}>{notice}</p>
      )}
    </div>
  );
}
