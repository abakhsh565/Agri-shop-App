import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import DateField from "@/components/ui/DateField";
import { formatCurrency, getStockStatus, productLowStockThreshold } from "@/lib/formatters";
import { useThemeStore } from "@/stores/themeStore";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { AlertTriangle, Calendar, BarChart3, LayoutGrid } from "lucide-react";
import { pkToday } from "@/lib/pkDate";
import { summariseSales, profitDisplay } from "@/lib/profit";
import { summariseMoneyIn, loadCreditPayments, type CreditPaymentRow } from "@/lib/money";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";

type Period = "today" | "week" | "month" | "all" | "custom";

const PERIODS: { key: Period; labelKey: string }[] = [
  { key: "today", labelKey: "sales.today" },
  { key: "week", labelKey: "sales.thisWeek" },
  { key: "month", labelKey: "sales.thisMonth" },
  { key: "all", labelKey: "sales.allTime" },
  { key: "custom", labelKey: "admin.customDateRange" },
];

function startOf(period: Period, customFrom?: string, customTo?: string): { from: number; to: number } {
  const now = new Date();
  if (period === "today") {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    return { from: +d, to: +now };
  }
  if (period === "week") {
    const d = new Date(now); d.setDate(d.getDate() - 7);
    return { from: +d, to: +now };
  }
  if (period === "month") {
    const d = new Date(now); d.setMonth(d.getMonth() - 1);
    return { from: +d, to: +now };
  }
  if (period === "custom") {
    const from = customFrom ? new Date(customFrom + "T00:00:00").getTime() : 0;
    const to = customTo ? new Date(customTo + "T23:59:59").getTime() : +now;
    return { from, to };
  }
  return { from: 0, to: +now };
}

interface ChartBucket {
  label: string;
  value: number;
}

/** "3p", not "15:00": the strip is read at a glance, and a phone-width bar has room for four
 *  characters. */
