import { useT } from "@/lib/i18n";
import { formatCurrency } from "@/lib/formatters";
import { displayDate } from "@/components/ui/DateField";
import { isInvoiceOverdue, type Invoice, type InvoiceDesign } from "@/lib/invoices";
import { DEFAULT_INVOICE_SETTINGS, type InvoicePaper, type InvoiceSettings } from "@/lib/invoiceSettings";

export interface ShopIdentity {
  name: string;
  phone: string | null;
  address: string | null;
  logoUrl: string | null;
}

const BRAND = "#84cc16";
const INK = "#0a0a0a";
const PAPER_WIDTH: Record<InvoicePaper, number> = { a4: 720, a5: 430, thermal: 302 };

/* ─── the voices ─────────────────────────────────────────────────────────────────────────── */

interface Preset {
  paper: string;
  ink: string;
  muted: string;
  rule: string;
  accent: string;
  onAccent: string;
  shadow: string;
  header: "plain" | "split" | "centered" | "bar" | "block";
  headerFill?: string;
  onHeader?: string;
  tableFill?: string;
  totals: "rule" | "box" | "bar" | "plain";
  title: "sentence" | "caps" | "large" | "huge";
  topBar?: string;
}

/**
 * The design catalogue: one grid, ten voices.
 *
 * Every sheet below shares the same columns, the same money edge and the same 8px rhythm. A
 * design changes the paper, the header treatment and how the total is framed — never where a
 * number sits, so a shop can change its mind about the look without retraining the person who
 * reads it.
 */
const PRESETS: Record<string, Preset> = {
  atelier: {
    paper: "#ffffff",
    ink: "#111311",
    muted: "#8a8d88",
    rule: "#e4e4e0",
    accent: "#111311",
    onAccent: "#ffffff",
    shadow: "0 1px 3px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.04)",
    header: "plain",
    totals: "rule",
    title: "sentence",
  },
  royal: {
    paper: "#0e0e0d",
    ink: "#f4f4f1",
    muted: "#9a9a94",
    rule: "#2a2a27",
    accent: BRAND,
    onAccent: INK,
    shadow: "0 1px 4px rgba(0,0,0,0.35)",
    header: "split",
    totals: "rule",
    title: "large",
  },
  aurora: {
    paper: "#ffffff",
    ink: "#111311",
    muted: "#8a8d88",
    rule: "#e4e4e0",
    accent: BRAND,
    onAccent: INK,
    shadow: "0 1px 3px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.04)",
    header: "plain",
    tableFill: "rgba(132,204,22,0.14)",
    totals: "rule",
    title: "caps",
    topBar: BRAND,
  },
  classic: {
    paper: "#ffffff",
    ink: "#111311",
    muted: "#7b8079",
    rule: "#dcded8",
    accent: BRAND,
    onAccent: INK,
    shadow: "0 1px 3px rgba(0,0,0,0.08)",
    header: "centered",
    totals: "rule",
    title: "caps",
  },
  modern: {
    paper: "#ffffff",
    ink: "#111311",
    muted: "#6b7069",
    rule: "#e4e4e0",
    accent: BRAND,
    onAccent: INK,
    shadow: "0 1px 3px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.04)",
    header: "bar",
    headerFill: BRAND,
    onHeader: INK,
    tableFill: "rgba(132,204,22,0.14)",
    totals: "box",
    title: "sentence",
  },
  elegant: {
    paper: "#ffffff",
    ink: "#111311",
    muted: "#8a8d88",
    rule: "#e4e4e0",
    accent: BRAND,
    onAccent: INK,
    shadow: "0 1px 3px rgba(0,0,0,0.08)",
    header: "centered",
    totals: "plain",
    title: "caps",
  },
  minimal: {
    paper: "#ffffff",
    ink: "#111111",
    muted: "#9ca3af",
    rule: "#ffffff",
    accent: "#111111",
    onAccent: "#ffffff",
    shadow: "0 1px 2px rgba(0,0,0,0.06)",
    header: "plain",
    totals: "plain",
    title: "sentence",
  },
  corporate: {
    paper: "#ffffff",
    ink: "#111311",
    muted: "#6b7069",
    rule: "#e4e4e0",
    accent: BRAND,
    onAccent: INK,
    shadow: "0 1px 3px rgba(0,0,0,0.10)",
    header: "block",
    headerFill: BRAND,
    onHeader: INK,
    tableFill: "rgba(132,204,22,0.14)",
    totals: "box",
    title: "caps",
  },
  bold: {
    paper: "#ffffff",
    ink: "#0a0a0a",
    muted: "#6b6b6b",
    rule: "#d9d9d9",
    accent: BRAND,
    onAccent: INK,
    shadow: "0 1px 3px rgba(0,0,0,0.12)",
    header: "bar",
    headerFill: BRAND,
    onHeader: INK,
    totals: "bar",
    title: "huge",
  },
};

