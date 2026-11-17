import { Fragment } from "react";
import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/formatters";
import { displayDate } from "@/components/ui/DateField";
import { isInvoiceOverdue, type Invoice, type InvoiceDesign } from "@/lib/invoices";

export interface ShopIdentity {
  name: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
}

const BRAND = "#84cc16";
const INK = "#0a0a0a";

/**
 * The paper.
 *
 * One grid, three voices. The grid is the reference's, not the app's mobile one: a 32px page
 * margin, one left edge and one right edge for every number, an 8px vertical rhythm inside blocks
 * and 26–30px between them. Nothing is centred that the reference left-aligns, and every figure in
 * the money column ends on the same pixel.
 *
 * Type is Inter — the product's single typeface — at the sizes the reference uses: a 26–34px title,
 * 9.5px letterspaced caps for labels, 12px for what was supplied, 11px for money, 20px for the total.
 *
 * The three designs differ in paper and emphasis, never in alignment:
 *   · Atelier — white, sentence-case title, the quietest of the three.
 *   · Royal   — near-black, oversized wordmark, the editorial page.
 *   · Aurora  — white with the app's lime as the only colour, brand-first.
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

/* ─── the grid ─────────────────────────────────────────────────────────────────────────── */

interface Theme {
  paper: string;
  ink: string;
  muted: string;
  rule: string;
  accent: string;
  onAccent: string;
  shadow: string;
}

const LIGHT: Theme = {
  paper: "#ffffff",
  ink: "#111311",
  muted: "#8a8d88",
  rule: "#e4e4e0",
  accent: "#111311",
  onAccent: "#ffffff",
  shadow: "0 1px 3px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.04)",
};

const label = (theme: Theme, overrides: React.CSSProperties = {}): React.CSSProperties => ({
  margin: 0,
  fontFamily: "inherit",
  fontSize: 9.5,
  fontWeight: 500,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  color: theme.muted,
  ...overrides,
});

function StatusPill({
  invoice,
  theme,
  filled,
  onDark,
}: {
  invoice: Invoice;
  theme: Theme;
  filled?: boolean;
  /** The dark paper needs lighter warning ink; the same amber vanishes on near-black. */
  onDark?: boolean;
}) {
  const t = useT();
  const overdue = isInvoiceOverdue(invoice);
  const text = overdue
    ? t("invoice.paperStatusOverdue")
    : invoice.status === "paid"
      ? t("invoice.paperStatusPaid")
      : invoice.status === "partial"
        ? t("invoice.paperStatusPartial")
        : t("invoice.paperStatusUnpaid");

  // Only a settled bill takes the solid fill; "partly paid" and "overdue" must not read as success.
  const solid = filled && invoice.status === "paid" && !overdue;
  const tone =
    invoice.status === "paid" && !overdue
      ? { bg: solid ? theme.accent : "rgba(132,204,22,0.16)", color: solid ? theme.onAccent : "#3f6212" }
      : overdue
        ? { bg: solid ? theme.accent : "rgba(239,68,68,0.16)", color: solid ? theme.onAccent : onDark ? "#f09070" : "#b4472f" }
        : {
            bg: solid ? theme.accent : "rgba(245,158,11,0.16)",
            color: solid ? theme.onAccent : onDark ? "#f2c078" : "#8a5a17",
          };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        height: 20,
        padding: "0 8px",
        borderRadius: 999,
        background: tone.bg,
        color: tone.color,
        fontSize: 9.5,
        fontWeight: 600,
        letterSpacing: 0.6,
        textTransform: "uppercase",
        whiteSpace: "nowrap",
      }}
    >
      {text}
    </span>
  );
}

