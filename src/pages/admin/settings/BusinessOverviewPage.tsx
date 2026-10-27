import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDownRight, ArrowUpRight, BarChart3, Building2, CalendarDays, ChevronRight, GitBranch,
  TrendingUp, Users, Wallet,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useShopStore } from "@/stores/shopStore";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { formatCurrency } from "@/lib/formatters";
import { summariseSales, profitDisplay, type LiveCostLookup } from "@/lib/profit";
import { computeOverdueCreditTotal } from "@/lib/signalEngine";
import { pkDateFromISO, pkMonthStart, pkToday, pkWeekStart } from "@/lib/pkDate";

/**
 * The whole business in one screen — "Overall business performance".
 *
 * Four blocks, in the order an owner asks the questions:
 *
 *   1. Business overview            what came in, what was made, what is owed either way
 *   2. Sales and profit trends      how this window compares with the one before it, week for week
 *   3. Branch performance           the same comparison across the branches this account may see
 *   4. Customer and supplier balances  the two standing balances, kept apart
 *
 * EVERY NUMBER IS THE NUMBER THE REST OF THE APP SHOWS. Profit is `lib/profit`'s (an unknown cost
 * is never a zero cost), overdue credit is the S1 rule (`computeOverdueCreditTotal`), the branch
 * figures are the ones `get_my_branches()` already publishes per branch — sales to date and the
 * credit that branch is owed — and nothing here adds two branches together where the app refuses
 * to: the branch rows are each branch's own ledger, read through the one call that may see every
 * branch the account is a member of.
 *
 * NO ILLUSTRATIVE FIGURES ANYWHERE. Where a figure is not available to this account it reads "—";
 * where a comparison has nothing to compare against (a previous period with no sales) the change
 * is not shown at all rather than printed as an infinite gain.
 */

/** The three presets, plus the hand-picked window the calendar opens. */
type Preset = "today" | "week" | "month";
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

/** A bucket's start, as a reader would say it: "12 Oct". */
function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}

/**
 * The change against the previous window, or `null` when there is nothing honest to say.
 *
 * A previous window of zero sales has no percentage: any number printed over it would be a
 * division by nothing dressed up as growth. `null` draws no change line at all.
 */
