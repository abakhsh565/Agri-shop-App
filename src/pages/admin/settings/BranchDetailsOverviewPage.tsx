import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowLeftRight, Banknote, CalendarClock, ChevronRight,
  CircleDollarSign, HandCoins, Package, TrendingUp, Users,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import PeriodTabs from "@/components/ui/PeriodTabs";
import BranchKindChip from "@/components/ui/BranchKindChip";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useShopStore } from "@/stores/shopStore";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { branchKind } from "@/lib/branchKind";
import { formatCurrency, getStockStatus, productLowStockThreshold } from "@/lib/formatters";
import { summariseSales, profitDisplay, type LiveCostLookup } from "@/lib/profit";
import { computeOverdueCreditTotal, EXPIRY_WARNING_DAYS } from "@/lib/signalEngine";
import { pkDateFromISO, pkMonthStart, pkToday, pkWeekStart } from "@/lib/pkDate";

/** The three presets, plus the hand-picked window the filter opens. */
type Preset = "today" | "week" | "month";
type Period = Preset | "custom";

/**
 * The Business Overview screen as it stood when "Branch details" was pointed at it (owner's
 * instruction, 2026-10-28: duplicate the screen, then redesign the original). It is kept whole
 * and unimproved on purpose — it is the screen the owner asked to keep, and the redesigned
 * overview next to it is a different screen with different questions.
 *
 * The whole business in one screen, as four questions an owner actually opens the app with:
 *
 *   1. Is the business growing and making a profit?   → Business performance
 *   2. How much am I owed, how much do I owe, and what money came in?
 *                                                     → Financial position
 *   3. What is running out, expiring, or tying up my money?
 *                                                     → Inventory & stock health
 *   4. Who needs attention today?                     → Business attention
 *
 * EVERY NUMBER IS THE NUMBER THE REST OF THE APP SHOWS, because it is computed by the same
 * code: profit by `lib/profit` (an unknown cost is never a zero cost), overdue credit by
 * `computeOverdueCreditTotal` (the S1 rule), stock status by the same threshold helper the
 * inventory screens use, and the expiry window by `EXPIRY_WARNING_DAYS` (the S9 rule).
 *
 * ONE BRANCH AT A TIME. Every figure here belongs to the branch this account is working in,
 * because that is the only branch the loaded stores hold — and because branches never share a
 * ledger (0233/0234/0241). The swap control in the header changes the branch for the whole
 * page; nothing here adds two branches together, which is what an "all branches" total would
 * silently do to stock and receivables that are not fungible.
 *
 * Period applies to the things that happen IN a period (sales, profit, money taken). A standing
 * balance — what customers owe, what suppliers are owed — is labelled as one, so nothing on
 * this screen reads as "earned today" when it is "owed now".
 */
