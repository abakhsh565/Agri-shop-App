import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle, ArrowLeftRight, Banknote, CalendarClock, Check, ChevronRight,
  CircleDollarSign, Gauge, HandCoins, Loader2, Package, Store, TrendingUp, Users,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useShopStore } from "@/stores/shopStore";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useUIStore } from "@/stores/uiStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { branchKind } from "@/lib/branchKind";
import { formatCurrency, getStockStatus, productLowStockThreshold } from "@/lib/formatters";
import { summariseSales, profitDisplay, type LiveCostLookup } from "@/lib/profit";
import { computeOverdueCreditTotal, EXPIRY_WARNING_DAYS } from "@/lib/signalEngine";
import { pkDateFromISO, pkMonthStart, pkToday, pkWeekStart } from "@/lib/pkDate";

type Period = "today" | "week" | "month";

/**
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
export default function BusinessOverviewPage() {
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
  const switchBranch = useShopStore((s) => s.switchBranch);
  const { addToast } = useUIStore();
  const [switchingId, setSwitchingId] = useState<string | null>(null);

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

  const from = period === "today" ? pkToday() : period === "week" ? pkWeekStart() : pkMonthStart();
  const inPeriod = (iso: string) => pkDateFromISO(iso) >= from;

  const periodSales = useMemo(
    () => sales.filter((sale) => !sale.isVoided && inPeriod(sale.createdAt)),
    // `from` is derived from `period`; both are captured by the filter above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sales, period],
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
  const today = pkToday();
  const expiring = products.filter((product) =>
    (product.variants ?? []).some((variant) => {
      if (!variant.expiryDate) return false;
      const days = Math.round((Date.parse(pkDateFromISO(variant.expiryDate)) - Date.parse(today)) / 86400000);
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

  /** Switch the whole page to another branch, through the one store that owns that fact. */
  async function openBranch(id: string) {
    if (id === activeBranchId || switchingId) return;
    setSwitchingId(id);
    try {
      const result = await switchBranch(id);
      if (!result.ok) addToast(t("shop.switchFailed"), "error");
    } finally {
      setSwitchingId(null);
    }
  }

  const periodOptions: { key: Period; label: string }[] = [
    { key: "today", label: t("sales.today") },
    { key: "week", label: t("sales.thisWeek") },
    { key: "month", label: t("sales.thisMonth") },
  ];

  return (
    <div className="flex flex-col w-full min-h-full" style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="business-overview-page">
      <StatusBar />
      <NavHeader title={t("overview.title")} backTo={`${base}/settings`} />

      {/* The header carries the two things every figure below depends on: which branch, and
          which period. The swap control changes the branch for the whole page. */}
      <div className="px-4 pt-3.5">
        <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--tone-card)" }}>
          <div className="flex items-start gap-3">
            <span className="size-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }} aria-hidden="true">
              <Gauge size={17} />
            </span>
            <div className="flex-1 min-w-0">
              {/* The page's own name is in the bar above; repeating it here would spend the
                  loudest line on a label. The branch is the thing every figure depends on. */}
              <div className="flex items-center gap-1.5 min-w-0">
                <p className="text-16 font-bold truncate" data-testid="overview-branch-name">
                  {activeBranch?.name ?? t("audit.noBranch")}
                </p>
                {kind && (
                  <span className="text-10 font-bold h-5 px-1.5 rounded-full flex items-center shrink-0"
                    style={activeBranch?.isMain
                      ? { background: "var(--brand-light)", color: "var(--brand-dark)" }
                      : { background: "var(--tone-sunken)", color: "var(--text-secondary)" }}>
                    {kind}
                  </span>
                )}
              </div>
              <p className="text-12 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                {t("overview.cardHint")}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openSwitcher()}
              aria-label={t("shop.switch")}
              data-testid="overview-switch-branch"
              className="size-9 rounded-full flex items-center justify-center shrink-0 ds-pressable"
              style={{ background: "var(--tone-sunken)" }}
            >
              <ArrowLeftRight size={15} />
            </button>
          </div>

          <div className="flex gap-1 p-1 rounded-full mt-3" style={{ background: "var(--surface-2)" }}
            role="group" aria-label={t("overview.periodLabel")}>
            {periodOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setPeriod(option.key)}
                aria-pressed={period === option.key}
                data-testid={`overview-period-${option.key}`}
                className="flex-1 h-8 rounded-full text-12 font-semibold transition-colors"
                style={{
                  background: period === option.key ? "var(--brand-light)" : "transparent",
                  color: period === option.key ? "var(--brand-dark)" : "var(--text-secondary)",
                }}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
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

          {/* Branch performance: every branch side by side, with the figures the server keeps
              per branch. Tapping one switches the page to it — the same act as the swap control
              in the header, offered where the comparison is being made. */}
          {branches.length > 1 && (
            <section className="px-4 pt-4" data-testid="overview-branches">
              <ListCard section={t("overview.branchPerformance")}>
                {branches.map((branch) => {
                  const branchIsCurrent = branch.id === activeBranchId;
                  const branchFigure = branch.salesTotal == null ? "—" : formatCurrency(branch.salesTotal);
                  return (
                    <ListRow
                      key={branch.id}
                      testId={`overview-branch-${branch.id}`}
                      icon={Store}
                      title={branch.name}
                      qualifier={branchKind(t, branch.isMain) ?? undefined}
                      meta={t("overview.salesOnRecord")}
                      onClick={() => void openBranch(branch.id)}
                      trailing={
                        switchingId === branch.id
                          ? <Loader2 size={14} className="animate-spin shrink-0" />
                          : (
                            <span className="flex items-center gap-1.5 shrink-0">
                              <span className="ds-row-value">{branchFigure}</span>
                              {branchIsCurrent
                                ? <Check size={14} style={{ color: "var(--brand-dark)" }} />
                                : <ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
                            </span>
                          )
                      }
                    />
                  );
                })}
                <ListRow
                  title={t("common.viewAll")}
                  onClick={() => navigate(`${base}/settings/profile`)}
                  testId="overview-branches-all"
                  trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
                />
              </ListCard>
            </section>
          )}

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
    </div>
  );
}
