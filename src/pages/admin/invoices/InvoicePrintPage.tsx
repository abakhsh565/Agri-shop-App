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

interface ShopIdentity {
  name: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
}

/**
 * The paper itself.
 *
 * Three layouts, chosen per invoice and stored with it, so a reprint from the archive is the copy
 * the customer was handed. The shop's own name, phone and logo sit at the top of all three: the
 * bill belongs to the shop, and the designs differ in how they say that, not in what they say.
 *
 * Print goes through the browser's own print sheet (the shop picks 58/80 mm or A4 there); Share
 * uses the phone's share sheet, falling back to the customer's WhatsApp, and to the clipboard when
 * there is neither — the number always leaves the device in a form the customer can read.
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

  // The shop's own identity for the header. Read through the server-side profile function, never
  // from `shops` directly: that table has one SELECT policy for the branch being worked in, so a
  // direct read is how a screen ends up printing a blank shop name.
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
        // A role that may bill but not read the business profile still prints; the name comes
        // from the shop summary it already has and the logo is simply absent.
        if (alive) {
          setShop({ name: activeShopName ?? "", phone: null, address: null, logoUrl: null });
        }
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
      `${invoice.customer_name}`,
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
        await navigator.share({ title: `${invoice.invoice_number}`, text: shareText });
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
              {kind === "atelier" ? t("invoice.designAtelier") : kind === "royal" ? t("invoice.designRoyal") : t("invoice.designAurora")}
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
          <span className="flex items-center justify-center gap-2"><Printer size={16} /> {t("invoice.print")}</span>
        </Button>
        <Button variant="outline" size="lg" fullWidth onClick={share}>
          <span className="flex items-center justify-center gap-2"><Share2 size={16} /> {t("invoice.share")}</span>
        </Button>
      </div>
      {notice && (
        <p className="no-print px-4 pt-2 text-12" style={{ color: "var(--text-secondary)" }}>{notice}</p>
      )}
    </div>
  );
}

function Monogram({ shop, color, size = 56 }: { shop: ShopIdentity; color: string; size?: number }) {
  if (shop.logoUrl) {
    return (
      <img
        src={shop.logoUrl}
        alt={shop.name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover" }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: `1.5px solid ${color}`,
        color,
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize: size * 0.42,
      }}
    >
      {shop.name.charAt(0).toUpperCase() || "S"}
    </div>
  );
}

/** One sheet of paper, in one of the three layouts. */
function InvoiceSheet({ invoice, shop, design }: { invoice: Invoice; shop: ShopIdentity; design: InvoiceDesign }) {
  const t = useT();
  const due = Math.max(invoice.total - invoice.amount_paid, 0);

  const paper =
    design === "atelier"
      ? { bg: "#fbf7ef", ink: "#1f2a24", accent: "#b08d3f", rule: "#d8c9a3" }
      : design === "royal"
        ? { bg: "#ffffff", ink: "#0e2a20", accent: "#0e5a3e", rule: "#0e2a20" }
        : { bg: "#ffffff", ink: "#0b1b18", accent: "#0f766e", rule: "#d7e3e0" };

  const serif = "Georgia, 'Times New Roman', serif";
  const body = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  if (design === "aurora") {
    return (
      <div
        className="invoice-sheet overflow-hidden"
        style={{
          background: paper.bg,
          color: paper.ink,
          fontFamily: body,
          borderRadius: 14,
          border: "1px solid #e6ece9",
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          direction: "ltr",
        }}
      >
        <div style={{ background: "linear-gradient(135deg, #0f766e 0%, #115e59 55%, #0b3b36 100%)", color: "#fff", padding: "20px 20px 18px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
              {shop.logoUrl ? (
                <img src={shop.logoUrl} alt={shop.name} style={{ width: 34, height: 34, borderRadius: 8, objectFit: "cover" }} />
              ) : (
                <div style={{ width: 34, height: 34, borderRadius: 8, background: "rgba(255,255,255,0.18)", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>
                  {shop.name.charAt(0).toUpperCase() || "S"}
                </div>
              )}
              <div style={{ minWidth: 0 }}>
                <p style={{ margin: 0, fontWeight: 700, fontSize: 15 }}>{shop.name || "—"}</p>
                {shop.phone && <p style={{ margin: 0, fontSize: 11, opacity: 0.85 }}>{shop.phone}</p>}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <p style={{ margin: 0, fontSize: 10, letterSpacing: 2, opacity: 0.85 }}>{t("invoice.paperInvoice")}</p>
              <p style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{invoice.invoice_number}</p>
            </div>
          </div>
          <p style={{ margin: "16px 0 2px", fontSize: 10, letterSpacing: 2, opacity: 0.85 }}>{t("invoice.paperBalanceDue")}</p>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 700 }}>{formatCurrency(due)}</p>
          <p style={{ margin: "2px 0 0", fontSize: 11, opacity: 0.85 }}>
            {formatCurrency(invoice.amount_paid)} / {formatCurrency(invoice.total)}
          </p>
        </div>

        <div style={{ padding: "14px 16px 18px" }}>
          <div style={{ background: "#f4f7f6", borderRadius: 10, padding: "10px 12px" }}>
            <p style={{ margin: 0, fontSize: 9, letterSpacing: 2, color: "#6b7c76" }}>{t("invoice.paperBillTo")}</p>
            <p style={{ margin: "2px 0 0", fontWeight: 600 }}>{invoice.customer_name}</p>
            {invoice.customer_phone && <p style={{ margin: 0, fontSize: 12, color: "#4b5c56" }}>{invoice.customer_phone}</p>}
          </div>
          <TotalsTable invoice={invoice} paper={paper} body />
          {due > 0 && (
            <div style={{ marginTop: 10, background: "#fde8e6", color: "#a33a2c", borderRadius: 8, padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>{t("invoice.paperBalanceDue")}</span>
              <span style={{ fontSize: 18, fontWeight: 700 }}>{formatCurrency(due)}</span>
            </div>
          )}
          <p style={{ marginTop: 14, textAlign: "center", fontSize: 12, color: paper.accent, fontWeight: 600 }}>
            {invoice.notes || t("invoice.paperThanks")}
          </p>
          <p style={{ marginTop: 4, textAlign: "center", fontSize: 9, color: "#8a9a94" }}>
            {invoice.terms || t("invoice.paperNotTax")}
          </p>
        </div>
      </div>
    );
  }

  if (design === "royal") {
    return (
      <div
        className="invoice-sheet"
        style={{
          background: paper.bg,
          color: paper.ink,
          fontFamily: body,
          padding: 8,
          borderRadius: 14,
          boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
          direction: "ltr",
        }}
      >
        <div style={{ border: "1.5px solid #0e5a3e", padding: 4 }}>
          <div style={{ border: "1px solid #0e5a3e", padding: "18px 16px" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <Monogram shop={shop} color="#0e5a3e" size={54} />
              <p style={{ margin: 0, fontFamily: serif, fontSize: 24, fontWeight: 700, color: "#0e2a20" }}>{shop.name || "—"}</p>
              {shop.phone && <p style={{ margin: 0, fontSize: 12 }}>{shop.phone}</p>}
              <p style={{ margin: "4px 0 0", fontSize: 11, letterSpacing: 3, color: "#b08d3f" }}>- {t("invoice.paperInvoice")} -</p>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, borderTop: "1px solid #d8c9a3", borderBottom: "1px solid #d8c9a3", padding: "10px 0", marginTop: 12 }}>
              <div>
                <p style={{ margin: 0, fontSize: 9, letterSpacing: 2, color: "#6b7c76" }}>{t("invoice.paperBillTo")}</p>
                <p style={{ margin: "2px 0 0", fontFamily: serif, fontSize: 16, fontWeight: 700 }}>{invoice.customer_name}</p>
                {invoice.customer_phone && <p style={{ margin: 0, fontSize: 12 }}>{invoice.customer_phone}</p>}
              </div>
              <div style={{ textAlign: "right", fontSize: 12 }}>
                <p style={{ margin: 0 }}><span style={{ color: "#6b7c76" }}>{t("invoice.paperInvoiceNo")} </span><strong>{invoice.invoice_number}</strong></p>
                <p style={{ margin: "2px 0 0" }}><span style={{ color: "#6b7c76" }}>{t("invoice.paperDate")} </span><strong>{displayDate(invoice.issued_on)}</strong></p>
                {invoice.due_date && (
                  <p style={{ margin: "2px 0 0" }}><span style={{ color: "#6b7c76" }}>{t("invoice.paperDue")} </span><strong>{displayDate(invoice.due_date)}</strong></p>
                )}
              </div>
            </div>

            <TotalsTable invoice={invoice} paper={paper} darkHeader />

            {due > 0 && (
              <div style={{ marginTop: 10, background: "#0e5a3e", color: "#fff", padding: "10px 12px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 10, letterSpacing: 2, fontWeight: 700 }}>{t("invoice.paperBalanceDue")}</span>
                <span style={{ fontSize: 18, fontWeight: 700 }}>{formatCurrency(due)}</span>
              </div>
            )}

            <div style={{ marginTop: 16, borderTop: "1px solid #d8c9a3", paddingTop: 8 }}>
              <p style={{ margin: 0, fontSize: 9, letterSpacing: 2, color: "#b08d3f" }}>{t("invoice.paperInvoice")}</p>
              <p style={{ margin: "2px 0 0", fontSize: 12 }}>{invoice.notes || t("invoice.paperThanks")}</p>
              {invoice.terms && <p style={{ margin: "2px 0 0", fontSize: 11, color: "#6b7c76" }}>{invoice.terms}</p>}
              <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end" }}>
                <div style={{ borderTop: "1px solid #0e2a20", paddingTop: 4, fontSize: 11, color: "#6b7c76", minWidth: 140, textAlign: "center" }}>
                  {t("invoice.paperSignature")}
                </div>
              </div>
              <p style={{ marginTop: 10, textAlign: "center", fontSize: 9, color: "#8a9a94" }}>
                {t("invoice.paperNotTax")}
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Atelier — ivory paper, fine serif, gold rules.
  return (
    <div
      className="invoice-sheet"
      style={{
        background: paper.bg,
        color: paper.ink,
        fontFamily: serif,
        padding: "22px 20px",
        borderRadius: 14,
        boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
        direction: "ltr",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>{shop.name || "—"}</p>
          {shop.phone && <p style={{ margin: "2px 0 0", fontSize: 12, fontFamily: body, color: "#5b655f" }}>{shop.phone}</p>}
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 9, letterSpacing: 3, color: paper.accent, fontFamily: body }}>{t("invoice.paperInvoice")}</p>
          <p style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>#{invoice.invoice_number}</p>
        </div>
      </div>

      <div style={{ height: 1, background: paper.rule, margin: "14px 0" }} />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <p style={{ margin: 0, fontSize: 9, letterSpacing: 2, color: "#7a7f76", fontFamily: body }}>{t("invoice.paperBillTo")}</p>
          <p style={{ margin: "2px 0 0", fontSize: 16, fontWeight: 700 }}>{invoice.customer_name}</p>
          {invoice.customer_phone && <p style={{ margin: 0, fontSize: 12, fontFamily: body, color: "#5b655f" }}>{invoice.customer_phone}</p>}
        </div>
        <div style={{ textAlign: "right", fontSize: 12, fontFamily: body }}>
          <p style={{ margin: 0 }}><span style={{ color: "#7a7f76" }}>{t("invoice.paperInvoiceNo")} </span><strong>{invoice.invoice_number}</strong></p>
          <p style={{ margin: "2px 0 0" }}><span style={{ color: "#7a7f76" }}>{t("invoice.paperDate")} </span><strong>{displayDate(invoice.issued_on)}</strong></p>
          {invoice.due_date && (
            <p style={{ margin: "2px 0 0" }}><span style={{ color: "#7a7f76" }}>{t("invoice.paperDue")} </span><strong>{displayDate(invoice.due_date)}</strong></p>
          )}
        </div>
      </div>

      <TotalsTable invoice={invoice} paper={paper} serif />

      <div style={{ marginTop: 12, borderTop: `1px solid ${paper.rule}`, paddingTop: 8, display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span style={{ fontSize: 9, letterSpacing: 3, color: paper.accent, fontFamily: body }}>{t("invoice.paperBalanceDue")}</span>
        <span style={{ fontSize: 22, fontWeight: 700 }}>{formatCurrency(due)}</span>
      </div>

      <div style={{ marginTop: 26, textAlign: "center" }}>
        <Monogram shop={shop} color={paper.accent} size={40} />
        <p style={{ margin: "8px 0 0", fontSize: 13, fontWeight: 700 }}>{invoice.notes || t("invoice.paperThanks")}</p>
        {invoice.terms && <p style={{ margin: "2px 0 0", fontSize: 11, fontFamily: body, color: "#7a7f76" }}>{invoice.terms}</p>}
        <p style={{ margin: "4px 0 0", fontSize: 9, fontFamily: body, color: "#9a9a90" }}>{t("invoice.paperNotTax")}</p>
      </div>
    </div>
  );
}

function TotalsTable({
  invoice,
  paper,
  serif,
  body,
  darkHeader,
}: {
  invoice: Invoice;
  paper: { bg: string; ink: string; accent: string; rule: string };
  serif?: boolean;
  body?: boolean;
  darkHeader?: boolean;
}) {
  const items = invoice.items ?? [];
  const t = useT();
  const cell: React.CSSProperties = {
    padding: "7px 6px",
    fontSize: 12,
    fontFamily: body ? "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" : serif ? "Georgia, 'Times New Roman', serif" : undefined,
  };
  return (
    <>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 14 }}>
        <thead>
          <tr style={darkHeader ? { background: paper.accent, color: "#fff" } : { borderBottom: `1px solid ${paper.rule}` }}>
            <th style={{ ...cell, textAlign: "left", fontSize: 9, letterSpacing: 2, fontWeight: 700 }}>{t("invoice.paperItem")}</th>
            <th style={{ ...cell, textAlign: "right", fontSize: 9, letterSpacing: 2, fontWeight: 700 }}>{t("invoice.paperQty")}</th>
            <th style={{ ...cell, textAlign: "right", fontSize: 9, letterSpacing: 2, fontWeight: 700, whiteSpace: "nowrap" }}>{t("invoice.paperUnitPrice")}</th>
            <th style={{ ...cell, textAlign: "right", fontSize: 9, letterSpacing: 2, fontWeight: 700 }}>{t("invoice.paperAmount")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.id ?? i} style={{ borderBottom: `1px solid ${darkHeader ? "#eef2f0" : paper.rule}` }}>
              <td style={{ ...cell, fontWeight: 600 }}>{it.description}</td>
              <td style={{ ...cell, textAlign: "right" }}>{it.qty}</td>
              <td style={{ ...cell, textAlign: "right", whiteSpace: "nowrap" }}>{formatCurrency(it.unit_price)}</td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 700, whiteSpace: "nowrap" }}>{formatCurrency(it.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 10, marginLeft: "auto", width: "62%", fontSize: 12, fontFamily: body ? "system-ui, sans-serif" : undefined }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
          <span style={{ color: "#5b655f" }}>{t("invoice.paperSubtotal")}</span>
          <span style={{ fontWeight: 600 }}>{formatCurrency(invoice.subtotal)}</span>
        </div>
        {invoice.discount_amount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span style={{ color: "#5b655f" }}>{t("invoice.paperDiscount")}</span>
            <span>-{formatCurrency(invoice.discount_amount)}</span>
          </div>
        )}
        {invoice.tax_amount > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span style={{ color: "#5b655f" }}>{t("invoice.paperTax")}</span>
            <span>{formatCurrency(invoice.tax_amount)}</span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: `1px solid ${paper.rule}`, fontWeight: 700 }}>
          <span>{t("invoice.paperTotal")}</span>
          <span>{formatCurrency(invoice.total)}</span>
        </div>
        {invoice.amount_paid > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
            <span style={{ color: "#5b655f" }}>{t("invoice.paperPaid")}</span>
            <span>{formatCurrency(invoice.amount_paid)}</span>
          </div>
        )}
      </div>
    </>
  );
}