function Logo({ shop, size, bg, color }: { shop: ShopIdentity; size: number; bg: string; color: string }) {
  if (shop.logoUrl) {
    return (
      <img
        src={shop.logoUrl}
        alt={shop.name}
        style={{ width: size, height: size, objectFit: "cover", borderRadius: size > 30 ? 8 : 4, flexShrink: 0 }}
      />
    );
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size > 30 ? 8 : 4,
        background: bg,
        color,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.42,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {shop.name.charAt(0).toUpperCase() || "S"}
    </div>
  );
}

/** BILLED TO on the left, INVOICE NO. / ISSUE DATE / DUE DATE on the right — both on the grid. */
function MetaRow({ invoice, theme }: { invoice: Invoice; theme: Theme }) {
  const t = useT();
  const value: React.CSSProperties = { fontSize: 11, fontWeight: 500, color: theme.ink, fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 24 }}>
      <div style={{ minWidth: 0, maxWidth: "54%" }}>
        <p style={label(theme)}>{t("invoice.paperBillTo")}</p>
        <p style={{ margin: "7px 0 0", fontSize: 12.5, fontWeight: 600, lineHeight: 1.35 }}>{invoice.customer_name}</p>
        {(invoice.customer_phone || invoice.customer_address) && (
          <p style={{ margin: "3px 0 0", fontSize: 10.5, lineHeight: 1.55, color: theme.muted }}>
            {[invoice.customer_phone, invoice.customer_address].filter(Boolean).join("\n").split("\n").map((line, i) => (
              <span key={i} style={{ display: "block" }}>
                {line}
              </span>
            ))}
          </p>
        )}
      </div>

      <div style={{ flexShrink: 0, minWidth: 150 }}>
        <TableMeta label={t("invoice.paperInvoiceNo")} value={invoice.invoice_number} theme={theme} valueStyle={value} />
        <TableMeta label={t("invoice.paperIssueDate")} value={displayDate(invoice.issued_on)} theme={theme} valueStyle={value} />
        <TableMeta
          label={t("invoice.paperDueDate")}
          value={invoice.due_date ? displayDate(invoice.due_date) : "—"}
          theme={theme}
          valueStyle={value}
        />
      </div>
    </div>
  );
}

function TableMeta({
  label: text,
  value,
  theme,
  valueStyle,
}: {
  label: string;
  value: string;
  theme: Theme;
  valueStyle: React.CSSProperties;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 14,
        padding: "3px 0",
      }}
    >
      <span style={{ ...label(theme), fontSize: 9, whiteSpace: "nowrap" }}>{text}</span>
      <span style={valueStyle}>{value}</span>
    </div>
  );
}

