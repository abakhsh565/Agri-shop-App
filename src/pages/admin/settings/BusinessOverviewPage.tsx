import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Building2, CalendarClock,
  ChevronRight, GitBranch, Package, TrendingUp, Users,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import PeriodTabs from "@/components/ui/PeriodTabs";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useShopStore } from "@/stores/shopStore";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { formatCurrency, getStockStatus, productLowStockThreshold } from "@/lib/formatters";
import { summariseSales, profitDisplay, type LiveCostLookup } from "@/lib/profit";
import { EXPIRY_WARNING_DAYS, computeOverdueCreditTotal } from "@/lib/signalEngine";
import { pkDateFromISO, pkMonthStart, pkToday } from "@/lib/pkDate";

/**
 * The whole business in one screen — "Business overview".
 *
 * SHAPE (owner's reference, 2026-10-28). The screen is no longer a stack of boxes: a box per
 * section with more boxes inside it meant a card edge on every side of every figure, and the
 * reader had to see through two frames to find one number. The sections now sit straight on the
 * page — a heading, a sentence, then the surfaces that actually hold something: the two period
 * figures with their change, the trend chart, the two collection cards, the branch cards, the
 * stock rows and the report rows.
 *
 * THE ORDER IS THE ORDER THE OWNER ASKED THEM:
 *
 *   1. How much came in, how much was made, and which way it is moving  → figures + chart
 *   2. What am I owed and what do I owe                                 → customers + suppliers
 *   3. Which branch is doing what                                       → branch performance
 *   4. What is my stock worth and what needs attention                  → inventory and stock
 *   5. Where do I read the detail                                       → reports
 *
 * EVERY NUMBER IS THE NUMBER THE REST OF THE APP SHOWS. Profit is `lib/profit`'s (an unknown cost
 * is never a zero cost), overdue credit is the S1 rule (`computeOverdueCreditTotal`), the branch
 * figures are the ones `get_my_branches()` publishes per branch, and the two balance cards are
 * summed from the same branch-scoped rows the two screens behind them list — so a card and the
 * list it opens can never disagree. The stock counts use the inventory screens' own threshold and
 * the S9 expiry window.
 *
 * NO ILLUSTRATIVE FIGURES ANYWHERE. Where a figure is not available to this account it reads "—";
 * where a comparison has nothing to compare against (a previous window with no sales) the change
 * is not shown at all rather than printed as an infinite gain. The chart draws a floor-height bar
 * for a window with no sales, so an empty period is still a chart rather than a blank block.
 */

/** The three presets in the owner's reference, plus the hand-picked window the filter opens. */
type Preset = "month" | "sixMonths" | "year";
type Period = Preset | "custom";

/** Days between two PK days, inclusive of both ends. */
function daysInclusive(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.max(1, Math.round((b - a) / 86400000) + 1);
}

/** A PK day, moved by whole days. Dates are plain `YYYY-MM-DD`, so this stays a date. */
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The first day of the month `delta` months away from the one this day falls in. */
function monthStart(iso: string, delta = 0): string {
  const [year, month] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 10);
}

/** A bucket's start, as a reader would say it: "12 Oct". */
function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}

/** A month, as a chart axis says it: "Oct". */
function shortMonth(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "short", timeZone: "UTC",
  });
}

/**
 * The change against the previous window, or `null` when there is nothing honest to say.
 *
 * A previous window of zero has no percentage: any number printed over it would be a division
 * by nothing dressed up as growth. `null` draws no change line at all.
 */
function changePct(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return ((current - previous) / previous) * 100;
}

/** A section heading that stands on the page rather than inside a card. */
function SectionHead({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="px-4 mt-6 mb-2">
      <h2 className="text-15 font-bold">{title}</h2>
      <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{hint}</p>
    </div>
  );
}

/** The measured part of a total, drawn as a bar. A zero total draws an empty track. */
function Progress({ pct }: { pct: number }) {
  return (
    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
      <div
        className="h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: "var(--brand)" }}
      />
    </div>
  );
}

