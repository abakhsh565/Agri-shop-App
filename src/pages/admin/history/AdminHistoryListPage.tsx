import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Download, History as HistoryIcon, RotateCw, Share2 } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import EmptyState from "@/components/ui/EmptyState";
import OverflowMenu from "@/components/ui/OverflowMenu";
import Sheet from "@/components/ui/Sheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/lib/tenantContext";
import { useUIStore } from "@/stores/uiStore";

type Translate = (key: I18nKey, params?: Record<string, string>) => string;

export type HistoryKind =
  | "sales"
  | "invoices"
  | "purchases"
  | "returns"
  | "customer-payments"
  | "supplier-payments"
  | "money"
  | "stock";

interface KindInfo {
  labelKey: I18nKey;
  permission: Parameters<typeof hasPermission>[0];
}

export const HISTORY_KINDS: Record<HistoryKind, KindInfo> = {
  sales: { labelKey: "history.sales", permission: "sales.view" },
  invoices: { labelKey: "history.invoices", permission: "sales.view" },
  purchases: { labelKey: "history.purchases", permission: "purchases.view" },
  returns: { labelKey: "history.returns", permission: "sales.view" },
  "customer-payments": { labelKey: "history.customerPayments", permission: "payments.view" },
  "supplier-payments": { labelKey: "history.supplierPayments", permission: "purchases.view" },
  money: { labelKey: "history.money", permission: "payments.view" },
  stock: { labelKey: "history.stock", permission: "products.view" },
};

type PeriodId = "1d" | "1w" | "1m" | "3m" | "1y" | "custom";

const PERIODS: Array<{ id: PeriodId; labelKey: I18nKey }> = [
  { id: "1d", labelKey: "history.period1d" },
  { id: "1w", labelKey: "history.period1w" },
  { id: "1m", labelKey: "history.period1m" },
  { id: "3m", labelKey: "history.period3m" },
  { id: "1y", labelKey: "history.period1y" },
  { id: "custom", labelKey: "history.custom" },
];

const PERIOD_DAYS: Record<Exclude<PeriodId, "custom">, number> = {
  "1d": 0,
  "1w": 6,
  "1m": 29,
  "3m": 89,
  "1y": 364,
};

interface TxDetailRow {
  label: string;
  value: string;
}

interface Tx {
  id: string;
  title: string;
  meta: string;
  sub?: string;
  amount: number | null;
  /** A quantity shown instead of money (stock movements). */
  quantity?: string;
  status?: { label: string; tone: "paid" | "due" | "returned" };
  /** A screen that owns this record. When absent the card opens the detail sheet. */
  to?: string;
  detail: TxDetailRow[];
}

const PAID = { bg: "rgba(132,204,22,0.16)", color: "var(--brand-dark)" };
const DUE = { bg: "var(--warning-bg)", color: "var(--warning)" };
const RETURNED = { bg: "var(--surface-3, var(--muted))", color: "var(--text-secondary)" };

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** PostgREST returns an embedded row as an object (or an array when it cannot prove one). */
function related(row: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = row[key];
  if (Array.isArray(value)) return (value[0] as Record<string, unknown>) ?? null;
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function isoDay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return isoDay(date);
}

function statusPill(
  status: string,
  due: number,
  paid: number,
  t: Translate,
): Tx["status"] | undefined {
  if (status === "paid" || (Number.isFinite(due) && due <= 0 && paid > 0)) {
    return { label: t("invoice.statusPaid"), tone: "paid" };
  }
  if (status === "partial" || paid > 0) return { label: t("invoice.statusPartial"), tone: "due" };
  if (status === "unpaid" || due > 0) return { label: t("invoice.statusUnpaid"), tone: "due" };
  return undefined;
}

/**
 * One ledger for one window.
 *
 * Each branch reads the table that owns that ledger and returns the same card shape, so the
 * screen below draws one kind of card whatever was chosen. The detail rows travel with the card:
 * for a record with its own screen they are not used, and for the three records that have none
 * (a receipt, a money entry, a stock adjustment) they are what the detail sheet shows.
 */