export default function BranchDetailsOverviewPage() {
  const t = useT();
  const navigate = useNavigate();
  const base = useShellBase();

  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const openSwitcher = useShopStore((s) => s.openSwitcher);
  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const kind = branchKind(t, activeBranch?.isMain);
  const activeShopName = useShopStore((s) => s.activeShopName);
  const [rangeOpen, setRangeOpen] = useState(false);

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

  const [period, setPeriod] = useState<Period>("today");
  // A hand-picked range, both ends YYYY-MM-DD in Pakistan time. Neither end is allowed into
  // the future: the ledger has no rows there, so a future date could only widen a window that
  // is already empty while making the figures look like they cover more than they do.
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  // Each store is asked for its rows only if it has none: the shell may already have loaded
  // them, and re-reading on every visit would be four needless round trips.
  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);
  useEffect(() => {
    if (!salesReady) void loadSales();
  }, [salesReady, loadSales]);
  useEffect(() => {
    if (!productsReady) void loadProducts();
  }, [productsReady, loadProducts]);
  useEffect(() => {
    if (!customersReady) void loadCustomers();
  }, [customersReady, loadCustomers]);
  useEffect(() => {
    if (!companiesReady) void loadCompanies();
  }, [companiesReady, loadCompanies]);

  const ready = salesReady && productsReady && customersReady && companiesReady;

  const todayISO = pkToday();
  // The window every period figure is measured over. A preset ends today; a hand-picked range
  // ends no later than today. A range whose start was left empty falls back to this month so
  // the tiles never read as "all time" without saying so.
  const rangeFrom =
    period === "custom"
      ? customFrom || pkMonthStart()
      : period === "today" ? todayISO : period === "week" ? pkWeekStart() : pkMonthStart();
  const rangeTo = period === "custom" ? customTo || todayISO : todayISO;
  const inPeriod = (iso: string) => {
    const day = pkDateFromISO(iso);
    return day >= rangeFrom && day <= rangeTo;
  };

  const periodSales = useMemo(
    () => sales.filter((sale) => !sale.isVoided && inPeriod(sale.createdAt)),
    // The window is derived from `period`, `customFrom` and `customTo`; all three are captured
    // by the filter above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sales, period, customFrom, customTo],
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

  const totalSales = periodSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const cashTaken = periodSales.reduce((sum, sale) => sum + sale.amountPaid, 0);
  const overdueCredit = computeOverdueCreditTotal(customers);
  const supplierPayables = companies.reduce((sum, company) => sum + company.outstandingPayable, 0);
  const customerCredit = activeBranch?.creditOutstanding ?? null;
  const inventoryValue = activeBranch?.inventoryValue ?? null;
  const inventoryIncomplete = activeBranch?.inventoryCostIncomplete === true;

  // Stock health is a current fact, not a period figure: counted per product with the same
  // threshold rule the inventory screens use.
  const lowOrOut = products.filter(
    (product) => getStockStatus(product.stockQty, productLowStockThreshold(product.variants)) !== "in_stock",
  ).length;

  // Expiry: any pack inside the S9 window (including already expired). Counted in products, the
  // unit a shopkeeper acts on, not in packs.
  const expiring = products.filter((product) =>
    (product.variants ?? []).some((variant) => {
      if (!variant.expiryDate) return false;
      const days = Math.round((Date.parse(pkDateFromISO(variant.expiryDate)) - Date.parse(todayISO)) / 86400000);
      return days <= EXPIRY_WARNING_DAYS;
    }),
  ).length;

  const money = (value: number | null, floor = false) =>
    value == null ? "—" : `${floor ? "≥ " : ""}${formatCurrency(value)}`;

  const profitValue = profit.kind === "unknown" ? "—" : money(profit.amount, profit.kind === "atLeast");
  const profitHint = profit.kind === "unknown"
    ? t("profit.addCostToSeeProfit")
    : profit.kind === "atLeast"
      ? t("profit.costMissingOn", { count: profit.unknownLines })
      : t("overview.netProfitHint");

  const periodOptions: { key: Preset; label: string }[] = [
    { key: "today", label: t("sales.today") },
    { key: "week", label: t("sales.thisWeek") },
    { key: "month", label: t("sales.thisMonth") },
  ];

  const businessName = activeShopName ?? activeBranch?.name ?? t("audit.noBranch");

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="branch-details-page">
      <StatusBar />
      {/* One step back, to the Branches section screen. This is the frozen copy of the Business
          Overview design that "Branch details" opens: the redesigned overview is a separate
          screen, so nothing here moves when that one is reworked. */}
      <NavHeader title={t("overview.cardTitle")} backTo={`${base}/settings/hub/branches`} />

      {/* The panel's own heading, then whose business is being reported, which branch of it, and
          the one control that moves the whole page to another one. The quiet line under the name
          says what the rest of the screen is for. */}
      <div className="px-5 pt-4 pb-3" data-testid="overview-identity">
        <h1 className="text-22 font-bold" data-testid="overview-heading">{t("overview.title")}</h1>

        <div className="flex items-center gap-2 mt-3">
          <p className="text-16 font-semibold truncate min-w-0" data-testid="overview-business-name">
            {businessName}
          </p>
          {kind && <BranchKindChip isMain={Boolean(activeBranch?.isMain)} label={kind} />}
          <button
            type="button"
            onClick={() => openSwitcher()}
            aria-label={t("overview.switchBranch")}
            data-testid="overview-switch-branch"
            className="ms-auto h-8 ps-2.5 pe-3 rounded-full flex items-center gap-1.5 shrink-0 ds-pressable text-12 font-semibold"
            style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
          >
            <ArrowLeftRight size={13} />
            {t("overview.switchBranch")}
          </button>
        </div>

        <p className="text-13 mt-1.5" style={{ color: "var(--text-secondary)" }}>
          {t("overview.subtitle")}
        </p>
      </div>

      <div style={{ borderTop: "1px solid var(--divider)" }} />

      {/* The period, straight on the page. The tab is the app's one period tab; the filter opens
          the From/To sheet for a window the presets cannot express. */}
      <div className="px-4 pt-3.5">
        <PeriodTabs
          options={periodOptions}
          value={period === "custom" ? null : period}
          onChange={(key) => setPeriod(key)}
          onFilter={() => setRangeOpen(true)}
          filterActive={period === "custom"}
          label={t("overview.periodLabel")}
          filterLabel={t("admin.selectDateRange")}
          testIdPrefix="overview-period"
        />
      </div>

      {!ready ? (
        <div className="px-4 pt-3.5"><SkeletonList rows={5} /></div>
      ) : (
        <>
          {/* 1 — Is the business growing and making a profit? */}
          <section className="px-4 pt-4" data-testid="overview-performance">
            <p className="ds-section px-1 mb-2">{t("overview.performance")}</p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => navigate(`${base}/reports`)}
                data-testid="overview-total-sales"
                className="rounded-[var(--radius-card)] p-4 text-start ds-pressable"
                style={{ background: "var(--tone-card)" }}
              >
                <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("overview.totalSales")}</p>
                <p className="text-18 font-bold mt-1 tabular-nums break-words">{money(totalSales)}</p>
                <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>{t("overview.selectedPeriod")}</p>
              </button>
              <button
                type="button"
                onClick={() => navigate(`${base}/reports`)}
                data-testid="overview-net-profit"
                className="rounded-[var(--radius-card)] p-4 text-start ds-pressable"
                style={{ background: "var(--tone-card)" }}
              >
                <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("overview.netProfit")}</p>
                <p className="text-18 font-bold mt-1 tabular-nums break-words">{profitValue}</p>
                <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>{profitHint}</p>
              </button>
              <button
                type="button"
                onClick={() => navigate(`${base}/customers`)}
                data-testid="overview-customer-credit"
                className="rounded-[var(--radius-card)] p-4 text-start ds-pressable"
                style={{ background: "var(--tone-card)" }}
              >
                <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("overview.customerCredit")}</p>
                <p className="text-18 font-bold mt-1 tabular-nums break-words">{money(customerCredit)}</p>
                <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>{t("overview.receivables")}</p>
              </button>
              <button
                type="button"
                onClick={() => navigate(`${base}/purchases`)}
                data-testid="overview-supplier-payables"
                className="rounded-[var(--radius-card)] p-4 text-start ds-pressable"
                style={{ background: "var(--tone-card)" }}
              >
                <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("overview.supplierPayables")}</p>
                <p className="text-18 font-bold mt-1 tabular-nums break-words">{money(supplierPayables)}</p>
                <p className="text-11 mt-1" style={{ color: "var(--text-tertiary)" }}>{t("overview.payablesHint")}</p>
              </button>
            </div>
          </section>

          {/* 2 — How much am I owed, how much do I owe, what money came in? */}
          <section className="px-4 pt-4" data-testid="overview-financial">
            <ListCard section={t("overview.financial")}>
              <ListRow
                icon={Banknote}
                title={t("overview.cash")}
                meta={t("overview.cashHint")}
                onClick={() => navigate(`${base}/reports`)}
                testId="overview-cash"
                trailing={<span className="ds-row-value shrink-0">{money(cashTaken)}</span>}
              />
              <ListRow
                icon={HandCoins}
                title={t("overview.overdueCredit")}
                meta={t("overview.attentionOverdueHint")}
                onClick={() => navigate(`${base}/customers`)}
                testId="overview-overdue-credit"
                trailing={<span className="ds-row-value shrink-0">{money(overdueCredit)}</span>}
              />
              <ListRow
                icon={CircleDollarSign}
                title={t("overview.supplierOutstanding")}
                onClick={() => navigate(`${base}/purchases`)}
                testId="overview-supplier-outstanding"
                trailing={<span className="ds-row-value shrink-0">{money(supplierPayables)}</span>}
              />
            </ListCard>
          </section>

          {/* 3 — What is running out, expiring, or tying up money? */}
          <section className="px-4 pt-4" data-testid="overview-stock">
            <ListCard section={t("overview.stock")}>
              <ListRow
                icon={Package}
                title={t("overview.inventoryValue")}
                onClick={() => navigate(`${base}/products`)}
                testId="overview-inventory-value"
                trailing={<span className="ds-row-value shrink-0">{money(inventoryValue, inventoryIncomplete)}</span>}
              />
              <ListRow
                icon={AlertTriangle}
                title={t("overview.lowOut")}
                onClick={() => navigate(`${base}/products`)}
                testId="overview-low-stock"
                trailing={<span className="ds-row-value shrink-0">{lowOrOut.toLocaleString("en-PK")}</span>}
              />
              <ListRow
                icon={CalendarClock}
                title={t("overview.expiring")}
                meta={t("overview.withinDays", { days: EXPIRY_WARNING_DAYS })}
                onClick={() => navigate(`${base}/products`)}
                testId="overview-expiring"
                trailing={<span className="ds-row-value shrink-0">{expiring.toLocaleString("en-PK")}</span>}
              />
            </ListCard>
          </section>

          {/* 4 — Who needs attention today? Each row is the way to the records behind it. */}
          <section className="px-4 pt-4 pb-8" data-testid="overview-attention">
            <ListCard section={t("overview.attention")}>
              <ListRow
                icon={Users}
                title={t("overview.attentionOverdue")}
                meta={t("overview.attentionOverdueHint")}
                onClick={() => navigate(`${base}/customers`)}
                testId="overview-attention-overdue"
                trailing={
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="ds-row-value">{money(overdueCredit)}</span>
                    <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                  </span>
                }
              />
              <ListRow
                icon={TrendingUp}
                title={t("overview.attentionPerformance")}
                meta={t("overview.attentionPerformanceHint")}
                onClick={() => navigate(`${base}/reports`)}
                testId="overview-attention-performance"
                trailing={
                  <span className="flex items-center gap-1.5 shrink-0">
                    <span className="ds-row-value">{money(totalSales)}</span>
                    <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />
                  </span>
                }
              />
            </ListCard>
          </section>
        </>
      )}

      {/* The hand-picked window. Applying it is what selects it, so the strip and the figures
          can never disagree about what is being shown. */}
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
        onClear={() => {
          setCustomFrom("");
          setCustomTo("");
          setPeriod("today");
          setRangeOpen(false);
        }}
      />
    </div>
  );
}
