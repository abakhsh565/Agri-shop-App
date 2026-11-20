import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Download, History as HistoryIcon, RotateCw, Search, Share2 } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import Button from "@/components/ui/Button";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import EmptyState from "@/components/ui/EmptyState";
import Photo from "@/components/ui/Photo";
import SearchBar from "@/components/ui/SearchBar";
import OverflowMenu from "@/components/ui/OverflowMenu";
import Sheet from "@/components/ui/Sheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";
import { useT, type I18nKey } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useDir } from "@/lib/dirContext";
import { supabase } from "@/lib/supabase";
import { matchesSearch } from "@/lib/searchText";
import { getCachedData, setCachedData } from "@/lib/localCache";
import { hasPermission } from "@/lib/tenantContext";
import { useUIStore } from "@/stores/uiStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";

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
  // A calendar day is local to the shop. Sending `2026-11-20T00:00:00` without an offset is read
  // as UTC by the database, which moved a bill created at 12:41 am out of its own day; converting
  // the local day to an instant is what makes "Today" mean the shopkeeper's today.
  const start = new Date(`${from}T00:00:00`).toISOString();
  const end = new Date(`${to}T23:59:59.999`).toISOString();
  const when = formatDateTime;

  if (kind === "sales") {
    const { data, error } = await supabase
      .from("sales")
      .select("id,sale_number,customer_name_snapshot,total_amount,amount_paid,amount_due,status,created_at,employee_name,is_voided")
      .eq("is_voided", false)
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    // A failed read must reach the caller as a failure: `(data ?? [])` alone turns "the server
    // could not be reached" into "this range is empty".
    if (error) throw error;
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
    const { data, error } = await supabase
      .from("invoices")
      .select("id,invoice_number,customer_name,total,amount_paid,status,created_at")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    // A failed read must reach the caller as a failure: `(data ?? [])` alone turns "the server
    // could not be reached" into "this range is empty".
    if (error) throw error;
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
    const { data, error } = await supabase
      .from("purchases")
      .select("id,purchase_number,company_name,total_amount,amount_paid,amount_due,status,created_at")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    // A failed read must reach the caller as a failure: `(data ?? [])` alone turns "the server
    // could not be reached" into "this range is empty".
    if (error) throw error;
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
    const { data, error } = await supabase
      .from("returns")
      .select("id,return_number,customer_name,total_refund,refund_amount,created_at,sale_id,status")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    // A failed read must reach the caller as a failure: `(data ?? [])` alone turns "the server
    // could not be reached" into "this range is empty".
    if (error) throw error;
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
    const { data, error } = await supabase
      .from("customer_payments")
      .select("id,customer_id,amount,method,notes,created_at,recorded_by_name,customers(name)")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    // A failed read must reach the caller as a failure: `(data ?? [])` alone turns "the server
    // could not be reached" into "this range is empty".
    if (error) throw error;
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
    const { data, error } = await supabase
      .from("supplier_payments")
      .select("id,company_id,amount,method,notes,created_at,recorded_by_name,companies(name)")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    // A failed read must reach the caller as a failure: `(data ?? [])` alone turns "the server
    // could not be reached" into "this range is empty".
    if (error) throw error;
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
    const { data, error } = await supabase
      .from("payments")
      .select("id,customer_id,amount,method,notes,created_at,recorded_by_name,customers(name)")
      .gte("created_at", start)
      .lte("created_at", end)
      .order("created_at", { ascending: false });
    // A failed read must reach the caller as a failure: `(data ?? [])` alone turns "the server
    // could not be reached" into "this range is empty".
    if (error) throw error;
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

  const { data, error } = await supabase
    .from("stock_adjustments")
    .select("id,product_name,variant_name,adjustment_type,qty_change,qty_before,qty_after,reason,adjusted_by,created_at")
    .gte("created_at", start)
    .lte("created_at", end)
    .order("created_at", { ascending: false });
  // A failed read must reach the caller as a failure: `(data ?? [])` alone turns "the server
  // could not be reached" into "this range is empty".
  if (error) throw error;
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
  const { isRtl } = useDir();
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
  /** The range has no copy on this device AND the read failed — see the empty state below. */
  const [readFailed, setReadFailed] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [selected, setSelected] = useState<Tx | null>(null);
  const [query, setQuery] = useState("");

  // The picture belongs to the customer or supplier record, not to this ledger: a card written
  // last month and one written today both read the current portrait. Reading the same live stores
  // the profile and pickers use is what keeps an upload in sync here, in the filter sheet and on
  // every other screen — there is no second copy of the URL to fall behind.
  const customers = useCustomersStore((s) => s.customers);
  const companies = useCompaniesStore((s) => s.companies);
  const imageByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const customer of customers) {
      if (customer.imageUrl) map.set(customer.name.trim().toLowerCase(), customer.imageUrl);
    }
    for (const company of companies) {
      if (company.logoUrl) map.set(company.name.trim().toLowerCase(), company.logoUrl);
    }
    return map;
  }, [customers, companies]);

  const photoFor = (name: string) => imageByName.get(name.trim().toLowerCase());

  const from = period === "custom" ? customFrom : daysAgo(PERIOD_DAYS[period]);
  const to = period === "custom" ? customTo : today;

  const allowed = hasPermission(info.permission);

  // A new ledger is a new question; a keyword typed for invoices must not follow the reader into
  // sales. The range stays, because it belongs to the screen rather than to one search.
  useEffect(() => {
    setQuery("");
    setSelected(null);
  }, [kind]);

  // The translator is not a dependency: `useT` hands back a new function each render, so reading
  // it through a ref keeps the fetch keyed to the ledger and the days rather than to the render.
  const translate = useRef(t);
  translate.current = t;

  const load = useCallback(async () => {
    if (!allowed) return;
    // One key per ledger and window. The last copy this device read is the offline answer: it
    // paints immediately, and the refresh below replaces it with the server's rows when there is
    // a connection. A ledger the shop has never opened has nothing to show but its skeleton.
    const cacheKey = `history-${kind}-${from}-${to}`;
    const cached = getCachedData<Tx[]>(cacheKey);
    setTransactions(cached ?? null);
    setReadFailed(false);
    try {
      const rows = await loadTransactions(kind, from, to, base, translate.current);
      setTransactions(rows);
      setCachedData(cacheKey, rows);
    } catch {
      // A failed read falls back to the cached ledger; with no cache it is empty, not a spinner
      // that never resolves. It is NOT the same emptiness as "this range has nothing in it"
      // (measured offline 2026-11-20): 1W was unreachable-but-not-empty and the screen said
      // "Nothing in this range" over a week that plainly had sales. The flag lets the empty
      // state say which of the two it is.
      if (!cached) {
        setTransactions([]);
        setReadFailed(true);
      }
    }
  }, [allowed, kind, from, to, base]);

  useEffect(() => {
    void load();
  }, [load, nonce]);

  /** Every field the card carries — including its detail rows — is searchable. */
  const visible = useMemo(() => {
    const rows = transactions ?? [];
    if (!query.trim()) return rows;
    return rows.filter((tx) =>
      matchesSearch(query, [
        tx.title,
        tx.meta,
        tx.sub,
        tx.status?.label,
        tx.quantity,
        tx.amount != null ? formatCurrency(tx.amount) : "",
        ...tx.detail.flatMap((row) => [row.label, row.value]),
      ]),
    );
  }, [transactions, query]);

  const summaryText = useMemo(() => {
    const lines = visible.slice(0, 40).map((tx) => {
      const value = tx.amount != null ? formatCurrency(tx.amount) : tx.quantity ?? "";
      return [tx.title, tx.meta, value].filter(Boolean).join(" · ");
    });
    return [`${t(info.labelKey)} · ${from} – ${to}`, ...lines].join("\n");
  }, [visible, from, to, info.labelKey, t]);

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
    const lines = visible.map((tx) =>
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

      {transactions !== null && transactions.length > 0 && (
        <div className="px-4 pt-3">
          <SearchBar
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onClear={() => setQuery("")}
            placeholder={t("history.searchPlaceholder")}
            aria-label={t("history.searchPlaceholder")}
            data-testid="history-search"
          />
        </div>
      )}

      {transactions === null ? (
        <SkeletonList rows={5} />
      ) : transactions.length === 0 ? (
        <EmptyState
          icon={HistoryIcon}
          title={t(readFailed ? "history.offlineTitle" : "history.nothing")}
          subtitle={t(readFailed ? "history.offlineBody" : "history.emptyBody")}
        />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t("history.noMatchesTitle")}
          subtitle={t("history.noMatchesBody")}
          action={{ label: t("history.clearSearch"), onClick: () => setQuery("") }}
        />
      ) : (
        <div className="px-4 pt-3 pb-8 flex flex-col gap-2" data-testid="history-cards">
          {visible.map((tx) => {
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
                  className="size-10 shrink-0 rounded-full overflow-hidden flex items-center justify-center text-14 font-bold"
                  style={{ background: "var(--surface)", color: "var(--text-primary)" }}
                >
                  <Photo
                    src={photoFor(tx.title)}
                    alt={tx.title}
                    className="w-full h-full object-cover"
                    fallback={initial}
                  />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-14 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
                    {tx.title}
                  </p>
                  {/* In an Urdu (RTL) card a plain paragraph reorders "20 Nov 2026 — 12:41 am"
                      around the digits. The line is marked LTR for its own content and aligned to
                      the card's start edge, so the date reads in order on both sides. */}
                  <p
                    dir="ltr"
                    className="text-11 mt-0.5"
                    style={{ color: "var(--text-secondary)", textAlign: isRtl ? "right" : "left" }}
                  >
                    {tx.meta}
                  </p>
                  {tx.sub && (
                    <p
                      dir="ltr"
                      className="text-11 mt-0.5 truncate"
                      style={{ color: "var(--text-tertiary)", textAlign: isRtl ? "right" : "left" }}
                    >
                      {tx.sub}
                    </p>
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
              {/* The record's own face, above its values — the same live portrait the card showed. */}
              <div className="flex items-center gap-3 pb-3" data-testid="history-detail-photo">
                <span
                  className="size-11 shrink-0 rounded-full overflow-hidden flex items-center justify-center text-15 font-bold"
                  style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
                >
                  <Photo
                    src={photoFor(selected.title)}
                    alt={selected.title}
                    className="w-full h-full object-cover"
                    fallback={selected.title.charAt(0).toUpperCase()}
                  />
                </span>
                <div className="min-w-0">
                  <p className="text-15 font-semibold truncate" style={{ color: "var(--text-primary)" }}>{selected.title}</p>
                  <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>{selected.meta}</p>
                </div>
              </div>
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
