import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/formatters";
import { displayDate } from "@/components/ui/DateField";
import type { Invoice, InvoiceDesign } from "@/lib/invoices";

export interface ShopIdentity {
  name: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
}

const SANS = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

/**
 * The paper.
 *
 * One sheet, three layouts. It is drawn once here and used three ways: on the print screen, as the
 * live preview inside the create form, and — scaled down — as the thumbnail on each design card.
 * A thumbnail that is a separate picture is a thumbnail that lies the moment a design changes.
 *
 * Type and spacing come from the app's own scale (9/11/12/14 px labels, bold totals, tabular
 * numbers), so the paper looks like the product rather than like a screenshot of another one. The
 * paper is always LTR: a bill in this market is printed in English even when the app is in Urdu.
 */
export default function InvoiceSheet({
  invoice,
  shop,
  design,
}: {
  invoice: Invoice;
  shop: ShopIdentity;
  design: InvoiceDesign;
}) {
  if (design === "aurora") return <Aurora invoice={invoice} shop={shop} />;
  if (design === "royal") return <Royal invoice={invoice} shop={shop} />;
  return <Atelier invoice={invoice} shop={shop} />;
}

/* ─── shared pieces ─────────────────────────────────────────────────────────────────────── */

function itemsTable(invoice: Invoice, opts: { header: "plain" | "band"; rule: string; ink: string }) {
  const t = useT();
  const items = invoice.items ?? [];
  const th = {
    fontSize: 9,
    letterSpacing: 1.4,
    textTransform: "uppercase" as const,
    fontWeight: 700,
    padding: "9px 0",
  };
  const td = { fontSize: 12, padding: "9px 0", borderBottom: `1px solid ${opts.rule}` };

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 16 }}>
      <thead>
        <tr
          style={
            opts.header === "band"
              ? { background: opts.ink, color: "#fff" }
              : { borderBottom: `1px solid ${opts.rule}`, color: opts.ink }
          }
        >
          <th style={{ ...th, textAlign: "left", paddingInline: opts.header === "band" ? 8 : 0 }}>
            {t("invoice.paperItem")}
          </th>
          <th style={{ ...th, textAlign: "right", width: 44 }}>{t("invoice.paperQty")}</th>
          <th style={{ ...th, textAlign: "right", width: 92, paddingInlineEnd: opts.header === "band" ? 8 : 0 }}>
            {t("invoice.paperUnitPrice")}
          </th>
          <th style={{ ...th, textAlign: "right", width: 92, paddingInlineEnd: opts.header === "band" ? 8 : 0 }}>
            {t("invoice.paperAmount")}
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={it.id ?? i}>
            <td style={{ ...td, fontWeight: 600 }}>{it.description}</td>
            <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{it.qty}</td>
            <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {formatCurrency(it.unit_price)}
            </td>
            <td
              style={{
                ...td,
                textAlign: "right",
                fontWeight: 700,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              {formatCurrency(it.line_total)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Subtotal → discount → tax → total → paid, aligned on one right edge. */
function totalsBlock(invoice: Invoice, opts: { rule: string; totalBg?: string; totalInk?: string }) {
  const t = useT();
  const row = { display: "flex", justifyContent: "space-between", gap: 16, padding: "3px 0", fontSize: 12 };
  return (
    <div style={{ marginTop: 10, marginInlineStart: "auto", width: "58%" }}>
      <div style={row}>
        <span style={{ color: "#6b7280" }}>{t("invoice.paperSubtotal")}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(invoice.subtotal)}</span>
      </div>
      {invoice.discount_amount > 0 && (
        <div style={row}>
          <span style={{ color: "#6b7280" }}>{t("invoice.paperDiscount")}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>-{formatCurrency(invoice.discount_amount)}</span>
        </div>
      )}
      {invoice.tax_amount > 0 && (
        <div style={row}>
          <span style={{ color: "#6b7280" }}>{t("invoice.paperTax")}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(invoice.tax_amount)}</span>
        </div>
      )}
      <div
        style={{
          ...row,
          marginTop: 6,
          paddingTop: 8,
          borderTop: `1px solid ${opts.rule}`,
          fontSize: 14,
          fontWeight: 700,
          background: opts.totalBg,
          color: opts.totalInk,
        }}
      >
        <span>{t("invoice.paperTotal")}</span>
        <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(invoice.total)}</span>
      </div>
      {invoice.amount_paid > 0 && (
        <div style={row}>
          <span style={{ color: "#6b7280" }}>{t("invoice.paperPaid")}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(invoice.amount_paid)}</span>
        </div>
      )}
    </div>
  );
}

