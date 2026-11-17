import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, ReceiptText } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import { SkeletonList } from "@/components/ui/Skeleton";
import { formatCurrency, formatDate } from "@/lib/formatters";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import SegmentedTabs from "@/components/ui/SegmentedTabs";
import {
  invoiceStatusKey,
  invoiceSummary,
  isInvoiceOverdue,
  listInvoices,
  type Invoice,
} from "@/lib/invoices";

type Filter = "all" | "unpaid" | "paid";

const STATUS_TONE: Record<string, { bg: string; color: string }> = {
  unpaid: { bg: "var(--warning-bg)", color: "var(--warning)" },
  partial: { bg: "var(--warning-bg)", color: "var(--warning)" },
  paid: { bg: "rgba(132,204,22,0.14)", color: "var(--brand-dark)" },
};

/**
 * The shop's invoice book.
 *
 * Reads top-down the way a shopkeeper asks the question: how much is still owed to me, and how much
 * has this paperwork collected. The list under it is the paperwork itself, filtered by the one
 * thing anybody filters a bill book by — paid or not.
 */
export default function InvoiceListPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const t = useT();

  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listInvoices()
      .then((rows) => {
        if (alive) setInvoices(rows);
      })
      .catch((e: unknown) => {
        if (alive) {
          setInvoices([]);
          setError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const rows = invoices ?? [];
  const summary = invoiceSummary(rows);
  const visible =
    filter === "all" ? rows : rows.filter((inv) => (filter === "paid" ? inv.status === "paid" : inv.status !== "paid"));

  return (
    <div className="flex flex-col bg-background w-full min-h-full">
      <StatusBar />
      <NavHeader title={t("invoice.title")} />

      <div className="px-4 pt-1 pb-3">
        <Button variant="cta" size="md" fullWidth onClick={() => navigate(`${base}/invoices/new`)}>
          <span className="flex items-center justify-center gap-2">
            <Plus size={16} />
            {t("invoice.new")}
          </span>
        </Button>
      </div>

      {/* What the paperwork is worth, before the paperwork itself. */}
      <div className="px-4 pb-4">
        <div
          className="rounded-[var(--radius-card)] p-4 grid grid-cols-2 gap-3"
          style={{ background: "var(--surface-2)" }}
        >
          <div>
            <p className="text-11 font-medium flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
              <span className="size-1.5 rounded-full inline-block" style={{ background: "var(--warning)" }} />
              {t("invoice.unpaid")}
            </p>
            <p className="text-20 font-bold tabular-nums mt-1" style={{ color: "var(--text-primary)" }} data-testid="invoice-unpaid-total">
              {formatCurrency(summary.unpaid)}
            </p>
          </div>
          <div>
            <p className="text-11 font-medium flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
              <span className="size-1.5 rounded-full inline-block" style={{ background: "var(--brand)" }} />
              {t("invoice.collected")}
            </p>
            <p className="text-20 font-bold tabular-nums mt-1" style={{ color: "var(--text-primary)" }} data-testid="invoice-collected-total">
              {formatCurrency(summary.collected)}
            </p>
          </div>
        </div>
      </div>

      {/* The one control a bill book needs: which bills. Same segmented control as the Action Center. */}
      <div className="px-4 pb-3">
        <SegmentedTabs
          value={filter}
          onChange={setFilter}
          items={[
            { key: "all" as Filter, label: t("invoice.filterAll") },
            { key: "unpaid" as Filter, label: t("invoice.unpaid") },
            { key: "paid" as Filter, label: t("invoice.statusPaid") },
          ]}
        />
      </div>

      {error && (
        <p className="px-4 pb-3 text-12" style={{ color: "var(--error)" }}>
          {error}
        </p>
      )}

      {invoices === null && <SkeletonList rows={4} />}

      {invoices !== null && visible.length === 0 && (
        <div className="px-4 pt-6">
          <div
            className="rounded-[var(--radius-card)] p-6 flex flex-col items-center text-center gap-2"
            style={{ background: "var(--surface-2)" }}
          >
            <div className="size-11 rounded-full flex items-center justify-center" style={{ background: "var(--surface-3, var(--muted))" }}>
              <ReceiptText size={20} style={{ color: "var(--text-secondary)" }} />
            </div>
            <p className="text-14 font-semibold" style={{ color: "var(--text-primary)" }}>
              {filter === "all" ? t("invoice.emptyTitle") : t("invoice.emptyFiltered")}
            </p>
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>
              {t("invoice.emptyHint")}
            </p>
          </div>
        </div>
      )}

      {visible.length > 0 && (
        <div className="pb-6">
          {/* The card keeps the page's 16px gutter. Full-bleed, its rounded edge was cut by the
              screen and its figures sat 6px from the border while the tabs above were inset — the
              one list on the page that did not line up with anything. */}
          <ListCard className="mx-4">
            {visible.map((inv) => {
              const overdue = isInvoiceOverdue(inv);
              const due = Math.max(inv.total - inv.amount_paid, 0);
              const tone = STATUS_TONE[inv.status] ?? STATUS_TONE.unpaid;
              return (
                <ListRow
                  key={inv.id}
                  onClick={() => navigate(`${base}/invoices/${inv.id}`)}
                  tile={
                    <div
                      className="size-10 rounded-full flex items-center justify-center text-13 font-bold shrink-0"
                      style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                    >
                      {inv.customer_name.charAt(0).toUpperCase()}
                    </div>
                  }
                  title={`${inv.invoice_number} · ${inv.customer_name}`}
                  meta={`${formatDate(inv.issued_on)} · ${formatCurrency(inv.total)}`}
                  trailing={
                    <div className="flex flex-col items-end gap-1">
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-full text-10 font-bold whitespace-nowrap"
                        style={{ background: tone.bg, color: tone.color }}
                      >
                        {overdue ? t("invoice.overdue") : t(invoiceStatusKey(inv.status))}
                      </span>
                      {due > 0 && (
                        <span className="text-11 tabular-nums" style={{ color: "var(--text-secondary)" }}>
                          {formatCurrency(due)}
                        </span>
                      )}
                    </div>
                  }
                />
              );
            })}
          </ListCard>
        </div>
      )}
    </div>
  );
}
