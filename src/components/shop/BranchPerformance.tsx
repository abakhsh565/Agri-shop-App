import { useEffect, useMemo, useState } from "react";
import PeriodTabs from "@/components/ui/PeriodTabs";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useT } from "@/lib/i18n";
import { formatCurrency, getStockStatus, productLowStockThreshold } from "@/lib/formatters";
import { summariseSales, profitDisplay, type LiveCostLookup } from "@/lib/profit";
import { EXPIRY_WARNING_DAYS } from "@/lib/signalEngine";
import { pkDateFromISO, pkMonthStart, pkToday, pkWeekStart } from "@/lib/pkDate";
import type { BranchSummary } from "@/stores/shopStore";

/** The three presets, plus the hand-picked window the filter opens. */
type Preset = "today" | "week" | "month";
type Period = Preset | "custom";

/**
 * What this branch is doing, in the two states this app can honestly measure it.
 *
 * A branch's figures fall into exactly two kinds, and the card never mixes them without saying
 * which one is on screen:
 *
 *   1. **The branch this account is WORKING IN.** The loaded ledger IS this branch's — sales,
 *      products, supplier books and stock all belong to it (branches never share a ledger, 0233 /
 *      0234 / 0241) — so the period is the reader's to choose and the figures are the same ones
 *      the Business Overview and the reports show, computed by the same code: profit through
 *      `lib/profit` (an unknown cost is never a zero cost), stock health through the threshold
 *      helper the inventory screens use, expiry through the S9 window.
 *   2. **Any other branch.** Only the branch read's own lifetime figures exist for it — sales to
 *      date, what it is owed, what its stock is worth. There is no period for a branch you are
 *      not working in, and no per-branch profit or stock health in any read, so the card says
 *      "All Time" and shows those three instead of inventing a window the data does not have.
 *
 * A figure the account may not read arrives as `null` from the branch read and is drawn as "—",
 * never as zero: a hidden number and a real zero look identical otherwise.
 *
 * This is a SUMMARY on the branch's own page, not a report — the page's rows are the way to the
 * report screens, which is where the full set of figures belongs.
 */