export default function BusinessOverviewPage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();

  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;

  const sales = useSalesStore((s) => s.sales);
  const salesReady = useSalesStore((s) => s.ready);
  const loadSales = useSalesStore((s) => s.load);
  const products = useProductsStore((s) => s.products);
  const productsReady = useProductsStore((s) => s.ready);
  const loadProducts = useProductsStore((s) => s.load);
  const customers = useCustomersStore((s) => s.customers);
  const customersReady = useCustomersStore((s) => s.ready);
  const loadCustomers = useCustomersStore((s) => s.load);
  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const loadCompanies = useCompaniesStore((s) => s.load);

  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);

  // Each store is asked for its rows only if it has none: the shell may already have loaded
  // them, and re-reading on every visit would be four needless round trips.
  useEffect(() => { if (!branchesLoaded) void loadBranches(); }, [branchesLoaded, loadBranches]);
  useEffect(() => { if (!salesReady) void loadSales(); }, [salesReady, loadSales]);
  useEffect(() => { if (!productsReady) void loadProducts(); }, [productsReady, loadProducts]);
  useEffect(() => { if (!customersReady) void loadCustomers(); }, [customersReady, loadCustomers]);
  useEffect(() => { if (!companiesReady) void loadCompanies(); }, [companiesReady, loadCompanies]);

  const ready = salesReady && productsReady && customersReady && companiesReady;

  const todayISO = pkToday();
  const rangeFrom =
    period === "custom"
      ? customFrom || monthStart(todayISO)
      : period === "sixMonths" ? monthStart(todayISO, -5)
      : period === "year" ? `${todayISO.slice(0, 4)}-01-01`
      : monthStart(todayISO);
  const rangeTo = period === "custom" ? customTo || todayISO : todayISO;

  const windowDays = daysInclusive(rangeFrom, rangeTo);
  // The window the change is measured against: the same number of days, ending the day before
  // this one starts.
  const prevTo = shiftDays(rangeFrom, -1);
  const prevFrom = shiftDays(prevTo, -(windowDays - 1));

  const salesIn = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const sale of sales) {
      if (sale.isVoided) continue;
      const day = pkDateFromISO(sale.createdAt);
      byDay.set(day, (byDay.get(day) ?? 0) + sale.totalAmount);
    }
    return (from: string, to: string) => {
      let sum = 0;
      for (const [day, amount] of byDay) if (day >= from && day <= to) sum += amount;
      return sum;
    };
  }, [sales]);

  const periodSales = useMemo(
    () => sales.filter((sale) => {
      if (sale.isVoided) return false;
      const day = pkDateFromISO(sale.createdAt);
      return day >= rangeFrom && day <= rangeTo;
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sales, rangeFrom, rangeTo],
  );
  const prevSales = useMemo(
    () => sales.filter((sale) => {
      if (sale.isVoided) return false;
      const day = pkDateFromISO(sale.createdAt);
      return day >= prevFrom && day <= prevTo;
    }),
    [sales, prevFrom, prevTo],
  );

  // A line written before cost snapshots existed is priced at today's cost — the same fallback
  // `lib/profit` uses everywhere else, so this screen cannot invent a different margin.
  const liveCost: LiveCostLookup = useMemo(() => {
    const byVariant = new Map<string, number>();
    for (const product of products) {
      for (const variant of product.variants ?? []) {
        if (variant.costPrice > 0) byVariant.set(variant.id, variant.costPrice);
      }
    }
    return (variantId) => (variantId ? byVariant.get(variantId) : undefined);
  }, [products]);

  const profit = useMemo(() => profitDisplay(summariseSales(periodSales, liveCost)), [periodSales, liveCost]);
  const prevProfit = useMemo(() => profitDisplay(summariseSales(prevSales, liveCost)), [prevSales, liveCost]);

  const totalSales = periodSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const prevTotalSales = prevSales.reduce((sum, sale) => sum + sale.totalAmount, 0);

  // Only a known profit can be compared: an unknown one (costs missing) has no number to put
  // next to last window's, so the change line is simply absent.
  const profitChange = profit.kind === "unknown" || prevProfit.kind === "unknown"
    ? null
    : changePct(profit.amount, prevProfit.amount);
  const salesChange = changePct(totalSales, prevTotalSales);

  const money = (value: number | null, floor = false) =>
    value == null ? "—" : `${floor ? "≥ " : ""}${formatCurrency(value)}`;
  const profitValue = profit.kind === "unknown" ? "—" : money(profit.amount, profit.kind === "atLeast");
  const profitHint = profit.kind === "unknown"
    ? t("profit.addCostToSeeProfit")
    : profit.kind === "atLeast"
      ? t("profit.costMissingOn", { count: profit.unknownLines })
      : t("overview.netProfitHint");

  const overdueCredit = computeOverdueCreditTotal(customers);
  const inventoryValue = activeBranch?.inventoryValue ?? null;
  const inventoryIncomplete = activeBranch?.inventoryCostIncomplete === true;

  // Stock health is a current fact, not a period figure: counted per product with the same
  // threshold rule the inventory screens use, and the S9 expiry window.
  const lowOrOut = products.filter(
    (product) => getStockStatus(product.stockQty, productLowStockThreshold(product.variants)) !== "in_stock",
  ).length;
  const expiring = products.filter((product) =>
    (product.variants ?? []).some((variant) => {
      if (!variant.expiryDate) return false;
      const days = Math.round((Date.parse(pkDateFromISO(variant.expiryDate)) - Date.parse(todayISO)) / 86400000);
      return days <= EXPIRY_WARNING_DAYS;
    }),
  ).length;

  /**
   * The two standing balances, each from the rows its own screen lists.
   *
   * A customer row carries what this branch has billed them, what has been collected and what is
   * still owed (0242). The supplier rows carry the branch's purchases and the payable left on
   * them, so money paid is the difference. Both are branch money, never the shop's, and the two
   * are never netted against each other.
   */
  const receivable = useMemo(() => {
    const billed = customers.reduce((sum, c) => sum + Math.max(0, c.totalPurchases), 0);
    const due = customers.reduce((sum, c) => sum + Math.max(0, c.outstandingBalance), 0);
    const total = Math.max(billed, due);
    // Collected is what is left of the bill once the remainder is removed, NOT the sum of the
    // payments column: a return lowers the bill but not the money once taken, so using the
    // column alone produced "100,000 collected of 0 billed" after a full refund.
    const paid = Math.max(0, total - due);
    return { total, paid, due, pct: total > 0 ? Math.round((paid / total) * 100) : 0 };
  }, [customers]);

  const payable = useMemo(() => {
    const billed = companies.reduce((sum, c) => sum + Math.max(0, c.totalPurchases), 0);
    const due = companies.reduce((sum, c) => sum + Math.max(0, c.outstandingPayable), 0);
    const total = Math.max(billed, due);
    return { total, paid: Math.max(0, total - due), due, pct: total > 0 ? Math.round((total - due) / total * 100) : 0 };
  }, [companies]);

  /**
   * The chart's buckets. A window of a month or less is divided into its weeks; a longer window
   * is divided by month, because four "weeks" over a year would not be weeks. Each bucket carries
   * the same number of days from the window before it, which is what makes the pair a comparison
   * rather than two unrelated numbers.
   */
  const buckets = useMemo(() => {
    if (windowDays <= 31) {
      const count = windowDays >= 4 ? 4 : 1;
      const span = Math.ceil(windowDays / count);
      return Array.from({ length: count }, (_, i) => {
        const start = shiftDays(rangeFrom, i * span);
        const end = [shiftDays(start, span - 1), rangeTo].sort()[0];
        return {
          key: start,
          label: count === 1 ? shortDay(rangeFrom) : t("overall.week", { n: i + 1 }),
          current: salesIn(start, end),
          previous: salesIn(shiftDays(start, -windowDays), shiftDays(end, -windowDays)),
        };
      });
    }
    const out: { key: string; label: string; current: number; previous: number }[] = [];
    let cursor = monthStart(rangeFrom);
    while (cursor <= rangeTo) {
      const next = monthStart(cursor, 1);
      const start = cursor < rangeFrom ? rangeFrom : cursor;
      const lastDay = shiftDays(next, -1);
      const end = lastDay > rangeTo ? rangeTo : lastDay;
      out.push({
        key: cursor,
        label: shortMonth(cursor),
        current: salesIn(start, end),
        previous: salesIn(shiftDays(start, -windowDays), shiftDays(end, -windowDays)),
      });
      cursor = next;
    }
    return out;
    // `windowDays`, `rangeFrom` and `rangeTo` fully describe the buckets; `t` supplies the label.
  }, [rangeFrom, rangeTo, windowDays, salesIn, t]);

  // The tallest bar owns the scale, so every other bar is a share of it; a floor keeps an empty
  // bucket visible as a tick rather than as nothing.
  const barMax = Math.max(0, ...buckets.flatMap((b) => [b.current, b.previous]));
  const barHeight = (value: number) => `${barMax ? Math.max(4, (value / barMax) * 100) : 6}%`;

  const periodOptions: { key: Preset; label: string }[] = [
    { key: "month", label: t("overall.periodMonth") },
    { key: "sixMonths", label: t("overall.periodSixMonths") },
    { key: "year", label: t("overall.periodYear") },
  ];
  const periodLabel =
    period === "sixMonths" ? t("overall.periodSixMonths")
    : period === "year" ? t("overall.periodYear")
    : period === "month" ? t("overall.periodMonth")
    : t("overall.custom");

  const branchRows = branches.map((branch) => ({
    id: branch.id,
    name: branch.name,
    where: branch.place?.label ?? (branch.isMain ? t("branches.main") : t("branches.sub")),
    salesToDate: branch.salesTotal,
    credit: branch.creditOutstanding,
    isCurrent: branch.isCurrent,
  }));
  const branchSalesMax = Math.max(0, ...branchRows.map((b) => b.salesToDate ?? 0));

  /** One figure of the top card: name, value, and the line under it. */
  function Figure({
    label, value, note, change, testId,
  }: {
    label: string;
    value: string;
    note?: string;
    change?: number | null;
    testId: string;
  }) {
    const up = (change ?? 0) >= 0;
    return (
      <div className="min-w-0 flex-1" data-testid={testId}>
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>{label}</p>
        <p className="text-22 font-bold mt-1 tabular-nums break-words">{value}</p>
        {change != null ? (
          <p
            className="text-11 mt-1 flex items-center gap-1 tabular-nums"
            // The measured change reads green upwards and red downwards. `--brand-dark` is the
            // one green that stays legible on both themes (dark olive in light, lime in dark).
            style={{ color: up ? "var(--brand-dark)" : "var(--error)" }}
          >
            {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
            {Math.abs(Math.round(change))}% {t("overall.vsPrevious")}
          </p>
        ) : (
          note && <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>{note}</p>
        )}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="business-overview-page"
    >
      <StatusBar />
      {/* This screen IS the Overview section now, so the arrow returns to the Settings menu
          rather than to a hub list that no longer exists. */}
      <NavHeader title={t("overall.title")} backTo={`${base}/settings`} />

      {!ready ? (
        <SkeletonList rows={6} />
      ) : (
        <div className="pb-8">
          {/* ── The head of the screen, straight on the page ───────────────────────────── */}
          <div className="px-4 pt-2">
            <h1 className="text-22 font-bold">{t("overview.title")}</h1>
            <p className="text-13 mt-1" style={{ color: "var(--text-secondary)" }}>{t("overview.subtitle")}</p>
          </div>

          <div className="px-4 pt-4">
            <PeriodTabs
              options={periodOptions}
              value={period === "custom" ? null : period}
              onChange={(key) => setPeriod(key)}
              onFilter={() => setRangeOpen(true)}
              filterActive={period === "custom"}
              label={t("overview.periodLabel")}
              filterLabel={t("admin.selectDateRange")}
              testIdPrefix="overall-period"
            />
          </div>

          {/* ── 1. The two period figures, their change, and the trend ─────────────────── */}
          <div className="px-4 pt-5" data-testid="overall-figures">
            <div className="flex gap-5">
              <Figure
                testId="overall-net-sales"
                label={t("overall.netSales")}
                value={money(totalSales)}
                change={salesChange}
                note={periodLabel}
              />
              <Figure
                testId="overall-net-profit"
                label={t("overview.netProfit")}
                value={profitValue}
                change={profitChange}
                note={profitHint}
              />
            </div>

            <div
              className="mt-5 flex items-end gap-1.5 h-28"
              role="img"
              aria-label={t("overall.trends")}
              data-testid="overall-trend-bars"
            >
              {buckets.map((bucket) => (
                <div key={bucket.key} className="flex-1 min-w-0 h-full flex items-end justify-center gap-[3px]">
                  <div
                    className="w-1/2 max-w-3 rounded-t-[3px]"
                    style={{ height: barHeight(bucket.previous), background: "var(--muted)" }}
                  />
                  <div
                    className="w-1/2 max-w-3 rounded-t-[3px]"
                    style={{ height: barHeight(bucket.current), background: "var(--brand)" }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              {buckets.map((bucket) => (
                <span
                  key={bucket.key}
                  className="flex-1 min-w-0 text-10 text-center truncate"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {bucket.label}
                </span>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-4">
              <span className="flex items-center gap-1.5 text-10" style={{ color: "var(--text-secondary)" }}>
                <span className="size-2 rounded-[2px]" style={{ background: "var(--brand)" }} />
                {t("overall.legendCurrent")}
              </span>
              <span className="flex items-center gap-1.5 text-10" style={{ color: "var(--text-secondary)" }}>
                <span className="size-2 rounded-[2px]" style={{ background: "var(--muted)" }} />
                {t("overall.legendPrevious")}
              </span>
            </div>
            {barMax === 0 && (
              <p className="text-11 mt-2" style={{ color: "var(--text-tertiary)" }}>{t("overall.noSales")}</p>
            )}
          </div>

          {/* ── 2. The two standing balances, each opening its own collection screen ───── */}
          <SectionHead title={t("overall.balances")} hint={t("overall.balancesHint")} />

          <div className="px-4 flex flex-col gap-2.5">
            <button
              type="button"
              onClick={() => navigate(`${base}/settings/overview/customers`)}
              data-testid="overall-receivables-row"
              className="rounded-[var(--radius-card)] p-4 text-start active:opacity-70"
              style={{ background: "var(--tone-card)" }}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-14 font-bold">{t("overall.customerReceivable")}</p>
                  <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{t("overall.oweYou")}</p>
                </div>
                <ChevronRight size={16} className="shrink-0 mt-0.5" style={{ color: "var(--text-secondary)" }} />
              </div>
              <div className="flex items-baseline justify-between gap-3 mt-3">
                <p className="text-18 font-bold tabular-nums break-words min-w-0">
                  {money(receivable.total)}
                  <span className="text-11 font-normal ms-1.5" style={{ color: "var(--text-secondary)" }}>
                    {t("overall.totalDue")}
                  </span>
                </p>
                <p className="text-12 font-semibold tabular-nums shrink-0" style={{ color: "var(--text-secondary)" }}>
                  {receivable.pct}%
                </p>
              </div>
              <div className="mt-2">
                <Progress pct={receivable.pct} />
              </div>
              <div className="flex items-end justify-between gap-3 mt-2">
                <div className="min-w-0">
                  <p className="text-10 flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                    <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--brand)" }} />
                    {t("overall.collected")}
                  </p>
                  <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{money(receivable.paid)}</p>
                </div>
                <div className="min-w-0 text-end">
                  <p className="text-10 flex items-center gap-1.5 justify-end" style={{ color: "var(--text-secondary)" }}>
                    <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--muted)" }} />
                    {t("overall.remaining")}
                  </p>
                  <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{money(receivable.due)}</p>
                </div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => navigate(`${base}/settings/overview/suppliers`)}
              data-testid="overall-payables-row"
              className="rounded-[var(--radius-card)] p-4 text-start active:opacity-70"
              style={{ background: "var(--tone-card)" }}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-14 font-bold">{t("overall.supplierPayable")}</p>
                  <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{t("overall.youOwe")}</p>
                </div>
                <ChevronRight size={16} className="shrink-0 mt-0.5" style={{ color: "var(--text-secondary)" }} />
              </div>
              <div className="flex items-baseline justify-between gap-3 mt-3">
                <p className="text-18 font-bold tabular-nums break-words min-w-0">
                  {money(payable.total)}
                  <span className="text-11 font-normal ms-1.5" style={{ color: "var(--text-secondary)" }}>
                    {t("overall.totalPayable")}
                  </span>
                </p>
                <p className="text-12 font-semibold tabular-nums shrink-0" style={{ color: "var(--text-secondary)" }}>
                  {payable.pct}%
                </p>
              </div>
              <div className="mt-2">
                <Progress pct={payable.pct} />
              </div>
              <div className="flex items-end justify-between gap-3 mt-2">
                <div className="min-w-0">
                  <p className="text-10 flex items-center gap-1.5" style={{ color: "var(--text-secondary)" }}>
                    <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--brand)" }} />
                    {t("overall.paid")}
                  </p>
                  <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{money(payable.paid)}</p>
                </div>
                <div className="min-w-0 text-end">
                  <p className="text-10 flex items-center gap-1.5 justify-end" style={{ color: "var(--text-secondary)" }}>
                    <span className="size-1.5 rounded-full shrink-0" style={{ background: "var(--muted)" }} />
                    {t("overall.remaining")}
                  </p>
                  <p className="text-13 font-bold tabular-nums mt-0.5 break-words">{money(payable.due)}</p>
                </div>
              </div>
            </button>

            {overdueCredit > 0 && (
              <p className="text-11" style={{ color: "var(--text-tertiary)" }}>
                {t("overall.overdue", { amount: formatCurrency(overdueCredit) })}
              </p>
            )}
          </div>

          {/* ── 3. Branch performance ──────────────────────────────────────────────────── */}
          <SectionHead title={t("overall.branchPerformance")} hint={t("overall.branchHint")} />

          <div className="px-4 flex flex-col gap-2.5" data-testid="overall-branches">
            {branchRows.map((branch) => (
              <button
                key={branch.id}
                type="button"
                onClick={() => navigate(`${base}/settings/branches/${branch.id}`)}
                data-testid={`overall-branch-${branch.id}`}
                className="text-start rounded-[var(--radius-card)] p-4 active:opacity-70"
                style={{ background: "var(--tone-card)" }}
              >
                <div className="flex items-center gap-2">
                  <span className="text-14 font-bold truncate min-w-0">{branch.name}</span>
                  <ChevronRight size={14} className="ms-auto shrink-0" style={{ color: "var(--text-secondary)" }} />
                </div>
                <p className="text-12 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                  {branch.where}{branch.isCurrent ? ` · ${t("shop.current")}` : ""}
                </p>
                <div className="flex items-baseline justify-between mt-2.5 gap-3">
                  <div className="min-w-0">
                    <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("overall.salesToDate")}</p>
                    <p className="text-14 font-bold tabular-nums break-words">{money(branch.salesToDate)}</p>
                  </div>
                  <div className="min-w-0 text-end">
                    <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("overall.outstandingCredit")}</p>
                    <p className="text-14 font-bold tabular-nums break-words">{money(branch.credit)}</p>
                  </div>
                </div>
                <div className="mt-2">
                  <Progress pct={branchSalesMax ? ((branch.salesToDate ?? 0) / branchSalesMax) * 100 : 0} />
                </div>
              </button>
            ))}
            {branchRows.length === 0 && (
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("overall.branchFooter")}</p>
            )}
          </div>

          {/* ── 4. Inventory and stock ─────────────────────────────────────────────────── */}
          <SectionHead title={t("overall.inventory")} hint={t("overall.inventoryHint")} />

          {/* Rows straight on the page, the way the section hubs list their jobs (owner's
              reference, 2026-10-28): there is no card and no hairline between two CTAs, because
              each row is a different place rather than a line in a table. `ListRow` still owns
              the height, the insets and the press state. */}
          <div>
            <ListRow
              icon={Package}
              title={t("overview.inventoryValue")}
              onClick={() => navigate(`${base}/inventory/stock`)}
              testId="overall-inventory-value"
              trailing={<span className="ds-row-value shrink-0">{money(inventoryValue, inventoryIncomplete)}</span>}
            />
            <ListRow
              icon={AlertTriangle}
              title={t("overview.lowOut")}
              onClick={() => navigate(`${base}/alerts/inventory`)}
              testId="overall-low-stock"
              trailing={<span className="ds-row-value shrink-0">{lowOrOut.toLocaleString("en-PK")}</span>}
            />
            <ListRow
              icon={CalendarClock}
              title={t("overview.expiring")}
              meta={t("overview.withinDays", { days: EXPIRY_WARNING_DAYS })}
              onClick={() => navigate(`${base}/alerts/expiry`)}
              testId="overall-expiring"
              trailing={<span className="ds-row-value shrink-0">{expiring.toLocaleString("en-PK")}</span>}
            />
          </div>

          {/* ── 5. Reports ─────────────────────────────────────────────────────────────── */}
          <SectionHead title={t("overall.reports")} hint={t("overall.reportsHint")} />

          <div className="pb-4">
            <div>
              <ListRow
                icon={BarChart3}
                testId="report-sales"
                title={t("overall.reportSales")}
                meta={t("overall.reportSalesHint")}
                onClick={() => navigate(`${base}/reports`)}
                trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
              />
              <ListRow
                icon={TrendingUp}
                testId="report-profit"
                title={t("overall.reportProfit")}
                meta={t("overall.reportProfitHint")}
                onClick={() => navigate(`${base}/reports`)}
                trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
              />
              <ListRow
                icon={Users}
                testId="report-customer-balances"
                title={t("overall.reportCustomers")}
                meta={t("overall.reportCustomersHint")}
                onClick={() => navigate(`${base}/settings/overview/customers`)}
                trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
              />
              <ListRow
                icon={Building2}
                testId="report-supplier-balances"
                title={t("overall.reportSuppliers")}
                meta={t("overall.reportSuppliersHint")}
                onClick={() => navigate(`${base}/settings/overview/suppliers`)}
                trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
              />
              <ListRow
                icon={GitBranch}
                testId="report-branches"
                title={t("overall.reportBranches")}
                meta={t("overall.reportBranchesHint")}
                onClick={() => navigate(`${base}/reports`)}
                trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
              />
            </div>
          </div>
        </div>
      )}

      <DateRangeSheet
        open={rangeOpen}
        from={customFrom}
        to={customTo}
        max={todayISO}
        onClose={() => setRangeOpen(false)}
        onApply={(from, to) => {
          setCustomFrom(from);
          setCustomTo(to);
          setPeriod("custom");
          setRangeOpen(false);
        }}
        // Clearing the range hands the screen back to its own period — this month.
        onClear={() => {
          setCustomFrom("");
          setCustomTo("");
          setPeriod("month");
          setRangeOpen(false);
        }}
      />
    </div>
  );
}
