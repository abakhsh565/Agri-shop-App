import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Check, MessageCircle, Pencil, Printer } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { displayDate } from "@/components/ui/DateField";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { whatsappShareUrl } from "@/lib/appInvite";
import {
  getInvoice,
  invoiceStatusKey,
  isInvoiceOverdue,
  setInvoicePayment,
  type Invoice,
} from "@/lib/invoices";

const STATUS_TONE: Record<string, { bg: string; color: string }> = {
  unpaid: { bg: "var(--warning-bg)", color: "var(--warning)" },
  partial: { bg: "var(--warning-bg)", color: "var(--warning)" },
  paid: { bg: "rgba(132,204,22,0.14)", color: "var(--brand-dark)" },
};

/**
 * One invoice, as the shop keeps it.
 *
 * The reminder is the reason this page is different from a printed bill: the date it is due, what is
 * still on it, and one tap to send that sentence to the customer on WhatsApp — the same message a
 * shopkeeper would type by hand, with the number in it so the reply has something to quote.
 */
export default function InvoiceDetailPage() {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();

  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!invoiceId) return;
    let alive = true;
    getInvoice(invoiceId)
      .then((inv) => {
        if (alive) setInvoice(inv);
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      alive = false;
    };
  }, [invoiceId]);

  async function settle(amount: number) {
    if (!invoice) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await setInvoicePayment(invoice.id, amount, invoice.payment_method ?? undefined);
      setInvoice((prev) => (prev ? { ...prev, ...updated, items: prev.items } : updated));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (error && !invoice) {
    return (
      <div className="flex flex-col bg-background w-full min-h-full">
        <StatusBar />
        <NavHeader title={t("invoice.title")} />
        <p className="px-4 pt-4 text-13" style={{ color: "var(--error)" }}>{error}</p>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="flex flex-col bg-background w-full min-h-full">
        <StatusBar />
        <NavHeader title={t("invoice.title")} />
        <SkeletonList rows={4} />
      </div>
    );
  }

  const due = Math.max(invoice.total - invoice.amount_paid, 0);
  const overdue = isInvoiceOverdue(invoice);
  const tone = STATUS_TONE[invoice.status] ?? STATUS_TONE.unpaid;
  const reminder = [
    `${t("invoice.reminderGreeting")} ${invoice.customer_name},`,
    `${invoice.invoice_number} · ${formatCurrency(invoice.total)}`,
    due > 0
      ? `${t("invoice.balanceDue")}: ${formatCurrency(due)}${invoice.due_date ? ` · ${t("invoice.dueWas")} ${displayDate(invoice.due_date)}` : ""}`
      : t("invoice.alreadyCleared"),
  ].join("\n");

  return (
    <div className="flex flex-col bg-background w-full min-h-full pb-8">
      <StatusBar />
      <NavHeader title={invoice.invoice_number} />

      {/* The bill's own identity, then what the customer is. */}
      <div className="px-4 pt-1">
        <ListCard>
          <ListRow
            tile={
              <div
                className="size-10 rounded-full flex items-center justify-center text-14 font-bold shrink-0"
                style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
              >
                {invoice.customer_name.charAt(0).toUpperCase()}
              </div>
            }
            title={invoice.customer_name}
            meta={[invoice.customer_phone, invoice.customer_address].filter(Boolean).join(" · ") || undefined}
            trailing={
              <span
                className="inline-flex items-center px-2 py-0.5 rounded-full text-10 font-bold whitespace-nowrap"
                style={{ background: tone.bg, color: tone.color }}
              >
                {overdue ? t("invoice.overdue") : t(invoiceStatusKey(invoice.status))}
              </span>
            }
            onClick={invoice.customer_id ? () => navigate(`${base}/customers/${invoice.customer_id}`) : undefined}
          />
        </ListCard>
      </div>

      <div className="px-4 pt-3 flex flex-col gap-1">
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>
          {t("invoice.date")}: <span style={{ color: "var(--text-primary)" }}>{formatDate(invoice.issued_on)}</span>
        </p>
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>
          {t("invoice.dueDate")}:{" "}
          <span style={{ color: overdue ? "var(--warning)" : "var(--text-primary)" }}>
            {invoice.due_date ? displayDate(invoice.due_date) : t("invoice.noDueDate")}
          </span>
        </p>
      </div>

      {/* Lines */}
      <div className="px-4 pt-4">
        <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{t("invoice.items")}</p>
        <div className="rounded-[var(--radius-card)] p-3 flex flex-col gap-3" style={{ background: "var(--surface-2)" }}>
          {(invoice.items ?? []).map((item, i) => (
            <div key={item.id ?? i} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-13 font-medium truncate" style={{ color: "var(--text-primary)" }}>{item.description}</p>
                <p className="text-11 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                  {item.qty} × {formatCurrency(item.unit_price)}
                  {item.discount > 0 ? ` · -${formatCurrency(item.discount)}` : ""}
                </p>
              </div>
              <p className="text-13 tabular-nums shrink-0" style={{ color: "var(--text-primary)" }}>
                {formatCurrency(item.line_total)}
              </p>
            </div>
          ))}
          {(invoice.items ?? []).length === 0 && (
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("invoice.noItems")}</p>
          )}

          <div className="flex flex-col gap-1.5 pt-3" style={{ borderTop: "1px solid var(--divider)" }}>
            <Row label={t("invoice.subtotal")} value={formatCurrency(invoice.subtotal)} muted />
            {invoice.discount_amount > 0 && (
              <Row label={t("invoice.discount")} value={`-${formatCurrency(invoice.discount_amount)}`} muted />
            )}
            {invoice.tax_amount > 0 && <Row label={t("invoice.tax")} value={formatCurrency(invoice.tax_amount)} muted />}
            <Row label={t("invoice.total")} value={formatCurrency(invoice.total)} strong />
            <Row label={t("invoice.amountPaid")} value={formatCurrency(invoice.amount_paid)} muted />
            {due > 0 && <Row label={t("invoice.balanceDue")} value={formatCurrency(due)} tone="var(--warning)" strong />}
          </div>
        </div>
      </div>

      {invoice.notes && (
        <div className="px-4 pt-4">
          <p className="ds-section-label mb-1" style={{ color: "var(--text-secondary)" }}>{t("invoice.notes")}</p>
          <p className="text-13" style={{ color: "var(--text-primary)" }}>{invoice.notes}</p>
        </div>
      )}
      {invoice.terms && (
        <div className="px-4 pt-4">
          <p className="ds-section-label mb-1" style={{ color: "var(--text-secondary)" }}>{t("invoice.terms")}</p>
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>{invoice.terms}</p>
        </div>
      )}

      {/* The reminder: one sentence to the customer, with the number in it. */}
      {due > 0 && (
        <div className="px-4 pt-4">
          <div className="rounded-[var(--radius-card)] p-4 flex flex-col gap-3" style={{ background: "var(--surface-2)" }}>
            <div className="flex items-start gap-2">
              <MessageCircle size={16} className="mt-0.5" style={{ color: "var(--brand-dark)" }} />
              <div>
                <p className="text-13 font-semibold" style={{ color: "var(--text-primary)" }}>{t("invoice.reminderTitle")}</p>
                <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  {overdue
                    ? t("invoice.reminderOverdue").replace("{days}", String(daysPast(new Date(), invoice.due_date)))
                    : t("invoice.reminderBody")}
                </p>
              </div>
            </div>
            {invoice.customer_phone ? (
              <Button
                variant="outline"
                size="md"
                fullWidth
                onClick={() => window.open(whatsappShareUrl(invoice.customer_phone ?? "", reminder), "_blank")}
              >
                <span className="flex items-center justify-center gap-2">
                  <MessageCircle size={15} /> {t("invoice.sendReminder")}
                </span>
              </Button>
            ) : (
              <p className="text-11" style={{ color: "var(--text-tertiary)" }}>{t("invoice.noPhoneForReminder")}</p>
            )}
          </div>
        </div>
      )}

      <div className="px-4 pt-5 flex flex-col gap-2">
        {due > 0 ? (
          <Button variant="cta" size="lg" fullWidth loading={busy} onClick={() => settle(invoice.total)}>
            <span className="flex items-center justify-center gap-2">
              <Check size={16} /> {t("invoice.markFullyPaid")}
            </span>
          </Button>
        ) : (
          <Button variant="outline" size="lg" fullWidth loading={busy} onClick={() => settle(0)}>
            {t("invoice.markUnpaid")}
          </Button>
        )}
        <div className="flex gap-2">
          <Button variant="outline" size="md" fullWidth onClick={() => navigate(`${base}/invoices/${invoice.id}/print`)}>
            <span className="flex items-center justify-center gap-2">
              <Printer size={15} /> {t("invoice.preview")}
            </span>
          </Button>
          <Button variant="outline" size="md" fullWidth onClick={() => navigate(`${base}/invoices/${invoice.id}/edit`)}>
            <span className="flex items-center justify-center gap-2">
              <Pencil size={15} /> {t("invoice.edit")}
            </span>
          </Button>
        </div>
        <p className="text-11 text-center" style={{ color: "var(--text-tertiary)" }}>
          {t("invoice.issuedBy")}
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  muted,
  strong,
  tone,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-12" style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span
        className={`tabular-nums ${strong ? "text-15 font-bold" : "text-13"}`}
        style={{ color: tone ?? (muted ? "var(--text-secondary)" : "var(--text-primary)") }}
      >
        {value}
      </span>
    </div>
  );
}

function daysPast(today: Date, iso: string | null): number {
  if (!iso) return 0;
  const due = new Date(`${iso}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.max(0, Math.round((start.getTime() - due.getTime()) / 86_400_000));
}