export default function BranchPerformance({ branch }: { branch: BranchSummary }) {
  const t = useT();
  const isCurrent = branch.isCurrent;

  const sales = useSalesStore((s) => s.sales);
  const salesReady = useSalesStore((s) => s.ready);
  const loadSales = useSalesStore((s) => s.load);
  const products = useProductsStore((s) => s.products);
  const productsReady = useProductsStore((s) => s.ready);
  const loadProducts = useProductsStore((s) => s.load);
  const companies = useCompaniesStore((s) => s.companies);
  const companiesReady = useCompaniesStore((s) => s.ready);
  const loadCompanies = useCompaniesStore((s) => s.load);

  const [period, setPeriod] = useState<Period>("month");
  // A hand-picked range, both ends YYYY-MM-DD in Pakistan time. Neither end may be in the future:
  // the ledger has no rows there, so a future date could only widen an already empty window.
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);

  // Nothing is read for a branch this account is not working in: those three figures already
  // travelled with the branch row, and loading the shop's ledgers to show another branch's
  // numbers would be exactly the mistake this card is written to avoid.
  useEffect(() => {
    if (!isCurrent) return;
    if (!salesReady) void loadSales();
  }, [isCurrent, salesReady, loadSales]);
  useEffect(() => {
    if (!isCurrent) return;
    if (!productsReady) void loadProducts();
  }, [isCurrent, productsReady, loadProducts]);
  useEffect(() => {
    if (!isCurrent) return;
    if (!companiesReady) void loadCompanies();
  }, [isCurrent, companiesReady, loadCompanies]);

  const todayISO = pkToday();
  const rangeFrom =
    period === "custom"
      ? customFrom || pkMonthStart()
      : period === "today" ? todayISO : period === "week" ? pkWeekStart() : pkMonthStart();
  const rangeTo = period === "custom" ? customTo || todayISO : todayISO;

  const periodSales = useMemo(() => {
    const inPeriod = (iso: string) => {
      const day = pkDateFromISO(iso);
      return day >= rangeFrom && day <= rangeTo;
    };
    return sales.filter((sale) => !sale.isVoided && inPeriod(sale.createdAt));
    // The window is derived from `period`, `customFrom` and `customTo`; all three are captured by
    // `rangeFrom`/`rangeTo` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, period, customFrom, customTo]);

  // A line written before cost snapshots existed is priced at today's cost — the same fallback
  // `lib/profit` uses everywhere else, so this card cannot invent a different margin.
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
  const periodTotal = periodSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const supplierPayables = companies.reduce((sum, company) => sum + company.outstandingPayable, 0);

  // Stock health is a current state, not a period figure: counted per product, with the same
  // threshold rule the inventory screens use and the same expiry window the alerts use.
  const health = useMemo(() => {
    let low = 0;
    let out = 0;
    let expiring = 0;
    for (const product of products) {
      const status = getStockStatus(product.stockQty, productLowStockThreshold(product.variants));
      if (status === "out_of_stock") out += 1;
      else if (status === "low_stock") low += 1;
      if (
        (product.variants ?? []).some((variant) => {
          if (!variant.expiryDate) return false;
          const days = Math.round(
            (Date.parse(pkDateFromISO(variant.expiryDate)) - Date.parse(todayISO)) / 86400000,
          );
          return days <= EXPIRY_WARNING_DAYS;
        })
      ) {
        expiring += 1;
      }
    }
    return { low, out, expiring };
  }, [products, todayISO]);

  const money = (value: number | null, floor = false) =>
    value == null ? "—" : `${floor ? "≥ " : ""}${formatCurrency(value)}`;

  const profitValue = profit.kind === "unknown" ? "—" : money(profit.amount, profit.kind === "atLeast");
  const profitHint =
    profit.kind === "unknown"
      ? t("profit.addCostToSeeProfit")
      : profit.kind === "atLeast"
        ? t("profit.costMissingOn", { count: profit.unknownLines })
        : null;

  const periodLabel =
    period === "today" ? t("sales.today")
      : period === "week" ? t("sales.thisWeek")
        : period === "month" ? t("sales.thisMonth")
          : t("admin.customDateRange");

  const periodOptions: { key: Preset; label: string }[] = [
    { key: "today", label: t("sales.today") },
    { key: "week", label: t("sales.thisWeek") },
    { key: "month", label: t("sales.thisMonth") },
  ];

  /** The two figures the branch row itself carries, for a branch this account is not working in. */
  const cardFigures = isCurrent
    ? [
        { id: "sales", label: t("overview.totalSales"), value: money(periodTotal), note: null as string | null },
        { id: "profit", label: t("overview.netProfit"), value: profitValue, note: profitHint },
        { id: "receivables", label: t("overview.customerCredit"), value: money(branch.creditOutstanding), note: null },
        { id: "payables", label: t("overview.supplierPayables"), value: money(supplierPayables), note: null },
      ]
    : [
        { id: "sales", label: t("overall.salesToDate"), value: money(branch.salesTotal), note: null as string | null },
        { id: "receivables", label: t("overview.customerCredit"), value: money(branch.creditOutstanding), note: null },
        {
          id: "inventory",
          label: t("overview.inventoryValue"),
          value: money(branch.inventoryValue, branch.inventoryCostIncomplete),
          note: null,
        },
      ];

  const waiting = isCurrent && !(salesReady && productsReady && companiesReady);

  return (
    <div
      className="rounded-[var(--radius-card)] p-4"
      style={{ background: "var(--tone-card)" }}
      data-testid={`branch-performance-${branch.id}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-14 font-bold truncate" data-testid={`branch-performance-title-${branch.id}`}>
            {t("branchPage.performance", { branch: branch.name })}
          </p>
          <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {isCurrent ? `${periodLabel} · PKR` : `${t("sales.allTime")} · PKR`}
          </p>
        </div>
      </div>

      {/* The period is the reader's only when the branch is the one being worked in — the tab is
          the app's one period control, and it is absent rather than disabled otherwise, because
          there is no window to choose. */}
      {isCurrent && !waiting && (
        <div className="mt-3">
          <PeriodTabs
            options={periodOptions}
            value={period === "custom" ? null : period}
            onChange={(key) => setPeriod(key)}
            onFilter={() => setRangeOpen(true)}
            filterActive={period === "custom"}
            label={t("overview.periodLabel")}
            filterLabel={t("admin.selectDateRange")}
            testIdPrefix={`branch-period-${branch.id}`}
          />
        </div>
      )}

      {waiting ? (
        <div className="mt-3"><SkeletonList rows={2} bare tile={false} /></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4 mt-4">
            {cardFigures.map((figure) => (
              <div className="min-w-0" key={figure.id} data-testid={`branch-figure-${figure.id}-${branch.id}`}>
                <p className="text-12" style={{ color: "var(--text-secondary)" }}>{figure.label}</p>
                <p className="text-18 font-bold mt-1 tabular-nums break-words">{figure.value}</p>
                {figure.note && (
                  <p className="text-11 mt-0.5" style={{ color: "var(--text-tertiary)" }}>{figure.note}</p>
                )}
              </div>
            ))}
          </div>

          {/* Stock health belongs to the branch being worked in, for the same reason the period
              does: it is counted from the products this branch's ledger is loaded into. */}
          {isCurrent ? (
            <div className="mt-4 pt-3.5" style={{ borderTop: "1px solid var(--divider)" }}>
              <p className="text-14 font-bold">{t("branchPage.inventoryHealth")}</p>
              <div className="mt-2.5 flex flex-col gap-2">
                {[
                  { id: "low", label: t("branchPage.lowStock"), count: health.low },
                  { id: "out", label: t("branchPage.outOfStock"), count: health.out },
                  { id: "expiring", label: t("overview.expiring"), count: health.expiring },
                ].map((row) => (
                  <div
                    key={row.id}
                    className="flex items-center justify-between gap-3"
                    data-testid={`branch-health-${row.id}-${branch.id}`}
                  >
                    <p className="text-13" style={{ color: "var(--text-primary)" }}>{row.label}</p>
                    <p className="text-14 font-bold tabular-nums shrink-0">
                      {row.count.toLocaleString("en-PK")}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Said once, where the missing figures would have been: a branch this account is not
               working in has no period and no stock health in any read, so the card is smaller
               rather than padded with numbers that would belong to another branch. */
            <p className="text-11 mt-3.5 pt-3" style={{ color: "var(--text-tertiary)", borderTop: "1px solid var(--divider)" }}>
              {t("branchPage.otherBranchNote")}
            </p>
          )}
        </>
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