const label = (preset: Preset, overrides: React.CSSProperties = {}): React.CSSProperties => ({
  margin: 0,
  fontFamily: "inherit",
  fontSize: 9.5,
  fontWeight: 500,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  color: preset.muted,
  ...overrides,
});

/* ─── shared marks ───────────────────────────────────────────────────────────────────────── */

function StatusPill({ invoice, onDark, onBrand }: { invoice: Invoice; onDark?: boolean; onBrand?: boolean }) {
  const t = useT();
  const overdue = isInvoiceOverdue(invoice);
  const text = overdue
    ? t("invoice.paperStatusOverdue")
    : invoice.status === "paid"
      ? t("invoice.paperStatusPaid")
      : invoice.status === "partial"
        ? t("invoice.paperStatusPartial")
        : t("invoice.paperStatusUnpaid");

  // On the green header a tinted pill disappears into the band, so it takes a solid paper ground;
  // the status colour is then stated in the text, at a weight that survives print.
  const tone =
    invoice.status === "paid" && !overdue
      ? { bg: onBrand ? "#ffffff" : "rgba(132,204,22,0.18)", color: onDark ? "#d9f99d" : "#3f6212" }
      : overdue
        ? { bg: onBrand ? "#ffffff" : "rgba(239,68,68,0.16)", color: onDark ? "#f09070" : "#b4472f" }
        : { bg: onBrand ? "#ffffff" : "rgba(245,158,11,0.16)", color: onDark ? "#f2c078" : "#8a5a17" };

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

/* ─── the page: header, bill, lines, money ──────────────────────────────────────────────── */

function PageHeader({
  invoice,
  shop,
  preset,
  settings,
  scale,
}: {
  invoice: Invoice;
  shop: ShopIdentity;
  preset: Preset;
  settings: InvoiceSettings;
  scale: number;
}) {
  const t = useT();
  const v = settings.visible;
  // Only the split header is dark. The bar and block headers are the brand green, which carries
  // black type, so their secondary lines are ink at reduced strength — not white.
  const onDark = preset.header === "split";
  const onBand = preset.header === "bar" || preset.header === "block";
  const mutedOnBand = onDark ? "rgba(255,255,255,0.72)" : onBand ? "rgba(10,10,10,0.62)" : preset.muted;
  const ink = preset.onHeader ?? preset.ink;

  // The mark and the identity are two answers: the logo can print while the name block is off.
  const identity = settings.headerOn || v.logo ? (
    <div style={{ minWidth: 0 }}>
      {v.logo && <Logo shop={shop} size={28 * scale} bg={onDark ? "#ffffff" : INK} color={onDark ? INK : "#ffffff"} />}
      {settings.headerOn && (
        <>
          <p style={{ margin: `${9 * scale}px 0 0`, fontSize: 12 * scale, fontWeight: 600, color: ink }}>
            {shop.name || "—"}
          </p>
          {shop.phone && <p style={{ margin: "1px 0 0", fontSize: 10 * scale, color: mutedOnBand }}>{shop.phone}</p>}
          {shop.address && (
            <p style={{ margin: "2px 0 0", fontSize: 9.5 * scale, lineHeight: 1.45, maxWidth: 200, color: mutedOnBand }}>
              {shop.address}
            </p>
          )}
        </>
      )}
    </div>
  ) : (
    <div />
  );

  const title = (
    <div style={{ textAlign: preset.header === "centered" ? "center" : "end" }}>
      <p
        style={{
          margin: 0,
          fontSize: (preset.title === "huge" ? 40 : preset.title === "large" ? 32 : preset.title === "caps" ? 13 : 24) * scale,
          fontWeight: preset.title === "large" ? 300 : preset.title === "huge" ? 800 : 700,
          letterSpacing: preset.title === "caps" ? 3 : preset.title === "large" ? -1.2 : -0.5,
          textTransform: preset.title === "caps" ? "uppercase" : "none",
          lineHeight: 1.05,
          color: preset.header === "centered" ? preset.ink : ink,
        }}
      >
        {t("invoice.paperInvoice")}
      </p>
      <p style={{ margin: `${5 * scale}px 0 0`, fontSize: 10.5 * scale, color: mutedOnBand, fontVariantNumeric: "tabular-nums" }}>
        {invoice.invoice_number}
      </p>
      <div style={{ marginTop: 7 * scale }}>
        <StatusPill invoice={invoice} onDark={onDark} onBrand={onBand} />
      </div>
    </div>
  );

  if (preset.header === "centered") {
    return (
      <div style={{ textAlign: "center", paddingBottom: 14, borderBottom: `2px solid ${preset.accent}` }}>
        {identity}
        <div style={{ marginTop: 12 }}>{title}</div>
      </div>
    );
  }

  if (preset.header === "split") {
    return (
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 34 * scale, fontWeight: 300, letterSpacing: -1.4, lineHeight: 1, color: ink }}>
            {t("invoice.paperInvoice")}
          </p>
          <p style={{ margin: "8px 0 0", fontSize: 10 * scale, letterSpacing: 1.4, color: mutedOnBand }}>
            {invoice.invoice_number}
          </p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 9 }}>
          {v.logo && (
            <span style={{ background: "#ffffff", borderRadius: 5, padding: 2, display: "inline-flex" }}>
              <Logo shop={shop} size={20 * scale} bg={BRAND} color={INK} />
            </span>
          )}
          <StatusPill invoice={invoice} onDark />
          {settings.headerOn && (
            <p style={{ margin: 0, fontSize: 10 * scale, color: mutedOnBand, textAlign: "end" }}>
              {shop.name || "—"}
            </p>
          )}
        </div>
      </div>
    );
  }

  if (preset.header === "bar" || preset.header === "block") {
    return (
      <div
        style={{
          background: preset.headerFill,
          color: ink,
          padding: `${16 * scale}px ${18 * scale}px`,
          borderRadius: preset.header === "block" ? 6 * scale : 0,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 20,
        }}
      >
        {identity}
        {title}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
      {identity}
      {title}
    </div>
  );
}