function balanceRow(invoice: Invoice, style: React.CSSProperties, labelStyle: React.CSSProperties) {
  const t = useT();
  const due = Math.max(invoice.total - invoice.amount_paid, 0);
  if (due <= 0) return null;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        padding: "10px 12px",
        marginTop: 10,
        borderRadius: 6,
        ...style,
      }}
    >
      <span style={{ fontSize: 9, letterSpacing: 1.6, fontWeight: 700, textTransform: "uppercase", ...labelStyle }}>
        {t("invoice.paperBalanceDue")}
      </span>
      <span style={{ fontSize: 20, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
        {formatCurrency(due)}
      </span>
    </div>
  );
}

function Monogram({ shop, color, size = 52 }: { shop: ShopIdentity; color: string; size?: number }) {
  if (shop.logoUrl) {
    return (
      <img
        src={shop.logoUrl}
        alt={shop.name}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
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
        border: `1px solid ${color}`,
        color,
        fontFamily: SERIF,
        fontSize: size * 0.4,
        flexShrink: 0,
      }}
    >
      {shop.name.charAt(0).toUpperCase() || "S"}
    </div>
  );
}

/* ─── Atelier: ivory paper, fine serif, gold hairline rules ────────────────────────────── */

function Atelier({ invoice, shop }: { invoice: Invoice; shop: ShopIdentity }) {
  const t = useT();
  const accent = "#b08948";
  const rule = "#ddd0b4";
  return (
    <div
      className="invoice-sheet"
      style={{
        background: "#fbf8f1",
        color: "#1e2a24",
        fontFamily: SERIF,
        padding: "26px 24px",
        borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        direction: "ltr",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: -0.2 }}>{shop.name || "—"}</p>
          {shop.phone && (
            <p style={{ margin: "4px 0 0", fontSize: 11, fontFamily: SANS, color: "#6d7469", letterSpacing: 0.3 }}>
              {shop.phone}
            </p>
          )}
          {shop.address && (
            <p style={{ margin: "2px 0 0", fontSize: 11, fontFamily: SANS, color: "#6d7469", maxWidth: 220 }}>
              {shop.address}
            </p>
          )}
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ margin: 0, fontSize: 9, letterSpacing: 3, color: accent, fontFamily: SANS }}>
            {t("invoice.paperInvoice")}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 22, fontWeight: 700, letterSpacing: 0.2 }}>
            #{invoice.invoice_number}
          </p>
        </div>
      </div>

      <div style={{ height: 1, background: rule, margin: "16px 0  18px" }} />

      <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 9, letterSpacing: 2, color: "#8a8b80", fontFamily: SANS }}>
            {t("invoice.paperBillTo")}
          </p>
          <p style={{ margin: "4px 0 0", fontSize: 15, fontWeight: 700 }}>{invoice.customer_name}</p>
          {invoice.customer_phone && (
            <p style={{ margin: "2px 0 0", fontSize: 11, fontFamily: SANS, color: "#6d7469" }}>
              {invoice.customer_phone}
            </p>
          )}
        </div>
        <div style={{ textAlign: "right", fontFamily: SANS, fontSize: 11, color: "#5f665d", lineHeight: 1.7 }}>
          <p style={{ margin: 0 }}>
            {t("invoice.paperInvoiceNo")} <strong style={{ color: "#1e2a24" }}>{invoice.invoice_number}</strong>
          </p>
          <p style={{ margin: 0 }}>
            {t("invoice.paperDate")} <strong style={{ color: "#1e2a24" }}>{displayDate(invoice.issued_on)}</strong>
          </p>
          {invoice.due_date && (
            <p style={{ margin: 0 }}>
              {t("invoice.paperDue")} <strong style={{ color: "#1e2a24" }}>{displayDate(invoice.due_date)}</strong>
            </p>
          )}
        </div>
      </div>

      {itemsTable(invoice, { header: "plain", rule, ink: "#1e2a24" })}
      {totalsBlock(invoice, { rule })}

      <div
        style={{
          marginTop: 14,
          borderTop: `1px solid ${rule}`,
          paddingTop: 10,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <span style={{ fontSize: 9, letterSpacing: 2.4, color: accent, fontFamily: SANS }}>
          {t("invoice.paperBalanceDue")}
        </span>
        <span style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
          {formatCurrency(Math.max(invoice.total - invoice.amount_paid, 0))}
        </span>
      </div>

      <div style={{ marginTop: 26, textAlign: "center" }}>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <Monogram shop={shop} color={accent} size={38} />
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 12.5, fontWeight: 700 }}>
          {invoice.notes || t("invoice.paperThanks")}
        </p>
        {invoice.terms && (
          <p style={{ margin: "3px 0 0", fontSize: 10.5, fontFamily: SANS, color: "#7a8077" }}>{invoice.terms}</p>
        )}
        <p style={{ margin: "5px 0 0", fontSize: 9, fontFamily: SANS, color: "#9a9f95" }}>{t("invoice.paperNotTax")}</p>
      </div>
    </div>
  );
}