function changePct(current: number, previous: number): number | null {
  if (!(previous > 0)) return null;
  return ((current - previous) / previous) * 100;
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
  const activeShopName = useShopStore((s) => s.activeShopName);

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
      ? customFrom || pkMonthStart()
      : period === "today" ? todayISO : period === "week" ? pkWeekStart() : pkMonthStart();
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
  const customerCredit = activeBranch?.creditOutstanding ?? null;
  const supplierPayables = companies.reduce((sum, company) => sum + company.outstandingPayable, 0);
  const overdueCredit = computeOverdueCreditTotal(customers);

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

  /**
   * The four parts of the window, each against the same part of the window before it.
   *
   * The window is divided into four — the month's four weeks, a custom range's four quarters —
   * and a window shorter than four days is one part rather than four slivers. Each part carries
   * its own previous-period figure, which is what makes the pair of bars a comparison rather
   * than two unrelated numbers.
   */
  const buckets = useMemo(() => {
    const count = windowDays >= 4 ? 4 : 1;
    const span = Math.ceil(windowDays / count);
    return Array.from({ length: count }, (_, i) => {
      const start = shiftDays(rangeFrom, i * span);
      const end = [shiftDays(start, span - 1), rangeTo].sort()[0];
      const prevStart = shiftDays(start, -windowDays);
      const prevEnd = shiftDays(end, -windowDays);
      return {
        key: start,
        label: count === 1 ? shortDay(rangeFrom) : t("overall.week", { n: i + 1 }),
        current: salesIn(start, end),
        previous: salesIn(prevStart, prevEnd),
      };
    });
  }, [rangeFrom, rangeTo, windowDays, salesIn, t]);

  // The tallest bar owns the scale, so every other bar is a share of it; a floor keeps an empty
  // period visible as a line rather than as nothing.
  const barMax = Math.max(0, ...buckets.flatMap((b) => [b.current, b.previous]));

  const periodLabel =
    period === "today" ? t("sales.today")
    : period === "week" ? t("sales.thisWeek")
    : period === "month" ? t("sales.thisMonth")
    : t("overall.custom");

  const scopeLine = `${activeBranch?.name ?? activeShopName ?? ""} · PKR`;
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
      <div data-testid={testId}>
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>{label}</p>
        <p className="text-18 font-bold mt-1 tabular-nums break-words">{value}</p>
        {change != null ? (
          <p
            className="text-11 mt-1 flex items-center gap-1 tabular-nums"
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
      <NavHeader title={t("overall.title")} backTo={`${base}/settings/hub/overview`} />

      {!ready ? (
        <SkeletonList rows={6} />
      ) : (
        <div className="px-4 pt-2 pb-8 flex flex-col gap-3.5">
          {/* ── 1. Business overview ─────────────────────────────────────────────────────
              The four figures the owner opens with, each labelled with what it is: two are
              period figures and carry their change, two are standing balances and say so. */}
          <section
            className="rounded-[var(--radius-card)] p-4"
            style={{ background: "var(--tone-card)" }}
            data-testid="overall-summary"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="text-16 font-bold" data-testid="overall-scope-title">{t("overview.title")}</h1>
                <p className="text-12 mt-1 truncate" style={{ color: "var(--text-secondary)" }} data-testid="overall-scope">
                  {scopeLine}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRangeOpen(true)}
                data-testid="overall-period"
                className="shrink-0 flex flex-col items-center gap-1 rounded-[var(--radius-control)] px-2.5 py-1.5 active:opacity-60"
                style={{ background: "var(--surface-2)" }}
              >
                <CalendarDays size={18} style={{ color: "var(--text-primary)" }} />
                <span className="text-11" style={{ color: "var(--text-secondary)" }}>{periodLabel}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-4 mt-5">
              <Figure
                testId="overall-net-sales"
                label={t("overall.netSales")}
                value={money(totalSales)}
                change={salesChange}
                note={t("overview.selectedPeriod")}
              />
              <Figure
                testId="overall-net-profit"
                label={t("overview.netProfit")}
                value={profitValue}
                change={profitChange}
                note={profitHint}
              />
              <Figure
                testId="overall-receivables"
                label={t("overall.receivables")}
                value={money(customerCredit)}
                note={t("overall.outstandingBalance")}
              />
              <Figure
                testId="overall-payables"
                label={t("overall.supplierPayables")}
                value={money(supplierPayables)}
                note={t("overall.outstandingBalance")}
              />
            </div>
          </section>

          {/* ── 2. Sales and profit trends ───────────────────────────────────────────────
              Four pairs of bars: this window's part against the same part of the last one. */}
          <section
            className="rounded-[var(--radius-card)] p-4"
            style={{ background: "var(--tone-card)" }}
            data-testid="overall-trends"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-16 font-bold">{t("overall.trends")}</h2>
                <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>{t("overall.trendsHint")}</p>
              </div>
              <TrendingUp size={18} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
            </div>

            <div className="flex items-baseline justify-between mt-4">
              <span className="text-12" style={{ color: "var(--text-secondary)" }}>{t("overall.netSales")}</span>
              <span className="text-14 font-bold tabular-nums">{money(totalSales)}</span>
            </div>

            <div className="mt-3 flex items-end gap-2 h-24" data-testid="overall-trend-bars">
              {buckets.map((bucket) => (
                <div key={bucket.key} className="flex-1 flex items-end justify-center gap-1">
                  <div
                    className="w-2.5 rounded-t-[3px]"
                    style={{
                      height: `${barMax ? Math.max(4, (bucket.previous / barMax) * 100) : 4}%`,
                      background: "var(--muted)",
                    }}
                  />
                  <div
                    className="w-2.5 rounded-t-[3px]"
                    style={{
                      height: `${barMax ? Math.max(4, (bucket.current / barMax) * 100) : 4}%`,
                      background: "var(--brand)",
                    }}
                  />
                </div>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              {buckets.map((bucket) => (
                <span
                  key={bucket.key}
                  className="flex-1 text-11 text-center truncate"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {bucket.label}
                </span>
              ))}
            </div>
            {barMax === 0 && (
              <p className="text-11 mt-2" style={{ color: "var(--text-tertiary)" }}>{t("overall.noSales")}</p>
            )}
          </section>

          {/* ── 3. Branch performance ────────────────────────────────────────────────────
              Every branch this account may see, with that branch's own ledger: the sales it has
              billed and what it is still owed. The bar is each branch's share of the busiest
              branch's sales — a real ratio between the rows on this card. */}
          <section
            className="rounded-[var(--radius-card)] p-4"
            style={{ background: "var(--tone-card)" }}
            data-testid="overall-branches"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-16 font-bold">{t("overall.branchPerformance")}</h2>
                <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>{t("overall.branchHint")}</p>
              </div>
              <GitBranch size={18} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
            </div>

            <div className="mt-3 flex flex-col gap-2.5">
              {branchRows.map((branch) => (
                <button
                  key={branch.id}
                  type="button"
                  onClick={() => navigate(`${base}/settings/branches/${branch.id}`)}
                  data-testid={`overall-branch-${branch.id}`}
                  className="text-start rounded-[var(--radius-card)] p-3 active:opacity-70"
                  style={{ background: "var(--surface-2)" }}
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
                      <p className="text-14 font-bold tabular-nums">{money(branch.salesToDate)}</p>
                    </div>
                    <div className="min-w-0 text-end">
                      <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("overall.outstandingCredit")}</p>
                      <p className="text-14 font-bold tabular-nums">{money(branch.credit)}</p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${branchSalesMax ? ((branch.salesToDate ?? 0) / branchSalesMax) * 100 : 0}%`,
                        background: "var(--brand)",
                      }}
                    />
                  </div>
                </button>
              ))}
            </div>

            <p className="text-11 mt-3" style={{ color: "var(--text-tertiary)" }}>{t("overall.branchFooter")}</p>
          </section>

          {/* ── 4. Customer and supplier balances ───────────────────────────────────────
              Two separate balances, never netted. The receivables bar is the overdue share of
              them — a real part of a real total; payables has no ageing to divide, so it carries
              its amount and no invented bar. */}
          <section
            className="rounded-[var(--radius-card)] p-4"
            style={{ background: "var(--tone-card)" }}
            data-testid="overall-balances"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-16 font-bold">{t("overall.balances")}</h2>
                <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>{t("overall.balancesHint")}</p>
              </div>
              <Wallet size={18} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
            </div>

            <div className="mt-4" data-testid="overall-receivables-row">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-14">{t("overall.receivables")}</span>
                <span className="text-14 font-bold tabular-nums">{money(customerCredit)}</span>
              </div>
              <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{t("overall.oweYou")}</p>
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${customerCredit && customerCredit > 0
                      ? Math.min(100, (overdueCredit / customerCredit) * 100) : 0}%`,
                    background: "var(--brand)",
                  }}
                />
              </div>
              {overdueCredit > 0 && (
                <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>
                  {t("overall.overdue", { amount: formatCurrency(overdueCredit) })}
                </p>
              )}
            </div>

            <div className="mt-4" data-testid="overall-payables-row">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-14">{t("overall.supplierPayables")}</span>
                <span className="text-14 font-bold tabular-nums">{money(supplierPayables)}</span>
              </div>
              <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>{t("overall.youOwe")}</p>
            </div>

            <p className="text-11 mt-4" style={{ color: "var(--text-tertiary)" }}>{t("overall.balancesNote")}</p>
          </section>

          {/* ── 5. Detailed reports ──────────────────────────────────────────────────────
              The way into the reports themselves. Each row opens the screen that owns that
              work today — the reports screen for sales, profit and branches, the customer and
              supplier ledgers for the two balance reports — so nothing here is a second copy.

              The rows wear the app's own list grammar but sit *inside* this card (`plain`), so
              the separators span the block instead of drawing a box within a box. */}
          <section
            className="rounded-[var(--radius-card)] p-4"
            style={{ background: "var(--tone-card)" }}
            data-testid="overall-reports"
          >
            <h2 className="text-16 font-bold">{t("overall.reports")}</h2>
            <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>{t("overall.reportsHint")}</p>
            <div className="mt-3 -mx-4">
              <ListCard variant="plain">
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
                  onClick={() => navigate(`${base}/customers`)}
                  trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
                />
                <ListRow
                  icon={Building2}
                  testId="report-supplier-balances"
                  title={t("overall.reportSuppliers")}
                  meta={t("overall.reportSuppliersHint")}
                  onClick={() => navigate(`${base}/companies`)}
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
              </ListCard>
            </div>
          </section>
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
        // Clearing the range hands the screen back to its own period — this month, which is the
        // window the screen opens on.
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