function BillAndMeta({
  invoice,
  preset,
  settings,
  scale,
}: {
  invoice: Invoice;
  preset: Preset;
  settings: InvoiceSettings;
  scale: number;
}) {
  const t = useT();
  const v = settings.visible;
  const meta: Array<{ label: string; value: string }> = [];
  if (v.receiptNo) meta.push({ label: t("invoice.paperInvoiceNo"), value: invoice.invoice_number });
  if (v.date) meta.push({ label: t("invoice.paperIssueDate"), value: displayDate(invoice.issued_on) });
  if (v.dueDate) meta.push({ label: t("invoice.paperDueDate"), value: invoice.due_date ? displayDate(invoice.due_date) : "—" });

  const address = [invoice.customer_phone, invoice.customer_address].filter(Boolean);
  const showParty = v.contact || (v.contactNumber && invoice.customer_phone) || (v.location && invoice.customer_address);

  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 24, marginTop: 22 * scale }}>
      <div style={{ minWidth: 0, maxWidth: "54%" }}>
        {showParty && <p style={label(preset, { fontSize: 9 * scale })}>{t("invoice.paperBillTo")}</p>}
        {v.contact && (
          <p style={{ margin: "6px 0 0", fontSize: 12.5 * scale, fontWeight: 600, lineHeight: 1.35, color: preset.ink }}>
            {invoice.customer_name}
          </p>
        )}
        {address.length > 0 && (
          <p style={{ margin: "2px 0 0", fontSize: 10 * scale, lineHeight: 1.55, color: preset.muted }}>
            {v.contactNumber && invoice.customer_phone && <span style={{ display: "block" }}>{invoice.customer_phone}</span>}
            {v.location && invoice.customer_address && <span style={{ display: "block" }}>{invoice.customer_address}</span>}
          </p>
        )}
      </div>

      {meta.length > 0 && (
        <div style={{ flexShrink: 0, minWidth: 150 }}>
          {meta.map((row) => (
            <div key={row.label} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 14, padding: "3px 0" }}>
              <span style={label(preset, { fontSize: 8.5 * scale, whiteSpace: "nowrap" })}>{row.label}</span>
              <span style={{ fontSize: 10.5 * scale, fontWeight: 500, color: preset.ink, fontVariantNumeric: "tabular-nums" }}>{row.value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LineItems({ invoice, preset, scale }: { invoice: Invoice; preset: Preset; scale: number }) {
  const t = useT();
  const items = invoice.items ?? [];
  const fill = preset.tableFill;
  const head: React.CSSProperties = {
    ...label(preset, { fontSize: 8.5 * scale, padding: `${8 * scale}px 0`, fontWeight: 600 }),
    textAlign: "start",
    color: fill ? preset.ink : preset.muted,
  };
  const cell: React.CSSProperties = {
    fontSize: 11 * scale,
    padding: `${9 * scale}px 0`,
    borderBottom: `1px solid ${preset.rule}`,
    verticalAlign: "top",
    color: preset.ink,
  };
  const num: React.CSSProperties = { ...cell, textAlign: "end", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 20 * scale }}>
      <thead>
        <tr style={fill ? { background: fill } : { borderBottom: `1px solid ${preset.rule}` }}>
          <th style={{ ...head, paddingInlineStart: fill ? 8 : 0 }}>{t("invoice.paperDescription")}</th>
          <th style={{ ...head, textAlign: "end", width: 38 }}>{t("invoice.paperQty")}</th>
          <th style={{ ...head, textAlign: "end", width: 74 }}>{t("invoice.paperRate")}</th>
          <th style={{ ...head, textAlign: "end", width: 82, paddingInlineEnd: fill ? 8 : 0 }}>{t("invoice.paperAmount")}</th>
        </tr>
      </thead>
      <tbody>
        {items.map((it, i) => (
          <tr key={it.id ?? i}>
            <td style={{ ...cell, paddingInlineStart: fill ? 8 : 0 }}>
              <span style={{ fontSize: 11.5 * scale, fontWeight: 600 }}>{it.description}</span>
            </td>
            <td style={num}>{it.qty}</td>
            <td style={num}>{formatCurrency(it.unit_price)}</td>
            <td style={{ ...num, fontWeight: 600, paddingInlineEnd: fill ? 8 : 0 }}>{formatCurrency(it.line_total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TotalsBlock({
  invoice,
  preset,
  settings,
  scale,
}: {
  invoice: Invoice;
  preset: Preset;
  settings: InvoiceSettings;
  scale: number;
}) {
  const t = useT();
  const v = settings.visible;
  const due = Math.max(invoice.total - invoice.amount_paid, 0);
  const rows: Array<{ label: string; value: string; strong?: boolean }> = [];
  if (v.subtotal) rows.push({ label: t("invoice.paperSubtotal"), value: formatCurrency(invoice.subtotal) });
  if (v.discount && invoice.discount_amount > 0) rows.push({ label: t("invoice.paperDiscount"), value: `−${formatCurrency(invoice.discount_amount)}` });
  if (v.tax && invoice.tax_amount > 0) {
    rows.push({
      label: `${t("invoice.paperVat")}${invoice.tax_rate ? ` · ${invoice.tax_rate}%` : ""}`,
      value: formatCurrency(invoice.tax_amount),
    });
  }
  if (v.amountPaid && invoice.amount_paid > 0) rows.push({ label: t("invoice.paperPaid"), value: formatCurrency(invoice.amount_paid) });
  if (v.amountPaid && invoice.amount_paid > 0 && due > 0) rows.push({ label: t("invoice.paperBalanceDue"), value: formatCurrency(due), strong: true });

  const line: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: 16,
    fontSize: 11 * scale,
    padding: `${3 * scale}px 0`,
    color: preset.ink,
  };
  const number: React.CSSProperties = { fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", flexShrink: 0 };

  const totalRow = (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 16,
        marginTop: preset.totals === "bar" ? 10 * scale : 8 * scale,
        paddingTop: preset.totals === "rule" ? 9 * scale : 0,
        borderTop: preset.totals === "rule" ? `1.5px solid ${preset.ink}` : undefined,
        background: preset.totals === "bar" ? preset.accent : undefined,
        color: preset.totals === "bar" ? preset.onAccent : undefined,
        padding: preset.totals === "bar" ? `${9 * scale}px ${10 * scale}px` : undefined,
        fontSize: (preset.totals === "bar" ? 17 : 15) * scale,
        fontWeight: 700,
        letterSpacing: -0.2,
      }}
    >
      <span style={{ whiteSpace: "nowrap" }}>{t("invoice.paperTotalDue")}</span>
      <span style={number}>{formatCurrency(invoice.total)}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 * scale }}>
      <div
        style={{
          width: "62%",
          minWidth: 190,
          background: preset.totals === "box" ? preset.tableFill ?? "#f3f5f7" : undefined,
          borderRadius: preset.totals === "box" ? 5 : undefined,
          padding: preset.totals === "box" ? `${11 * scale}px ${12 * scale}px` : undefined,
        }}
      >
        {rows
          .filter((row) => !row.strong)
          .map((row) => (
            <div key={row.label} style={line}>
              <span style={{ color: preset.muted, whiteSpace: "nowrap" }}>{row.label}</span>
              <span style={number}>{row.value}</span>
            </div>
          ))}
        {totalRow}
        {rows
          .filter((row) => row.strong)
          .map((row) => (
            <div key={row.label} style={{ ...line, fontWeight: 600, marginTop: 4 * scale }}>
              <span>{row.label}</span>
              <span style={number}>{row.value}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function PaymentAndSignature({
  invoice,
  preset,
  settings,
  scale,
}: {
  invoice: Invoice;
  preset: Preset;
  settings: InvoiceSettings;
  scale: number;
}) {
  const t = useT();
  const v = settings.visible;
  const due = Math.max(invoice.total - invoice.amount_paid, 0);

  return (
    <>
      {v.paymentAccount && (
        <div style={{ marginTop: 22 * scale, paddingTop: 12 * scale, borderTop: `1px solid ${preset.rule}` }}>
          <p style={label(preset, { fontSize: 8.5 * scale })}>{t("invoice.paperPaymentDetails")}</p>
          <div style={{ display: "flex", gap: 26, marginTop: 7 * scale }}>
            {[
              { k: t("invoice.paperMethod"), val: invoice.payment_method === "bank_transfer" ? t("invoice.bankTransfer") : t("invoice.cash") },
              { k: t("invoice.paperAmountPaid"), val: formatCurrency(invoice.amount_paid) },
              { k: t("invoice.paperBalanceDue"), val: formatCurrency(due) },
            ].map((row) => (
              <div key={row.k} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 8.5 * scale, color: preset.muted }}>{row.k}</span>
                <span style={{ fontSize: 10.5 * scale, color: preset.ink, fontVariantNumeric: "tabular-nums" }}>{row.val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {v.signature && (
        <div style={{ marginTop: 30 * scale, display: "flex", justifyContent: "flex-end" }}>
          <div style={{ textAlign: "center", minWidth: 150 }}>
            <div style={{ borderTop: `1px solid ${preset.ink}`, height: 1 }} />
            <p style={{ margin: "5px 0 0", fontSize: 8.5 * scale, color: preset.muted, letterSpacing: 0.8, textTransform: "uppercase" }}>
              {t("invoice.paperSignature")}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function SheetNotes({
  invoice,
  preset,
  settings,
  scale,
}: {
  invoice: Invoice;
  preset: Preset;
  settings: InvoiceSettings;
  scale: number;
}) {
  const t = useT();
  if (!settings.visible.notes || (!invoice.notes && !invoice.terms)) return null;
  return (
    <p style={{ margin: "18px 0 0", fontSize: 9.5 * scale, lineHeight: 1.6, color: preset.muted, maxWidth: 330 }}>
      {[invoice.notes, invoice.terms].filter(Boolean).join(" · ")}
    </p>
  );
}

function SheetFooter({
  preset,
  settings,
  scale,
}: {
  preset: Preset;
  settings: InvoiceSettings;
  scale: number;
}) {
  const t = useT();
  return (
    <div style={{ marginTop: 24 * scale }}>
      {settings.footerNote ? (
        <p style={{ margin: "0 0 10px", fontSize: 9.5 * scale, lineHeight: 1.55, color: preset.muted, textAlign: "center" }}>
          {settings.footerNote}
        </p>
      ) : (
        <p style={{ margin: "0 0 10px", fontSize: 9.5 * scale, lineHeight: 1.55, color: preset.muted, textAlign: "center" }}>
          {t("invoice.paperThanks")}
        </p>
      )}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: 16,
          paddingTop: 9 * scale,
          borderTop: preset.rule === "#ffffff" ? "none" : `1px solid ${preset.rule}`,
          fontSize: 8.5 * scale,
          color: preset.muted,
        }}
      >
        <span>{t("invoice.paperAllAmounts")}</span>
        <span>{t("invoice.paperPage")}</span>
      </div>
    </div>
  );
}

function PageSheet({
  invoice,
  shop,
  design,
  paper,
  settings,
}: {
  invoice: Invoice;
  shop: ShopIdentity;
  design: InvoiceDesign;
  paper: InvoicePaper;
  settings: InvoiceSettings;
}) {
  const preset = (PRESETS[design] ?? PRESETS.atelier) as Preset;
  const a5 = paper === "a5";
  const scale = a5 ? 0.9 : 1;
  const width = PAPER_WIDTH[paper === "thermal" ? "a5" : paper];

  return (
    <div
      className="invoice-sheet"
      style={{
        background: preset.paper,
        color: preset.ink,
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        borderRadius: 6,
        boxShadow: preset.shadow,
        direction: "ltr",
        width: "100%",
        maxWidth: width,
        margin: "0 auto",
        overflow: "hidden",
      }}
    >
      {preset.topBar && <div style={{ height: 4, background: preset.topBar }} />}
      <div style={{ padding: a5 ? "26px 24px 22px" : "34px 32px 26px" }}>
        <PageHeader invoice={invoice} shop={shop} preset={preset} settings={settings} scale={scale} />

        {settings.headerNote && (
          <p style={{ margin: "14px 0 0", fontSize: 9.5 * scale, lineHeight: 1.55, color: preset.muted }}>{settings.headerNote}</p>
        )}

        <BillAndMeta invoice={invoice} preset={preset} settings={settings} scale={scale} />
        <LineItems invoice={invoice} preset={preset} scale={scale} />
        <TotalsBlock invoice={invoice} preset={preset} settings={settings} scale={scale} />
        <PaymentAndSignature invoice={invoice} preset={preset} settings={settings} scale={scale} />
        <SheetNotes invoice={invoice} preset={preset} settings={settings} scale={scale} />
        <SheetFooter preset={preset} settings={settings} scale={scale} />
      </div>
    </div>
  );
}

/* ─── the 80 mm receipt ─────────────────────────────────────────────────────────────────── */

function ThermalSheet({
  invoice,
  shop,
  design,
  settings,
}: {
  invoice: Invoice;
  shop: ShopIdentity;
  design: InvoiceDesign;
  settings: InvoiceSettings;
}) {
  const t = useT();
  const v = settings.visible;
  const bold = design === "receipt-bold";
  const bordered = design === "receipt-bordered";
  const compact = design === "receipt-compact";
  const due = Math.max(invoice.total - invoice.amount_paid, 0);
  const gap = compact ? 5 : 8;
  const rule = bordered || !compact;

  return (
    <div
      className="invoice-sheet invoice-sheet--thermal"
      style={{
        width: "100%",
        maxWidth: PAPER_WIDTH.thermal,
        margin: "0 auto",
        background: "#ffffff",
        color: "#0a0a0a",
        border: bordered ? "1.5px solid #0a0a0a" : "none",
        borderTop: bold ? `12px solid ${BRAND}` : undefined,
        padding: compact ? "12px 12px 14px" : "18px 16px 20px",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
        direction: "ltr",
      }}
    >
      <div style={{ textAlign: "center" }}>
        {v.logo && (
          <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>
            <Logo shop={shop} size={30} bg={BRAND} color={INK} />
          </div>
        )}
        {settings.headerOn && (
          <>
            <p style={{ margin: 0, fontSize: bold ? 16 : 14, fontWeight: 800, letterSpacing: -0.2 }}>{shop.name || "—"}</p>
            {shop.phone && <p style={{ margin: "1px 0 0", fontSize: 9 }}>{shop.phone}</p>}
            {shop.address && <p style={{ margin: "1px 0 0", fontSize: 9, lineHeight: 1.4 }}>{shop.address}</p>}
          </>
        )}
        <p
          style={{
            margin: `${gap + 3}px 0 0`,
            fontSize: 10,
            letterSpacing: bold ? 1.5 : 0.8,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          {t("invoice.paperInvoice")}
        </p>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 9.5 }}>
          {v.receiptNo && <span>{invoice.invoice_number}</span>}
          {v.date && <span>{displayDate(invoice.issued_on)}</span>}
        </div>
        {v.dueDate && invoice.due_date && (
          <p style={{ margin: "2px 0 0", fontSize: 9, textAlign: "start" }}>
            {t("invoice.paperDueDate")}: {displayDate(invoice.due_date)}
          </p>
        )}
      </div>

      {settings.headerNote && (
        <p style={{ margin: `${gap}px 0 0`, fontSize: 8.5, lineHeight: 1.45, textAlign: "center" }}>{settings.headerNote}</p>
      )}

      <div style={{ borderTop: `${rule ? "1px dashed #0a0a0a" : "1px solid #e5e5e5"}`, marginTop: gap, paddingTop: gap }} />

      {v.contact && (
        <div style={{ fontSize: 9.5, marginBottom: gap }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontWeight: 700 }}>
            <span>{t("invoice.paperBillTo")}</span>
            <span>{invoice.customer_name}</span>
          </div>
          {v.contactNumber && invoice.customer_phone && (
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
              <span>{t("invoice.paperPhone")}</span>
              <span>{invoice.customer_phone}</span>
            </div>
          )}
          {v.location && invoice.customer_address && <p style={{ margin: "1px 0 0", textAlign: "end" }}>{invoice.customer_address}</p>}
        </div>
      )}

      <div style={{ borderTop: rule ? "1px dashed #0a0a0a" : undefined, paddingTop: gap }}>
        {(invoice.items ?? []).map((it, i) => (
          <div key={it.id ?? i} style={{ marginBottom: compact ? 4 : 6 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 10 }}>
              <span style={{ fontWeight: 600, minWidth: 0, overflowWrap: "anywhere" }}>{it.description}</span>
              <span style={{ fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>{formatCurrency(it.line_total)}</span>
            </div>
            <p style={{ margin: "1px 0 0", fontSize: 8.5, color: "#555" }}>
              {it.qty} × {formatCurrency(it.unit_price)}
            </p>
          </div>
        ))}
      </div>

      <div style={{ borderTop: rule ? "1px dashed #0a0a0a" : "1px solid #e5e5e5", marginTop: gap, paddingTop: gap }}>
        {[
          v.subtotal ? { k: t("invoice.paperSubtotal"), val: formatCurrency(invoice.subtotal) } : null,
          v.discount && invoice.discount_amount > 0 ? { k: t("invoice.paperDiscount"), val: `−${formatCurrency(invoice.discount_amount)}` } : null,
          v.tax && invoice.tax_amount > 0 ? { k: t("invoice.paperTax"), val: formatCurrency(invoice.tax_amount) } : null,
        ]
          .filter((row): row is { k: string; val: string } => Boolean(row))
          .map((row) => (
            <div key={row.k} style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, padding: "1px 0" }}>
              <span style={{ color: "#555" }}>{row.k}</span>
              <span style={{ fontVariantNumeric: "tabular-nums" }}>{row.val}</span>
            </div>
          ))}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: bold ? 16 : 14,
            fontWeight: 800,
            marginTop: gap,
            padding: bold ? "6px 8px" : undefined,
            background: bold ? BRAND : undefined,
            color: INK,
          }}
        >
          <span>{t("invoice.paperTotalDue")}</span>
          <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(invoice.total)}</span>
        </div>

        {v.amountPaid && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9.5, marginTop: 4 }}>
            <span style={{ color: "#555" }}>{t("invoice.paperAmountPaid")}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(invoice.amount_paid)}</span>
          </div>
        )}
        {v.amountPaid && due > 0 && (
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, fontWeight: 700 }}>
            <span>{t("invoice.paperBalanceDue")}</span>
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatCurrency(due)}</span>
          </div>
        )}
        {v.paymentAccount && (
          <p style={{ margin: "4px 0 0", fontSize: 9, color: "#555" }}>
            {t("invoice.paperMethod")}: {invoice.payment_method === "bank_transfer" ? t("invoice.bankTransfer") : t("invoice.cash")}
          </p>
        )}
      </div>

      {v.signature && (
        <div style={{ marginTop: 22, textAlign: "center" }}>
          <div style={{ borderTop: "1px solid #0a0a0a", width: 130, margin: "0 auto" }} />
          <p style={{ margin: "3px 0 0", fontSize: 8, letterSpacing: 0.6, textTransform: "uppercase", color: "#555" }}>
            {t("invoice.paperSignature")}
          </p>
        </div>
      )}

      {v.notes && (invoice.notes || invoice.terms) && (
        <p style={{ margin: `${gap}px 0 0`, fontSize: 8.5, lineHeight: 1.45, textAlign: "center" }}>
          {[invoice.notes, invoice.terms].filter(Boolean).join(" · ")}
        </p>
      )}

      {/* One closing line. A custom footer replaces the stock thank-you rather than stacking a
          second one directly under it. */}
      <div style={{ marginTop: gap + 4, textAlign: "center", fontSize: 8.5 }}>
        {settings.footerNote ? (
          <p style={{ margin: 0, lineHeight: 1.45 }}>{settings.footerNote}</p>
        ) : (
          <p style={{ margin: 0, color: "#555" }}>{t("invoice.paperThanks")}</p>
        )}
      </div>
    </div>
  );
}

/* ─── the public component ─────────────────────────────────────────────────────────────── */

function isThermalDesign(design: InvoiceDesign): boolean {
  return design.startsWith("receipt-");
}

/**
 * The paper.
 *
 * One grid, many voices. The design decides the header treatment and the paper; the settings
 * decide what is allowed to print — header, notes and each field the shop turned off. Because
 * this component is the preview, the design card and the printed page, a change in settings
 * cannot show one thing and print another.
 */
export default function InvoiceSheet({
  invoice,
  shop,
  design,
  paper,
  settings,
}: {
  invoice: Invoice;
  shop: ShopIdentity;
  design?: InvoiceDesign;
  paper?: InvoicePaper;
  settings?: InvoiceSettings;
}) {
  const resolvedSettings = settings ?? { ...DEFAULT_INVOICE_SETTINGS, visible: { ...DEFAULT_INVOICE_SETTINGS.visible } };
  const resolvedDesign = design ?? resolvedSettings.design;
  const resolvedPaper = paper ?? resolvedSettings.paper;

  if (resolvedPaper === "thermal" || isThermalDesign(resolvedDesign)) {
    const thermalDesign = isThermalDesign(resolvedDesign) ? resolvedDesign : "receipt-simple";
    return <ThermalSheet invoice={invoice} shop={shop} design={thermalDesign} settings={resolvedSettings} />;
  }

  return (
    <PageSheet
      invoice={invoice}
      shop={shop}
      design={resolvedDesign}
      paper={resolvedPaper}
      settings={resolvedSettings}
    />
  );
}

/** A design card's thumbnail: the real sheet at a fraction of its width, clipped to the card. */
export function InvoiceDesignThumb({
  design,
  sample,
  shop,
  width = 52,
  height = 66,
  paper,
  settings,
}: {
  design: InvoiceDesign;
  sample: Invoice;
  shop: ShopIdentity;
  width?: number;
  height?: number;
  paper?: InvoicePaper;
  settings?: InvoiceSettings;
}) {
  const resolvedPaper = paper ?? (isThermalDesign(design) ? "thermal" : "a4");
  const inner = resolvedPaper === "thermal" ? PAPER_WIDTH.thermal : 360;
  const scale = width / inner;
  const background = isThermalDesign(design) ? "#ffffff" : PRESETS[design]?.paper ?? "#ffffff";

  return (
    <div
      aria-hidden
      style={{
        width,
        height,
        overflow: "hidden",
        borderRadius: 4,
        border: "1px solid var(--divider)",
        background,
        flexShrink: 0,
        position: "relative",
      }}
    >
      <div style={{ width: inner, transform: `scale(${scale})`, transformOrigin: "top left", pointerEvents: "none" }}>
        <InvoiceSheet invoice={sample} shop={shop} design={design} paper={resolvedPaper} settings={settings} />
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
    customer_address: "Main Bazaar, Lahore",
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
    payment_method: "cash",
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