/* ─── Royal: crest, framed border, green band on the items ─────────────────────────────── */

function Royal({ invoice, shop }: { invoice: Invoice; shop: ShopIdentity }) {
  const t = useT();
  const ink = "#0d3b2e";
  const rule = "#dce5df";
  return (
    <div
      className="invoice-sheet"
      style={{
        background: "#ffffff",
        color: ink,
        fontFamily: SANS,
        padding: 7,
        borderRadius: 12,
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        direction: "ltr",
      }}
    >
      <div style={{ border: `1.5px solid ${ink}`, borderRadius: 6, padding: 3 }}>
        <div style={{ border: `1px solid ${rule}`, borderRadius: 4, padding: "20px 18px 18px" }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
            <Monogram shop={shop} color={ink} size={52} />
            <p style={{ margin: 0, fontFamily: SERIF, fontSize: 23, fontWeight: 700, letterSpacing: 0.2 }}>
              {shop.name || "—"}
            </p>
            {shop.phone && <p style={{ margin: 0, fontSize: 11, color: "#5b6b63" }}>{shop.phone}</p>}
            <p style={{ margin: "2px 0 0", fontSize: 9, letterSpacing: 3.2, color: ink }}>
              {t("invoice.paperInvoice")}
            </p>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 18,
              marginTop: 16,
              paddingTop: 14,
              borderTop: `1px solid ${rule}`,
              borderBottom: `1px solid ${rule}`,
              paddingBottom: 14,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 9, letterSpacing: 2, color: "#7d8a83" }}>{t("invoice.paperBillTo")}</p>
              <p style={{ margin: "4px 0 0", fontFamily: SERIF, fontSize: 15, fontWeight: 700 }}>
                {invoice.customer_name}
              </p>
              {invoice.customer_phone && (
                <p style={{ margin: "2px 0 0", fontSize: 11, color: "#5b6b63" }}>{invoice.customer_phone}</p>
              )}
            </div>
            <div style={{ textAlign: "right", fontSize: 11, lineHeight: 1.8, color: "#7d8a83" }}>
              <p style={{ margin: 0 }}>
                {t("invoice.paperInvoiceNo")} <strong style={{ color: ink }}>{invoice.invoice_number}</strong>
              </p>
              <p style={{ margin: 0 }}>
                {t("invoice.paperDate")} <strong style={{ color: ink }}>{displayDate(invoice.issued_on)}</strong>
              </p>
              {invoice.due_date && (
                <p style={{ margin: 0 }}>
                  {t("invoice.paperDue")} <strong style={{ color: ink }}>{displayDate(invoice.due_date)}</strong>
                </p>
              )}
            </div>
          </div>

          <div style={{ margin: "16px -18px 0" }}>
            {itemsTable(invoice, { header: "band", rule, ink })}
          </div>
          {totalsBlock(invoice, { rule })}
          {balanceRow(
            invoice,
            { background: ink, color: "#fff", borderRadius: 4 },
            { color: "#cfd9d4" },
          )}

          <div style={{ marginTop: 18, paddingTop: 12, borderTop: `1px solid ${rule}` }}>
            <p style={{ margin: 0, fontSize: 9, letterSpacing: 2, color: "#7d8a83" }}>{t("invoice.paperInvoice")}</p>
            <p style={{ margin: "3px 0 0", fontSize: 11.5, color: "#33463d" }}>
              {invoice.notes || t("invoice.paperThanks")}
            </p>
            {invoice.terms && (
              <p style={{ margin: "2px 0 0", fontSize: 10.5, color: "#7d8a83" }}>{invoice.terms}</p>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 22 }}>
              <div
                style={{
                  borderTop: `1px solid ${ink}`,
                  paddingTop: 5,
                  minWidth: 150,
                  textAlign: "center",
                  fontSize: 10.5,
                  color: "#7d8a83",
                }}
              >
                {t("invoice.paperSignature")}
              </div>
            </div>
            <p style={{ margin: "12px 0 0", textAlign: "center", fontSize: 9, color: "#9aa69f" }}>
              {t("invoice.paperNotTax")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Aurora: modern, gradient header, the balance is the headline ─────────────────────── */

function Aurora({ invoice, shop }: { invoice: Invoice; shop: ShopIdentity }) {
  const t = useT();
  const due = Math.max(invoice.total - invoice.amount_paid, 0);
  const ink = "#0b1b18";
  const rule = "#e6ece9";
  return (
    <div
      className="invoice-sheet"
      style={{
        background: "#ffffff",
        color: ink,
        fontFamily: SANS,
        borderRadius: 14,
        overflow: "hidden",
        border: `1px solid ${rule}`,
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
        direction: "ltr",
      }}
    >
      <div
        style={{
          background: "linear-gradient(135deg, #0f766e 0%, #115e59 58%, #0b3b36 100%)",
          color: "#ffffff",
          padding: "20px 20px 18px",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", minWidth: 0 }}>
            {shop.logoUrl ? (
              <img
                src={shop.logoUrl}
                alt={shop.name}
                style={{ width: 36, height: 36, borderRadius: 9, objectFit: "cover", flexShrink: 0 }}
              />
            ) : (
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  background: "rgba(255,255,255,0.16)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  flexShrink: 0,
                }}
              >
                {shop.name.charAt(0).toUpperCase() || "S"}
              </div>
            )}
            <div style={{ minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 14.5, fontWeight: 700 }}>{shop.name || "—"}</p>
              {shop.phone && <p style={{ margin: "1px 0 0", fontSize: 10.5, opacity: 0.82 }}>{shop.phone}</p>}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <p style={{ margin: 0, fontSize: 9, letterSpacing: 2.2, opacity: 0.82 }}>{t("invoice.paperInvoice")}</p>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{invoice.invoice_number}</p>
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <p style={{ margin: 0, fontSize: 9, letterSpacing: 2.2, opacity: 0.82 }}>{t("invoice.paperBalanceDue")}</p>
          <p style={{ margin: "2px 0 0", fontSize: 28, fontWeight: 700, letterSpacing: -0.4, fontVariantNumeric: "tabular-nums" }}>
            {formatCurrency(due)}
          </p>
          <p style={{ margin: "2px 0 0", fontSize: 10.5, opacity: 0.82 }}>
            {formatCurrency(invoice.amount_paid)} / {formatCurrency(invoice.total)}
          </p>
        </div>
      </div>

      <div style={{ padding: "16px 20px 20px" }}>
        <div
          style={{
            background: "#f4f7f6",
            borderRadius: 10,
            padding: "10px 12px",
            display: "flex",
            justifyContent: "space-between",
            gap: 14,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 9, letterSpacing: 2, color: "#6b7c76" }}>{t("invoice.paperBillTo")}</p>
            <p style={{ margin: "3px 0 0", fontSize: 13.5, fontWeight: 600 }}>{invoice.customer_name}</p>
            {invoice.customer_phone && (
              <p style={{ margin: 0, fontSize: 11, color: "#4b5c56" }}>{invoice.customer_phone}</p>
            )}
          </div>
          <div style={{ textAlign: "right", fontSize: 10.5, color: "#6b7c76", lineHeight: 1.7, flexShrink: 0 }}>
            <p style={{ margin: 0 }}>
              {t("invoice.paperDate")} <span style={{ color: ink }}>{displayDate(invoice.issued_on)}</span>
            </p>
            {invoice.due_date && (
              <p style={{ margin: 0 }}>
                {t("invoice.paperDue")} <span style={{ color: ink }}>{displayDate(invoice.due_date)}</span>
              </p>
            )}
          </div>
        </div>

        {itemsTable(invoice, { header: "plain", rule, ink })}
        {totalsBlock(invoice, { rule })}
        {balanceRow(invoice, { background: "#fdeceb", color: "#a23a2c" }, { color: "#a23a2c" })}

        <p style={{ margin: "16px 0 0", textAlign: "center", fontSize: 12, fontWeight: 600, color: "#0f766e" }}>
          {invoice.notes || t("invoice.paperThanks")}
        </p>
        <p style={{ margin: "4px 0 0", textAlign: "center", fontSize: 9, color: "#8a9a94" }}>
          {invoice.terms || t("invoice.paperNotTax")}
        </p>
      </div>
    </div>
  );
}

/**
 * A design card's thumbnail: the real sheet, scaled down.
 *
 * `scale` is the ratio of the card to the sheet's own 360 px width, so the layout inside is the
 * layout that prints — not a drawing of it. The wrapper clips to the card's height, which is what a
 * thumbnail is: the top of the page, recognisable at a glance.
 */
export function InvoiceDesignThumb({
  design,
  sample,
  shop,
  width = 52,
  height = 66,
}: {
  design: InvoiceDesign;
  sample: Invoice;
  shop: ShopIdentity;
  width?: number;
  height?: number;
}) {
  const inner = 360;
  const scale = width / inner;
  return (
    <div
      aria-hidden
      style={{
        width,
        height,
        overflow: "hidden",
        borderRadius: 5,
        border: "1px solid var(--divider)",
        background: design === "atelier" ? "#fbf8f1" : design === "royal" ? "#ffffff" : "#ffffff",
        flexShrink: 0,
        position: "relative",
      }}
    >
      <div
        style={{
          width: inner,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          pointerEvents: "none",
        }}
      >
        <InvoiceSheet invoice={sample} shop={shop} design={design} />
      </div>
    </div>
  );
}

/** A bill that exists only on screen, for thumbnails and for the "sample" preview of a design. */
export function sampleInvoice(design: InvoiceDesign, invoiceType: Invoice["invoice_type"] = "sale"): Invoice {
  return {
    id: "sample",
    invoice_number: "INV-001",
    customer_id: null,
    party_type: "customer",
    party_id: null,
    invoice_type: invoiceType,
    design,
    customer_name: "Khan",
    customer_phone: "0300 1234567",
    customer_address: null,
    issued_on: new Date().toISOString().slice(0, 10),
    due_date: null,
    discount_type: "amount",
    discount_value: 0,
    tax_rate: 0,
    subtotal: 6000,
    discount_amount: 0,
    tax_amount: 0,
    total: 6000,
    amount_paid: 0,
    payment_method: null,
    status: "unpaid",
    notes: null,
    terms: null,
    created_at: new Date().toISOString(),
    items: [
      {
        product_id: null,
        description: "Urea 50 kg",
        qty: 2,
        unit_price: 3000,
        discount: 0,
        line_total: 6000,
      },
    ],
  };
}

