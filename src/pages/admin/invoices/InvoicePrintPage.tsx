import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Printer, Settings, Share2 } from "lucide-react";
import NavHeader from "@/components/ui/NavHeader";
import StatusBar from "@/components/ui/StatusBar";
import Button from "@/components/ui/Button";
import { SkeletonList } from "@/components/ui/Skeleton";
import { displayDate } from "@/components/ui/DateField";
import { formatCurrency } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { loadBusinessProfile } from "@/lib/businessProfile";
import { resolveImageUrl } from "@/lib/storage";
import { useShopStore } from "@/stores/shopStore";
import { whatsappShareUrl } from "@/lib/appInvite";
import { getInvoice, type Invoice } from "@/lib/invoices";
import { DEFAULT_INVOICE_SETTINGS, loadInvoiceSettings, type InvoiceSettings } from "@/lib/invoiceSettings";
import { printCurrentPage } from "@/lib/printing";
import InvoiceSheet, { type ShopIdentity } from "@/components/invoices/InvoiceSheet";

/**
 * The paper itself.
 *
 * The sheet, the paper size, the visible fields and the two notes all come from the shop's
 * Invoice settings, so this screen is a preview of exactly what will be handed over. Print goes
 * through `printCurrentPage`, which uses the phone's own print service inside the Android app and
 * the browser's sheet everywhere else.
 */
export default function InvoicePrintPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();

  const activeShopId = useShopStore((s) => s.activeShopId);
  const activeShopName = useShopStore((s) => s.activeShopName);

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [shop, setShop] = useState<ShopIdentity | null>(null);
  const [settings, setSettings] = useState<InvoiceSettings>(DEFAULT_INVOICE_SETTINGS);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!invoiceId) return;
    let alive = true;
    getInvoice(invoiceId)
      .then((inv) => {
        if (alive) setInvoice(inv);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [invoiceId]);

  useEffect(() => {
    let alive = true;
    loadInvoiceSettings(activeShopId)
      .then((loaded) => {
        if (alive) setSettings(loaded);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [activeShopId]);

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
          // The branch's own mark, else the business picture the shop signed up with: a branch
          // added later has no logo of its own and must not print a blank tile.
          logoUrl: resolveImageUrl(profile.shop.logo_url ?? profile.documents?.logo ?? null) ?? null,
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
      {/* `size: auto` lets the phone's print service use the paper loaded in the printer — an A5
          bill on A5 paper, a receipt on the roll — rather than forcing every job through A4. The
          sheet's own width still follows the paper chosen in Invoice settings. */}
      <style>{`
        @media print {
          @page { size: auto; margin: 6mm; }
          html, body { background: #fff !important; }
          body * { visibility: hidden; }
          .invoice-sheet, .invoice-sheet * { visibility: visible; }
          .invoice-sheet {
            position: absolute;
            inset-inline-start: 0;
            top: 0;
            width: 100% !important;
            max-width: none !important;
            margin: 0;
            border-radius: 0;
            box-shadow: none;
          }
          /* A till roll is not a page: the receipt keeps its 80mm column instead of being
             stretched across the sheet, which is what used to scatter its columns. */
          .invoice-sheet--thermal {
            width: 68mm !important;
            max-width: 68mm !important;
            margin-inline: auto !important;
          }
          .no-print { display: none !important; }
          * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>
      <div className="no-print">
        <StatusBar />
        <NavHeader
          title={t("invoice.preview")}
          right={
            <button
              type="button"
              onClick={() => navigate(`${base}/invoices/settings`)}
              aria-label={t("invoiceSettings.open")}
              data-testid="invoice-print-settings"
              className="flex items-center justify-center size-11 rounded-full active:opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              <Settings size={18} />
            </button>
          }
        />
      </div>

      <div className="px-3">
        <InvoiceSheet
          invoice={invoice}
          shop={identity}
          design={settings.design}
          paper={settings.paper}
          settings={settings}
        />
      </div>

      <div className="no-print px-4 pt-4 flex gap-2">
        <Button
          variant="cta"
          size="lg"
          fullWidth
          onClick={() => {
            void printCurrentPage();
          }}
        >
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