async function loadTransactions(
  kind: HistoryKind,
  from: string,
  to: string,
  base: string,
  t: Translate,
): Promise<Tx[]> {
  const start = `${from}T00:00:00`;
  const end = `${to}T23:59:59.999`;
  const when = formatDateTime;

  if (kind === "sales") {
    const { data } = await supabase
      .from("sales")
      .select("id,sale_number,customer_name_snapshot,total_amount,amount_paid,amount_due,status,created_at,employee_name,is_voided")
      .eq("is_voided", false)
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    return ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const title = text(row.customer_name_snapshot) || t("history.walkIn");
      const total = money(row.total_amount);
      const paid = money(row.amount_paid);
      const due = money(row.amount_due);
      const employee = text(row.employee_name);
      return {
        id: text(row.id),
        title,
        meta: when(text(row.created_at)),
        sub: employee ? `${t("history.soldBy")}: ${employee}` : undefined,
        amount: total,
        status: statusPill(text(row.status), due, paid, t),
        to: `${base}/sales/${text(row.id)}`,
        detail: [
          { label: t("history.customer"), value: title },
          { label: t("history.date"), value: when(text(row.created_at)) },
          { label: t("invoice.total"), value: formatCurrency(total) },
          { label: t("invoice.amountPaid"), value: formatCurrency(paid) },
          { label: t("invoice.balanceDue"), value: formatCurrency(due) },
        ],
      };
    });
  }

  if (kind === "invoices") {
    const { data } = await supabase
      .from("invoices")
      .select("id,invoice_number,customer_name,total,amount_paid,status,created_at")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    return ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const total = money(row.total);
      const paid = money(row.amount_paid);
      return {
        id: text(row.id),
        title: text(row.customer_name) || t("history.walkIn"),
        meta: when(text(row.created_at)),
        sub: text(row.invoice_number),
        amount: total,
        status: statusPill(text(row.status), total - paid, paid, t),
        to: `${base}/invoices/${text(row.id)}`,
        detail: [
          { label: t("invoice.number"), value: text(row.invoice_number) },
          { label: t("history.date"), value: when(text(row.created_at)) },
          { label: t("invoice.total"), value: formatCurrency(total) },
        ],
      };
    });
  }

  if (kind === "purchases") {
    const { data } = await supabase
      .from("purchases")
      .select("id,purchase_number,company_name,total_amount,amount_paid,amount_due,status,created_at")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    return ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const total = money(row.total_amount);
      const paid = money(row.amount_paid);
      const due = money(row.amount_due);
      return {
        id: text(row.id),
        title: text(row.company_name) || t("history.supplier"),
        meta: when(text(row.created_at)),
        sub: text(row.purchase_number),
        amount: total,
        status: statusPill(text(row.status), due, paid, t),
        to: `${base}/purchases/${text(row.id)}`,
        detail: [
          { label: t("history.supplier"), value: text(row.company_name) },
          { label: t("history.date"), value: when(text(row.created_at)) },
          { label: t("invoice.total"), value: formatCurrency(total) },
        ],
      };
    });
  }

  if (kind === "returns") {
    const { data } = await supabase
      .from("returns")
      .select("id,return_number,customer_name,total_refund,refund_amount,created_at,sale_id,status")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    return ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const refund = money(row.total_refund) || money(row.refund_amount);
      const saleId = text(row.sale_id);
      return {
        id: text(row.id),
        title: text(row.customer_name) || t("history.walkIn"),
        meta: when(text(row.created_at)),
        sub: text(row.return_number),
        amount: refund,
        status: { label: t("history.returned"), tone: "returned" },
        to: saleId ? `${base}/sales/${saleId}` : undefined,
        detail: [
          { label: t("history.customer"), value: text(row.customer_name) },
          { label: t("history.date"), value: when(text(row.created_at)) },
          { label: t("history.refund"), value: formatCurrency(refund) },
        ],
      };
    });
  }

  if (kind === "customer-payments") {
    const { data } = await supabase
      .from("customer_payments")
      .select("id,customer_id,amount,method,notes,created_at,recorded_by_name,customers(name)")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    return ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const customer = related(row, "customers");
      const title = text(customer?.name) || t("history.customer");
      const amount = money(row.amount);
      return {
        id: text(row.id),
        title,
        meta: when(text(row.created_at)),
        sub: text(row.recorded_by_name),
        amount,
        detail: [
          { label: t("history.customer"), value: title },
          { label: t("history.date"), value: when(text(row.created_at)) },
          { label: t("history.amount"), value: formatCurrency(amount) },
          { label: t("history.method"), value: text(row.method) },
          { label: t("history.recordedBy"), value: text(row.recorded_by_name) },
          { label: t("history.notes"), value: text(row.notes) },
        ].filter((detail) => detail.value),
      };
    });
  }

  if (kind === "supplier-payments") {
    const { data } = await supabase
      .from("supplier_payments")
      .select("id,company_id,amount,method,notes,created_at,recorded_by_name,companies(name)")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    return ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const company = related(row, "companies");
      const title = text(company?.name) || t("history.supplier");
      const amount = money(row.amount);
      return {
        id: text(row.id),
        title,
        meta: when(text(row.created_at)),
        sub: text(row.recorded_by_name),
        amount,
        to: `${base}/purchases/payments/${text(row.id)}`,
        detail: [
          { label: t("history.supplier"), value: title },
          { label: t("history.date"), value: when(text(row.created_at)) },
          { label: t("history.amount"), value: formatCurrency(amount) },
        ],
      };
    });
  }

  if (kind === "money") {
    const { data } = await supabase
      .from("payments")
      .select("id,customer_id,amount,method,notes,created_at,recorded_by_name,customers(name)")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    return ((data ?? []) as Record<string, unknown>[]).map((row) => {
      const customer = related(row, "customers");
      const amount = money(row.amount);
      const title = text(row.notes) || text(customer?.name) || t("history.money");
      return {
        id: text(row.id),
        title,
        meta: when(text(row.created_at)),
        sub: text(row.recorded_by_name),
        amount,
        detail: [
          { label: t("history.date"), value: when(text(row.created_at)) },
          { label: t("history.amount"), value: formatCurrency(amount) },
          { label: t("history.method"), value: text(row.method) },
          { label: t("history.customer"), value: text(customer?.name) },
          { label: t("history.recordedBy"), value: text(row.recorded_by_name) },
          { label: t("history.notes"), value: text(row.notes) },
        ].filter((detail) => detail.value),
      };
    });
  }

  const { data } = await supabase
    .from("stock_adjustments")
    .select("id,product_name,variant_name,adjustment_type,qty_change,qty_before,qty_after,reason,adjusted_by,created_at")
    .gte("created_at", start)
    .lte("created_at", end)
    .order("created_at", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((row) => {
    const change = money(row.qty_change);
    const product = text(row.product_name) || text(row.variant_name) || t("history.stock");
    return {
      id: text(row.id),
      title: product,
      meta: when(text(row.created_at)),
      sub: [text(row.adjustment_type), text(row.adjusted_by)].filter(Boolean).join(" · "),
      amount: null,
      quantity: `${change > 0 ? "+" : ""}${change}`,
      detail: [
        { label: t("history.stock"), value: product },
        { label: t("history.date"), value: when(text(row.created_at)) },
        { label: t("history.adjustment"), value: text(row.adjustment_type) },
        { label: t("history.qtyBefore"), value: String(money(row.qty_before)) },
        { label: t("history.qtyAfter"), value: String(money(row.qty_after)) },
        { label: t("history.recordedBy"), value: text(row.adjusted_by) },
        { label: t("history.notes"), value: text(row.reason) },
      ].filter((detail) => detail.value),
    };
  });
}