function hourLabel(hour: number): string {
  const suffix = hour < 12 ? "a" : "p";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}${suffix}`;
}

/**
 * When the money came in, as bars the strip can show on one phone line.
 *
 * The bucket size follows the period, because the question does: a day is read in hours, a week
 * in days, a month in weeks. Eight bars for a day, seven chunks otherwise — few enough that each
 * label is legible at 9px, many enough to show a shape rather than a single blob. `from`/`to`
 * define the window, so a bucket can never hold a sale from outside the period on screen.
 */
function buildBuckets(
  sales: { totalAmount: number; createdAt: string }[],
  period: Period,
  from: number,
  to: number,
): ChartBucket[] {
  if (period === "today") {
    const buckets: ChartBucket[] = Array.from({ length: 8 }, (_, i) => ({ label: hourLabel(i * 3), value: 0 }));
    for (const sale of sales) {
      const hour = new Date(sale.createdAt).getHours();
      buckets[Math.min(7, Math.max(0, Math.floor(hour / 3)))].value += sale.totalAmount;
    }
    return buckets;
  }

  const DAY = 86_400_000;
  const spanDays = Math.max(1, Math.ceil((to - from) / DAY));
  const bucketDays = period === "week" ? 1 : Math.max(1, Math.ceil(spanDays / 7));
  const count = Math.max(1, Math.ceil(spanDays / bucketDays));
  const starts = Array.from({ length: count }, (_, i) => from + i * bucketDays * DAY);
  const buckets: ChartBucket[] = starts.map((start) => ({
    label: new Date(start).toLocaleDateString(undefined, bucketDays >= 28 ? { month: "short" } : { day: "numeric", month: "short" }),
    value: 0,
  }));

  for (const sale of sales) {
    const index = Math.floor((+new Date(sale.createdAt) - from) / (bucketDays * DAY));
    if (index >= 0 && index < buckets.length) buckets[index].value += sale.totalAmount;
  }
  return buckets;
}

export default function AdminReportsPage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();
  // The long-form report is a drill-down from the Reports directory, whether it was reached
  // from the directory or by a direct link/reload that has no navigation history behind it.
  const returnTo = useReturnTo(`${base}/reports/directory`);
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const [period, setPeriod] = useState<Period>("month");
  const [showDateModal, setShowDateModal] = useState(false);
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const mockSales = useSalesStore((s) => s.sales);
  const mockProducts = useProductsStore((s) => s.products);
  const mockCustomers = useCustomersStore((s) => s.customers);
  const mockCompanies = useCompaniesStore((s) => s.companies);
  // Every figure below is derived from these four stores, so the report body
  // waits for all of them rather than settling from empty arrays.
  // Every read is its own hook call — combining them inside one expression would
  // short-circuit and change the hook order while data is loading.
  const salesReady = useSalesStore((s) => s.ready);
  const productsReady = useProductsStore((s) => s.ready);
  const customersReady = useCustomersStore((s) => s.ready);
  const companiesReady = useCompaniesStore((s) => s.ready);
  // The udhaar half of money in is not in any store: it is its own table, loaded here through
  // the shared reader. The report waits for it rather than printing a total that is only the
  // counter half and then correcting itself.
  const [creditPayments, setCreditPayments] = useState<CreditPaymentRow[]>([]);
  const [paymentsReady, setPaymentsReady] = useState(false);
  useEffect(() => {
    loadCreditPayments()
      .then(setCreditPayments)
      .catch(() => {})
      .finally(() => setPaymentsReady(true));
  }, []);
  const ready = salesReady && productsReady && customersReady && companiesReady && paymentsReady;

  const variantCost = useMemo(() => {
    const map: Record<string, number> = {};
    for (const p of mockProducts) for (const v of p.variants) map[v.id] = v.costPrice;
    return map;
  }, [mockProducts]);

  const now = new Date();
  const todayISO = pkToday();

  const report = useMemo(() => {
    const { from, to } = startOf(period, customFrom, customTo);
    const sales = mockSales.filter((s) => !s.isVoided && +new Date(s.createdAt) >= from && +new Date(s.createdAt) <= to);

    const byEmployee: Record<string, { name: string; total: number }> = {};
    const byProduct: Record<string, { name: string; total: number; qty: number }> = {};

    for (const s of sales) {
      byEmployee[s.employeeId ?? 'unknown'] ??= { name: s.employeeName, total: 0 };
      byEmployee[s.employeeId ?? 'unknown'].total += s.totalAmount;
      for (const it of s.items) {
        byProduct[it.productId ?? 'unknown'] ??= { name: it.productName, total: 0, qty: 0 };
        byProduct[it.productId ?? 'unknown'].total += it.lineTotal;
        byProduct[it.productId ?? 'unknown'].qty += it.qty;
      }
    }

    // Money in comes from the one shared calculation (`@/lib/money`), so "the money that came
    // in this period" is the same number here and on Home, and the two halves it is made of
    // are named for what they are: cash taken at the counter, and old udhaar settled. The
    // payments are filtered to the period here because, unlike sales, they are not already.
    const money = summariseMoneyIn({
      sales,
      payments: creditPayments,
      inPeriod: (iso) => {
        const at = +new Date(iso);
        return at >= from && at <= to;
      },
    });

    // Revenue, cost and profit come from the one shared calculation, so a report for a
    // period and the Home card for the same period are the same arithmetic and cannot
    // disagree. Recorded line COGS is preferred; the variant lookup only fills lines the
    // snapshot could not price, and never as zero.
    const gross = summariseSales(sales, (id) => (id ? variantCost[id] : undefined));
    const revenue = gross.revenue;
    const cogs = gross.cogs;
    const grossProfit = gross.profit;
    const margin = gross.margin;
    const profitState = profitDisplay(gross);

    /*
     * The same numbers for the window immediately before this one.
     *
     * A comparison is the difference between a figure and a fact: "Rs 26,000" says nothing an
     * owner can act on, while "Rs 26,000, down 4% on the day before" does. The window is the
     * SAME length as the one on screen, ending where it starts, so a day is compared with a
     * day and a month with a month. All-time has no earlier window, so it carries no badges
     * rather than a comparison invented against zero.
     */
    const span = Math.max(to - from, 1);
    const prevFrom = from - span;
    const prevTo = from;
    const prevSales = mockSales.filter(
      (s) => !s.isVoided && +new Date(s.createdAt) >= prevFrom && +new Date(s.createdAt) < prevTo,
    );
    const prevGross = summariseSales(prevSales, (id) => (id ? variantCost[id] : undefined));
    const prevMoney = summariseMoneyIn({
      sales: prevSales,
      payments: creditPayments,
      inPeriod: (iso) => {
        const at = +new Date(iso);
        return at >= prevFrom && at < prevTo;
      },
    });
    const comparable = period !== "all" && prevFrom > 0;
    const averageSale = sales.length ? revenue / sales.length : null;
    const prevAverage = prevSales.length ? prevGross.revenue / prevSales.length : null;
    /** Percent change, or null when there is nothing honest to compare with. */
    const change = (nowValue: number | null, before: number | null): number | null => {
      if (!comparable || nowValue == null || before == null || before === 0) return null;
      return ((nowValue - before) / Math.abs(before)) * 100;
    };

    const topEmployees = Object.values(byEmployee).sort((a, b) => b.total - a.total).slice(0, 4);
    const topProducts = Object.values(byProduct).sort((a, b) => b.total - a.total).slice(0, 5);

    const outstandingCredit = mockCustomers.reduce((t, c) => t + c.outstandingBalance, 0);
    const supplierPayable = mockCompanies.reduce((t, c) => t + c.outstandingPayable, 0);
    // Same inventory rule as the dashboard and alerts (see
    // productLowStockThreshold): the product is "low" only while it still has
    // sellable stock, and it is measured against its most demanding variant.
    let lowStock = 0;
    for (const p of mockProducts) {
      const threshold = productLowStockThreshold(p.variants);
      if (p.stockQty > 0 && getStockStatus(p.stockQty, threshold) !== "in_stock") lowStock++;
    }

    return {
      revenue, cogs, grossProfit, margin, profitState, money,
      count: sales.length, topEmployees, topProducts,
      outstandingCredit, supplierPayable, lowStock,
      averageSale,
      chart: buildBuckets(sales, period, from, to),
      // `null` is drawn as no badge, never as 0% — "we cannot compare" and "nothing changed"
      // are different sentences, and only one of them is true here.
      deltas: {
        revenue: change(revenue, prevGross.revenue),
        profit: profitState.kind === "unknown" ? null : change(grossProfit, prevGross.unknownLines === 0 ? prevGross.profit : null),
        count: change(sales.length, prevSales.length),
        average: change(averageSale, prevAverage),
        moneyIn: change(money.total, prevMoney.total),
      },
    };
  }, [period, customFrom, customTo, mockSales, mockProducts, mockCustomers, mockCompanies, variantCost, creditPayments]);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader
        title={t("admin.reports")}
        backTo={returnTo}
        right={
          base === "/admin" ? (
            <button
              type="button"
              onClick={() =>
                navigate(`${base}/reports/directory`, { state: { from: `${base}/reports` } })
              }
              aria-label={t("reports.directory")}
              data-testid="reports-directory"
              className="flex items-center justify-center size-11 rounded-full active:opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              <LayoutGrid size={18} />
            </button>
          ) : undefined
        }
      />

      {/* Period filter — horizontal scroll */}
      <div
        className="flex gap-2 px-4 pt-3 pb-1 overflow-x-auto"
        style={{ scrollBehavior: "smooth", WebkitOverflowScrolling: "touch" }}
      >
        {PERIODS.map((p) => (
          <button
            key={p.key}
            onClick={() => {
              setPeriod(p.key);
              if (p.key === "custom") setShowDateModal(true);
            }}
            className="shrink-0 h-8 px-4 rounded-full text-xs font-bold whitespace-nowrap transition-colors"
            style={{
              background: period === p.key ? "var(--brand)" : "var(--surface-2)",
              color: period === p.key ? "#0a0a0a" : "var(--text-secondary)",
            }}
          >
            {p.key === "custom" && <Calendar size={12} className="inline me-1 -mt-0.5" />}
            {t(p.labelKey)}
          </button>
        ))}
      </div>

      {/* Custom date range summary */}
      {period === "custom" && (customFrom || customTo) && (
        <div className="px-4 pt-1 pb-1">
          <p className="text-xs font-semibold" style={{ color: "var(--brand-dark)" }}>
            {customFrom || t("admin.from")} → {customTo || todayISO}
          </p>
        </div>
      )}

      {!ready ? (
        <div className="px-4 pt-3">
          <SkeletonList rows={4} />
        </div>
      ) : (
        <>
      {/* The period's headline, read the way a shop's day is read: one figure, then a strip
          showing WHEN the money came in. It replaces a green card that named only the profit
          above a 2×2 grid of boxes — five numbers with no comparison between them and no shape,
          which is the part an owner could not act on (owner's request, 2026-10-26). */}
      <div className="px-4 pt-3">
        <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--tone-card)" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("reports.grossSales")}</p>
              <p
                className="text-28 font-bold leading-tight mt-1 break-words"
                style={{ color: "var(--text-primary)" }}
                data-testid="reports-gross-sales"
              >
                {formatCurrency(report.revenue)}
              </p>
            </div>
            <Delta value={report.deltas.revenue} />
          </div>
          <SalesChart buckets={report.chart} />
        </div>
      </div>

      {/* Metrics — the same period's figures as rows, each beside the period before it. The
          order is the order the questions come in: what did I sell, what did I keep, how many
          bills, what was an average bill, how much actually came in. A percent that cannot be
          worked out honestly draws no badge rather than a zero. */}
      <div className="px-4 pt-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-15 font-bold" style={{ color: "var(--text-primary)" }}>{t("reports.metrics")}</p>
          <p className="text-11 shrink-0" style={{ color: "var(--text-secondary)" }}>{t("reports.vsPrevious")}</p>
        </div>
        <div className="mt-2">
          <ListCard>
            <MetricRow
              label={t("reports.grossSales")}
              value={formatCurrency(report.revenue)}
              delta={report.deltas.revenue}
              testId="reports-metric-revenue"
            />
            <MetricRow
              label={t("admin.grossProfit")}
              value={
                report.profitState.kind === "unknown"
                  ? t("profit.addCostToSeeProfit")
                  : `${report.profitState.kind === "atLeast" ? "≥ " : ""}${formatCurrency(report.grossProfit)}`
              }
              delta={report.deltas.profit}
              testId="reports-gross-profit"
            />
            <MetricRow
              label={t("admin.transactions")}
              value={String(report.count)}
              delta={report.deltas.count}
            />
            <MetricRow
              label={t("reports.averageSale")}
              value={report.averageSale == null ? "—" : formatCurrency(report.averageSale)}
              delta={report.deltas.average}
            />
            <MetricRow
              label={t("reports.moneyIn")}
              value={formatCurrency(report.money.total)}
              delta={report.deltas.moneyIn}
              testId="reports-money-in"
            />
            <MetricRow label={t("reports.costOfGoods")} value={formatCurrency(report.cogs)} />
          </ListCard>
        </div>
      </div>

      {/* Money in, where it came from */}
      <div className="px-4 pt-5">
        <SectionTitle>{t("reports.moneyInTitle")}</SectionTitle>
        <ListCard>
          <ListRow
            title={t("reports.counterCash")}
            meta={t("reports.counterCashHint")}
            trailing={<span className="ds-row-strong">{formatCurrency(report.money.counter)}</span>}
          />
          <ListRow
            title={t("reports.creditCollected")}
            meta={t("reports.creditCollectedHint")}
            trailing={<span className="ds-row-strong">{formatCurrency(report.money.udhaar)}</span>}
          />
        </ListCard>
      </div>

      {/* Standing balances */}
      <div className="px-4 pt-5">
        <SectionTitle>{t("reports.standingBalances")}</SectionTitle>
        <ListCard>
          <ListRow
            title={t("reports.customerCreditOutstanding")}
            trailing={<span className="ds-row-strong" style={{ color: report.outstandingCredit > 0 ? "var(--warning)" : "var(--brand-dark)" }}>{formatCurrency(report.outstandingCredit)}</span>}
          />
          <ListRow
            title={t("reports.supplierPayable")}
            trailing={<span className="ds-row-strong" style={{ color: report.supplierPayable > 0 ? "var(--error)" : "var(--brand-dark)" }}>{formatCurrency(report.supplierPayable)}</span>}
          />
        </ListCard>
      </div>

      {/* Top employees */}
      {report.topEmployees.length > 0 && (
        <div className="px-4 pt-5">
          <SectionTitle>{t("reports.salesByEmployee")}</SectionTitle>
          <ListCard>
            {report.topEmployees.map((e, i) => (
              <ListRow
                key={`${e.name}-${i}`}
                title={e.name}
                trailing={<span className="ds-row-strong">{formatCurrency(e.total)}</span>}
              />
            ))}
          </ListCard>
        </div>
      )}

      {/* Top products */}
      {report.topProducts.length > 0 && (
        <div className="px-4 pt-5 pb-2">
          <SectionTitle>{t("reports.topProducts")}</SectionTitle>
          <ListCard>
            {report.topProducts.map((p) => (
              <ListRow
                key={p.name}
                title={p.name}
                meta={`${p.qty} units sold`}
                trailing={<span className="ds-row-strong">{formatCurrency(p.total)}</span>}
              />
            ))}
          </ListCard>
        </div>
      )}

      {/* Inventory alert */}
      {report.lowStock > 0 && (
        <div className="px-4 pt-3 pb-6">
          <div className="flex items-center gap-3 rounded-[var(--radius-card)] p-4" style={{ background: "rgba(245,158,11,0.12)" }}>
            <AlertTriangle size={18} style={{ color: "var(--warning)" }} />
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>
              <span className="font-bold">{report.lowStock}</span> variant{report.lowStock > 1 ? "s" : ""} low or out of stock — check Inventory.
            </p>
          </div>
        </div>
      )}

      {report.count === 0 && (
        <div className="flex flex-col items-center py-16 gap-2">
          <BarChart3 size={28} className="mx-auto block" style={{ color: "var(--text-tertiary)" }} />
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("reports.noSalesInPeriod")}</p>
        </div>
      )}

        </>
      )}

      {/* Custom date modal */}
      {showDateModal && (
        <div className="fixed inset-0 z-50 flex items-end" style={{ background: "var(--scrim)" }} onClick={() => setShowDateModal(false)}>
          <div className="w-full max-w-[390px] mx-auto rounded-t-[24px] p-6 flex flex-col gap-4"
            style={{ background: "var(--tone-sheet)" }} onClick={(e) => e.stopPropagation()}>
            <p className="text-base font-bold text-center" style={{ color: "var(--text-primary)" }}>{t("admin.selectDateRange")}</p>
            <div className="flex gap-3">
              <div className="flex-1">
                <p className="ds-section-label mb-1" style={{ color: "var(--text-secondary)" }}>{t("admin.from")}</p>
                <DateField
                  value={customFrom}
                  max={customTo || todayISO}
                  onChange={setCustomFrom}
                  testId="reports-from"
                />
              </div>
              <div className="flex-1">
                <p className="ds-section-label mb-1" style={{ color: "var(--text-secondary)" }}>{t("admin.to")}</p>
                <DateField
                  value={customTo}
                  min={customFrom || undefined}
                  max={todayISO}
                  onChange={setCustomTo}
                  testId="reports-to"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => { setCustomFrom(""); setCustomTo(""); }}
                className="flex-1 h-12 rounded-full text-sm font-bold" style={{ border: "1px solid var(--divider)", color: "var(--text-primary)" }}>{t("reports.clear")}</button>
              <button onClick={() => setShowDateModal(false)}
                className="flex-1 h-12 rounded-full text-sm font-bold" style={{ background: "var(--text-primary)", color: "var(--background)" }}>{t("reports.apply")}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One figure and the period it is being compared with, side by side.
 *
 * The name is quiet and the number is loud, which is the order these are read in; the badge
 * comes last so the eye lands on the amount before the change. `null` draws nothing at all —
 * a comparison that cannot be made is not a zero.
 */
function MetricRow({ label, value, delta, testId }: { label: string; value: string; delta?: number | null; testId?: string }) {
  return (
    <ListRow>
      <div className="flex items-center justify-between gap-3 w-full">
        <div className="min-w-0">
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>{label}</p>
          <p className="text-15 font-bold mt-0.5 break-words" style={{ color: "var(--text-primary)" }} data-testid={testId}>
            {value}
          </p>
        </div>
        <Delta value={delta ?? null} />
      </div>
    </ListRow>
  );
}

/** Up is the shop's success colour, down is its error colour — the same pair every other screen
 *  uses for the same two meanings, rather than a third palette for reports. */
function Delta({ value }: { value: number | null }) {
  if (value == null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-11 font-bold shrink-0 tabular-nums"
      style={{
        background: up ? "rgba(132,204,22,0.16)" : "rgba(239,68,68,0.12)",
        color: up ? "var(--brand-dark)" : "var(--error)",
      }}
      data-testid="reports-delta"
    >
      <span aria-hidden="true">{up ? "▲" : "▼"}</span>
      {Math.abs(value).toFixed(1)}%
    </span>
  );
}

/**
 * The strip of bars under the headline.
 *
 * Decorative on purpose: every figure it draws is also written as a row above (the total) or in
 * the metrics list (the parts), so a screen reader loses no information by skipping it. Bars are
 * brand-coloured and full-bleed to their bucket; an empty bucket keeps a 2px stub so the axis
 * still reads as a timeline rather than a gap.
 */
function SalesChart({ buckets }: { buckets: ChartBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.value));
  return (
    <div className="mt-3" aria-hidden="true">
      <div className="flex items-end gap-1.5 h-24">
        {buckets.map((bucket, i) => (
          <div key={i} className="flex-1 flex items-end h-full">
            <div
              className="w-full rounded-t-[3px]"
              style={{
                height: bucket.value > 0 ? `${Math.max(4, (bucket.value / max) * 100)}%` : "2px",
                background: bucket.value > 0 ? "var(--brand)" : "var(--divider)",
              }}
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-1.5">
        {buckets.map((bucket, i) => (
          <span key={i} className="flex-1 text-center text-9 truncate" style={{ color: "var(--text-tertiary)" }}>
            {bucket.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>{children}</p>
  );
}