function LineItems({
  invoice,
  theme,
  headerFill,
  subLine,
}: {
  invoice: Invoice;
  theme: Theme;
  headerFill?: string;
  subLine?: boolean;
}) {
  const t = useT();
  const items = invoice.items ?? [];
  const head: React.CSSProperties = {
    ...label(theme, { fontSize: 9, color: headerFill ? theme.onAccent : theme.muted }),
    textAlign: "left",
    padding: "10px 0",
    fontWeight: 500,
  };
  const cell: React.CSSProperties = {
    fontSize: 11.5,
    padding: "11px 0",
    borderBottom: `1px solid ${theme.rule}`,
    verticalAlign: "top",
  };
  const num: React.CSSProperties = { ...cell, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

  return (
    <table style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr
          style={
            headerFill
              ? { background: headerFill }
              : { borderBottom: `1px solid ${theme.rule}` }
          }
        >
          <th style={{ ...head, paddingInlineStart: headerFill ? 10 : 0 }}>{t("invoice.paperDescription")}</th>
          <th style={{ ...head, textAlign: "right", width: 38 }}>{t("invoice.paperQty")}</th>
          <th style={{ ...head, textAlign: "right", width: 74 }}>{t("invoice.paperRate")}</th>
          <th style={{ ...head, textAlign: "right", width: 82, paddingInlineEnd: headerFill ? 10 : 0 }}>
            {t("invoice.paperAmount")}
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={it.id ?? i}>
            <td style={{ ...cell, paddingInlineStart: headerFill ? 10 : 0 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{it.description}</span>
              {subLine && (
                <span style={{ display: "block", marginTop: 2, fontSize: 10.5, color: theme.muted }}>
                  {it.qty} × {formatCurrency(it.unit_price)}
                </span>
              )}
            </td>
            <td style={num}>{it.qty}</td>
            <td style={num}>{formatCurrency(it.unit_price)}</td>
            <td style={{ ...num, fontWeight: 500, paddingInlineEnd: headerFill ? 10 : 0 }}>{formatCurrency(it.line_total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Subtotal, discount, tax, then the total — every figure on the right edge, nothing boxed. */
function Totals({ invoice, theme, big, size = 18 }: { invoice: Invoice; theme: Theme; big?: boolean; size?: number }) {
  const t = useT();
  const line: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 16,
    fontSize: 11,
    padding: "3px 0",
    color: theme.ink,
  };
  const muted: React.CSSProperties = { color: theme.muted, whiteSpace: "nowrap" };
  const number: React.CSSProperties = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 };
  const due = Math.max(invoice.total - invoice.amount_paid, 0);

  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
      <div style={{ width: "62%", minWidth: 190 }}>
        <div style={line}>
          <span style={muted}>{t("invoice.paperSubtotal")}</span>
          <span style={number}>{formatCurrency(invoice.subtotal)}</span>
        </div>
        {invoice.discount_amount > 0 && (
          <div style={line}>
            <span style={muted}>{t("invoice.paperDiscount")}</span>
            <span style={number}>−{formatCurrency(invoice.discount_amount)}</span>
          </div>
        )}
        {invoice.tax_amount > 0 && (
          <div style={line}>
            <span style={muted}>
              {t("invoice.paperVat")}
              {invoice.tax_rate ? ` · ${invoice.tax_rate}%` : ""}
            </span>
            <span style={number}>{formatCurrency(invoice.tax_amount)}</span>
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 16,
            marginTop: 8,
            paddingTop: 9,
            borderTop: `1px solid ${theme.ink}`,
            fontSize: big ? size : 13,
            fontWeight: 600,
            letterSpacing: big ? -0.3 : 0,
          }}
        >
          <span style={{ whiteSpace: "nowrap" }}>{t("invoice.paperTotalDue")}</span>
          <span style={number}>{formatCurrency(invoice.total)}</span>
        </div>
        {invoice.amount_paid > 0 && (
          <div style={{ ...line, marginTop: 7 }}>
            <span style={muted}>{t("invoice.paperPaid")}</span>
            <span style={number}>{formatCurrency(invoice.amount_paid)}</span>
          </div>
        )}
        {invoice.amount_paid > 0 && due > 0 && (
          <div style={{ ...line, fontWeight: 600 }}>
            <span>{t("invoice.paperBalanceDue")}</span>
            <span style={number}>{formatCurrency(due)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/** PAYMENT DETAILS: the four facts the app actually holds. */
function PaymentDetails({ invoice, theme, split }: { invoice: Invoice; theme: Theme; split?: boolean }) {
  const t = useT();
  const due = Math.max(invoice.total - invoice.amount_paid, 0);
  // One grid for the whole block — labels in their own fixed columns, values in the next — so a
  // value sits directly after its label and still lines up with the value above it. Per-pair
  // grids looked right only until one label was wider than the fixed width and pushed its value
  // to the far edge.
  const key: React.CSSProperties = { color: theme.muted, whiteSpace: "nowrap" };
  const value: React.CSSProperties = { color: theme.ink, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
  // `max-content` for the value track: an `auto` track would stretch and throw the value to the
  // far edge of the page, which is exactly the ragged gap this block used to have.
  const grid: React.CSSProperties = { display: "grid", gridTemplateColumns: "84px max-content", columnGap: 10, rowGap: 2 };

  const render = (subset: typeof rows) =>
    subset.map((row) => (
      <Fragment key={row.k}>
        <span style={{ ...key, fontSize: 10.5 }}>{row.k}</span>
        <span style={{ ...value, fontSize: 10.5 }}>{row.v}</span>
      </Fragment>
    ));

  const rows = [
    {
      k: t("invoice.paperMethod"),
      v: invoice.payment_method === "bank_transfer" ? t("invoice.bankTransfer") : t("invoice.cash"),
    },
    { k: t("invoice.paperAmountPaid"), v: formatCurrency(invoice.amount_paid) },
    { k: t("invoice.paperBalanceDue"), v: formatCurrency(due) },
    { k: t("invoice.paperDueDate"), v: invoice.due_date ? displayDate(invoice.due_date) : "—" },
  ];

  return (
    <div style={{ marginTop: 26, paddingTop: 14, borderTop: `1px solid ${theme.rule}` }}>
      <p style={label(theme)}>{t("invoice.paperPaymentDetails")}</p>
      {split ? (
        <div style={{ display: "flex", gap: 26, marginTop: 8 }}>
          <div style={grid}>{render(rows.slice(0, 2))}</div>
          <div style={grid}>{render(rows.slice(2))}</div>
        </div>
      ) : (
        <div style={{ ...grid, marginTop: 8 }}>{render(rows)}</div>
      )}
    </div>
  );
}

function PaperFooter({ invoice, theme }: { invoice: Invoice; theme: Theme }) {
  const t = useT();
  return (
    <div style={{ marginTop: 30 }}>
      {(invoice.notes || invoice.terms) && (
        <p style={{ margin: "0 0 10px", fontSize: 10, lineHeight: 1.6, color: theme.muted, maxWidth: 300 }}>
          {[invoice.notes, invoice.terms].filter(Boolean).join(" · ")}
        </p>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 16,
          paddingTop: 9,
          borderTop: `1px solid ${theme.rule}`,
          fontSize: 9,
          color: theme.muted,
        }}
      >
        <span>
          {t("invoice.paperThanks")} · {t("invoice.paperAllAmounts")}
        </span>
        <span>{t("invoice.paperPage")}</span>
      </div>
    </div>
  );
}

/* ─── Atelier: white, sentence-case title, quiet ─────────────────────────────────────────── */

function Atelier({ invoice, shop }: { invoice: Invoice; shop: ShopIdentity }) {
  const t = useT();
  const theme = LIGHT;

  return (
    <div
      className="invoice-sheet"
      style={{
        background: theme.paper,
        color: theme.ink,
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        padding: "34px 32px 26px",
        borderRadius: 6,
        boxShadow: theme.shadow,
        direction: "ltr",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: -0.6, lineHeight: 1.1 }}>
            {t("invoice.paperInvoiceTitle")}
          </p>
          {/* The mark sits on its own line so the shop's name starts on the page's left edge with
              everything else. An inline logo indented the name by its own width, and the address
              underneath then began at a second left edge. */}
          <div style={{ marginTop: 12 }}>
            <Logo shop={shop} size={26} bg={INK} color="#ffffff" />
            <p style={{ margin: "9px 0 0", fontSize: 11, fontWeight: 600 }}>{shop.name || "—"}</p>
            <p style={{ margin: "1px 0 0", fontSize: 10, color: theme.muted }}>{shop.phone ?? ""}</p>
          </div>
          {shop.address && (
            <p style={{ margin: "6px 0 0", fontSize: 10, lineHeight: 1.55, color: theme.muted, maxWidth: 190 }}>
              {shop.address}
            </p>
          )}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, paddingTop: 3 }}>
          <p style={label(theme, { letterSpacing: 1.8 })}>{t("invoice.paperInvoice")}</p>
          <div style={{ marginTop: 10 }}>
            <StatusPill invoice={invoice} theme={theme} />
          </div>
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <MetaRow invoice={invoice} theme={theme} />
      </div>

      <div style={{ marginTop: 26 }}>
        <LineItems invoice={invoice} theme={theme} />
      </div>

      <Totals invoice={invoice} theme={theme} big />
      <PaymentDetails invoice={invoice} theme={theme} split />
      <PaperFooter invoice={invoice} theme={theme} />
    </div>
  );
}

/* ─── Royal: near-black, oversized wordmark, editorial ──────────────────────────────────── */

function Royal({ invoice, shop }: { invoice: Invoice; shop: ShopIdentity }) {
  const t = useT();
  const theme: Theme = {
    paper: "#0e0e0d",
    ink: "#f4f4f1",
    muted: "#9a9a94",
    rule: "#2a2a27",
    accent: BRAND,
    onAccent: INK,
    shadow: "0 1px 4px rgba(0,0,0,0.35)",
  };

  return (
    <div
      className="invoice-sheet"
      style={{
        background: theme.paper,
        color: theme.ink,
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        padding: "34px 32px 26px",
        borderRadius: 6,
        boxShadow: theme.shadow,
        direction: "ltr",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
        <div>
          <p style={{ margin: 0, fontSize: 34, fontWeight: 300, letterSpacing: -1.4, lineHeight: 1 }}>
            {t("invoice.paperInvoice")}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 10, letterSpacing: 1.4, color: theme.muted }}>{invoice.invoice_number}</p>
        </div>
        <div style={{ textAlign: "right", paddingTop: 3, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 9 }}>
          {/* A light plate, because a logo drawn for white paper is a dark square on this page. */}
          <span style={{ background: "#ffffff", borderRadius: 5, padding: 2, display: "inline-flex" }}>
            <Logo shop={shop} size={20} bg={BRAND} color={INK} />
          </span>
          <StatusPill invoice={invoice} theme={theme} filled onDark />
        </div>
      </div>

      <div style={{ height: 1, background: theme.rule, margin: "22px 0 0" }} />

      {/* Two registers: the customer billed, the shop billing. */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 28, marginTop: 20 }}>
        <div style={{ minWidth: 0 }}>
          <p style={label(theme)}>{t("invoice.paperBillTo")}</p>
          <p style={{ margin: "7px 0 0", fontSize: 12.5, fontWeight: 600 }}>{invoice.customer_name}</p>
          {invoice.customer_phone && (
            <p style={{ margin: "3px 0 0", fontSize: 10.5, color: theme.muted }}>{invoice.customer_phone}</p>
          )}
          {invoice.customer_address && (
            <p style={{ margin: "1px 0 0", fontSize: 10.5, lineHeight: 1.55, color: theme.muted }}>
              {invoice.customer_address}
            </p>
          )}
        </div>
        <div style={{ minWidth: 0 }}>
          <p style={label(theme)}>{t("invoice.paperFrom")}</p>
          <p style={{ margin: "7px 0 0", fontSize: 12, fontWeight: 600 }}>{shop.name || "—"}</p>
          {shop.phone && <p style={{ margin: "2px 0 0", fontSize: 10.5, color: theme.muted }}>{shop.phone}</p>}
          {shop.address && (
            <p style={{ margin: "1px 0 0", fontSize: 10.5, lineHeight: 1.55, color: theme.muted }}>{shop.address}</p>
          )}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          gap: 28,
          marginTop: 18,
          paddingTop: 12,
          borderTop: `1px solid ${theme.rule}`,
          fontSize: 10.5,
          color: theme.muted,
        }}
      >
        <span>
          {t("invoice.paperIssueDate")}{" "}
          <span style={{ color: theme.ink, fontWeight: 500 }}>{displayDate(invoice.issued_on)}</span>
        </span>
        <span>
          {t("invoice.paperDueDate")}{" "}
          <span style={{ color: theme.ink, fontWeight: 500 }}>
            {invoice.due_date ? displayDate(invoice.due_date) : "—"}
          </span>
        </span>
      </div>

      <div style={{ marginTop: 24 }}>
        <LineItems invoice={invoice} theme={theme} subLine />
      </div>

      <Totals invoice={invoice} theme={theme} big size={22} />
      <PaymentDetails invoice={invoice} theme={theme} split />
      <PaperFooter invoice={invoice} theme={theme} />
    </div>
  );
}

/* ─── Aurora: white with the app's lime, brand-first ────────────────────────────────────── */

function Aurora({ invoice, shop }: { invoice: Invoice; shop: ShopIdentity }) {
  const t = useT();
  const theme: Theme = { ...LIGHT, accent: BRAND, onAccent: INK };
  const due = Math.max(invoice.total - invoice.amount_paid, 0);

  return (
    <div
      className="invoice-sheet"
      style={{
        background: theme.paper,
        color: theme.ink,
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        borderRadius: 6,
        boxShadow: theme.shadow,
        overflow: "hidden",
        direction: "ltr",
      }}
    >
      <div style={{ height: 4, background: BRAND }} />

      <div style={{ padding: "30px 32px 26px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
          <div style={{ minWidth: 0 }}>
            <Logo shop={shop} size={30} bg={INK} color={BRAND} />
            <p style={{ margin: "8px 0 0", fontSize: 12.5, fontWeight: 600 }}>{shop.name || "—"}</p>
            <p style={{ margin: "1px 0 0", fontSize: 10, color: theme.muted, lineHeight: 1.5 }}>
              {[shop.phone, shop.address].filter(Boolean).join(" · ")}
            </p>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <p style={label(theme, { letterSpacing: 1.8 })}>{t("invoice.paperInvoice")}</p>
            <p style={{ margin: "6px 0 0", fontSize: 18, fontWeight: 600, letterSpacing: -0.4 }}>{invoice.invoice_number}</p>
            <div style={{ marginTop: 8 }}>
              <StatusPill invoice={invoice} theme={theme} />
            </div>
          </div>
        </div>

        {/* The one number the paper exists for, in the accent. */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            gap: 24,
            marginTop: 22,
            paddingBottom: 14,
            borderBottom: `2px solid ${BRAND}`,
          }}
        >
          {/* A settled bill has nothing left to pay: the headline number is the total, labelled as
              such, instead of a large "balance due: Rs. 0". */}
          <span style={label(theme, { color: "#4d6b12", fontSize: 9.5 })}>
            {due > 0 ? t("invoice.paperBalanceDue") : t("invoice.paperTotalDue")}
          </span>
          <span style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.8, fontVariantNumeric: "tabular-nums" }}>
            {formatCurrency(due > 0 ? due : invoice.total)}
          </span>
        </div>

        <div style={{ marginTop: 22 }}>
          <MetaRow invoice={invoice} theme={theme} />
        </div>

        <div style={{ marginTop: 24 }}>
          <LineItems invoice={invoice} theme={theme} headerFill="rgba(132,204,22,0.14)" />
        </div>

        <Totals invoice={invoice} theme={theme} big />
        <PaymentDetails invoice={invoice} theme={theme} split />
        <PaperFooter invoice={invoice} theme={theme} />
      </div>
    </div>
  );
}

/**
 * A design card's thumbnail: the real sheet at 36% scale, clipped to the card's height. Because it
 * renders the same component, a card cannot show a design the print screen no longer has.
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
        borderRadius: 4,
        border: "1px solid var(--divider)",
        background: design === "royal" ? "#0e0e0d" : "#ffffff",
        flexShrink: 0,
        position: "relative",
      }}
    >
      <div style={{ width: inner, transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }}>
        <InvoiceSheet invoice={sample} shop={shop} design={design} />
      </div>
    </div>
  );
}

/** A bill that exists only on screen, for a design nothing has been typed into yet. */
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