/**
 * One history ledger.
 *
 * The date range is the first thing on the screen and the only thing above the cards, because it
 * is what the screen is: the same book, read for a day, a week or a year. Each card is the record
 * the owner recognises — who, when, who served it, what it was worth, and whether it is settled —
 * and opening it goes to that record's own screen where one exists.
 */
export default function AdminHistoryListPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const { kind: rawKind } = useParams<{ kind: string }>();
  const { addToast } = useUIStore();

  const kind = (rawKind && rawKind in HISTORY_KINDS ? rawKind : "sales") as HistoryKind;
  const info = HISTORY_KINDS[kind];
  const today = pkToday();

  const [period, setPeriod] = useState<PeriodId>("1m");
  const [customFrom, setCustomFrom] = useState(today);
  const [customTo, setCustomTo] = useState(today);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [transactions, setTransactions] = useState<Tx[] | null>(null);
  const [nonce, setNonce] = useState(0);
  const [selected, setSelected] = useState<Tx | null>(null);

  const from = period === "custom" ? customFrom : daysAgo(PERIOD_DAYS[period]);
  const to = period === "custom" ? customTo : today;

  const allowed = hasPermission(info.permission);

  // The translator is not a dependency: `useT` hands back a new function each render, so reading
  // it through a ref keeps the fetch keyed to the ledger and the days rather than to the render.
  const translate = useRef(t);
  translate.current = t;

  const load = useCallback(async () => {
    if (!allowed) return;
    setTransactions(null);
    try {
      const rows = await loadTransactions(kind, from, to, base, translate.current);
      setTransactions(rows);
    } catch {
      // A failed read is an empty ledger on this screen, not a spinner that never resolves.
      setTransactions([]);
    }
  }, [allowed, kind, from, to, base]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  const summaryText = useMemo(() => {
    const lines = (transactions ?? []).slice(0, 40).map((tx) => {
      const value = tx.amount != null ? formatCurrency(tx.amount) : tx.quantity ?? "";
      return [tx.title, tx.meta, value].filter(Boolean).join(" · ");
    });
    return [`${t(info.labelKey)} · ${from} – ${to}`, ...lines].join("\n");
  }, [transactions, from, to, info.labelKey, t]);

  async function share() {
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: t(info.labelKey), text: summaryText });
        return;
      }
      await navigator.clipboard.writeText(summaryText);
      addToast(t("history.shared"), "success");
    } catch {
      // A dismissed share sheet is not a failure.
    }
  }

  function exportCsv() {
    const header = [t("history.colType"), t("history.date"), t("history.colTotal")].join(",");
    const lines = (transactions ?? []).map((tx) =>
      [`"${tx.title.replace(/"/g, '""')}"`, `"${tx.meta}"`, tx.amount != null ? String(tx.amount) : `"${tx.quantity ?? ""}"`].join(","),
    );
    const blob = new Blob([`\uFEFF${[header, ...lines].join("\n")}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `history-${kind}-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function shareOne(tx: Tx) {
    const body = [
      tx.title,
      tx.meta,
      tx.sub,
      tx.amount != null ? formatCurrency(tx.amount) : tx.quantity,
      ...tx.detail.map((detail) => `${detail.label}: ${detail.value}`),
    ]
      .filter(Boolean)
      .join("\n");
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ title: tx.title, text: body });
        return;
      }
      await navigator.clipboard.writeText(body);
      addToast(t("history.shared"), "success");
    } catch {
      // Dismissed.
    }
  }

  function open(tx: Tx) {
    if (tx.to) navigate(tx.to);
    else setSelected(tx);
  }

  if (!allowed) {
    return (
      <div className="flex flex-col bg-background w-full min-h-full">
        <StatusBar />
        <NavHeader title={t(info.labelKey)} />
        <EmptyState icon={HistoryIcon} title={t("history.nothing")} />
      </div>
    );
  }

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)" }} data-testid={`history-list-${kind}`}>
      <StatusBar />
      <NavHeader
        title={t(info.labelKey)}
        right={
          <OverflowMenu
            testId="history-list-actions"
            title={t(info.labelKey)}
            actions={[
              { icon: RotateCw, label: t("history.refresh"), onClick: () => setNonce((n) => n + 1), testId: "history-refresh" },
              { icon: Share2, label: t("history.share"), onClick: () => void share(), testId: "history-share" },
              { icon: Download, label: t("history.export"), onClick: exportCsv, testId: "history-export" },
            ]}
          />
        }
      />

      {/* The range, as the reference's tabs: one row, the active period underlined. */}
      <div className="px-4" data-testid="history-periods">
        <div className="flex items-stretch justify-between" style={{ borderBottom: "1px solid var(--divider)" }}>
          {PERIODS.map((option) => {
            const active = period === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => {
                  if (option.id === "custom") setRangeOpen(true);
                  else setPeriod(option.id);
                }}
                aria-pressed={active}
                className="relative flex-1 h-11 text-13 font-semibold"
                style={{ color: active ? "var(--text-primary)" : "var(--text-secondary)" }}
                data-testid={`history-period-${option.id}`}
              >
                {t(option.labelKey)}
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 bottom-0 h-[2px] rounded-full"
                    style={{ background: "var(--text-primary)" }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Custom is the one period that needs a decision, so it asks in the sheet the app already
          uses for a date range instead of parking two fields under the tabs every day. */}
      <DateRangeSheet
        open={rangeOpen}
        from={customFrom}
        to={customTo}
        max={today}
        onClose={() => setRangeOpen(false)}
        onApply={(nextFrom, nextTo) => {
          setCustomFrom(nextFrom);
          setCustomTo(nextTo);
          setPeriod("custom");
          setRangeOpen(false);
        }}
        onClear={() => {
          setRangeOpen(false);
          setPeriod("1m");
        }}
      />

      {transactions === null ? (
        <SkeletonList rows={5} />
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title={t("history.nothing")}
          subtitle={t("history.emptyBody")}
        />
      ) : (
        <div className="px-4 pt-3 pb-8 flex flex-col gap-2" data-testid="history-cards">
          {transactions.map((tx) => {
            const tone =
              tx.status?.tone === "paid" ? PAID : tx.status?.tone === "returned" ? RETURNED : DUE;
            const initial = tx.title.charAt(0).toUpperCase();
            return (
              <button
                key={tx.id}
                type="button"
                onClick={() => open(tx)}
                data-testid={`history-card-${tx.id}`}
                className="w-full rounded-[var(--radius-card)] p-3 flex items-start gap-3 text-start ds-pressable"
                style={{ background: "var(--surface-2)" }}
              >
                <span
                  className="size-10 shrink-0 rounded-full flex items-center justify-center text-14 font-bold"
                  style={{ background: "var(--surface)", color: "var(--text-primary)" }}
                >
                  {initial}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-14 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {tx.title}
                  </p>
                  <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>{tx.meta}</p>
                  {tx.sub && (
                    <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-tertiary)" }}>{tx.sub}</p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <p className="text-14 font-bold tabular-nums" style={{ color: "var(--text-primary)" }}>
                    {tx.amount != null ? formatCurrency(tx.amount) : tx.quantity}
                  </p>
                  {tx.status && (
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-full text-10 font-bold uppercase"
                      style={{ background: tone.bg, color: tone.color }}
                    >
                      {tx.status.label}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Sheet open={Boolean(selected)} title={selected?.title ?? t(info.labelKey)} onClose={() => setSelected(null)}>
        <div className="px-4 pb-6" data-testid="history-detail-sheet">
          {selected && (
            <>
              <ListCard>
                {selected.detail.map((row) => (
                  <ListRow key={row.label} title={row.label} description={row.value} />
                ))}
              </ListCard>
              <Button variant="outline" size="md" fullWidth className="mt-3" onClick={() => void shareOne(selected)}>
                {t("history.shareRecord")}
              </Button>
            </>
          )}
        </div>
      </Sheet>
    </div>
  );
}
