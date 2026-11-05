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
import { pkDateFromISO, pkMonthStart, pkToday } from "@/lib/pkDate";
import type { BranchSummary } from "@/stores/shopStore";

/** The periods a branch is judged over, plus the hand-picked window the filter opens. */
type Period = "month" | "sixMonths" | "year" | "custom";

/**
 * What this branch is doing, laid out as the owner's reference has it.
 *
 * SHAPE (2026-10-28): the period strip first, directly under the branch's identity; then the
 * four money figures in one block — net sales, net profit, customer receivables, supplier
 * payables; then inventory health as its own card. There is no card title above them: the
 * screen is the branch, so "Main Branch performance" repeated what the header already said.
 *
 * THE TWO HONEST STATES STAY. The branch this account is WORKING IN has the loaded ledger, so
 * the period is the reader's to choose and stock health can be counted from real products. Any
 * other branch only has the lifetime figures that travelled with the branch row; it shows those
 * and says why the period and stock card are absent, rather than inventing a window.
 *
 * A figure the account may not read arrives as `null` and is drawn as "—", never as zero.
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
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);

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
  const [thisYear, thisMonth] = todayISO.split("-").map(Number);

  // "6 months" is the six calendar months ending with this one, not 180 days: a month is the
  // unit the ledger and the reports already group by, and a rolling count of days would put a
  // different set of bills in the same tab on two consecutive days.
  const sixMonthStart = new Date(Date.UTC(thisYear, thisMonth - 6, 1))
    .toISOString()
    .slice(0, 10);
  const yearStart = `${thisYear}-01-01`;

  const rangeFrom =
    period === "custom"
      ? customFrom || pkMonthStart()
      : period === "sixMonths"
        ? sixMonthStart
        : period === "year"
          ? yearStart
          : pkMonthStart();
  const rangeTo = period === "custom" ? customTo || todayISO : todayISO;

  const periodSales = useMemo(() => {
    const inPeriod = (iso: string) => {
      const day = pkDateFromISO(iso);
      return day >= rangeFrom && day <= rangeTo;
    };
    return sales.filter((sale) => !sale.isVoided && inPeriod(sale.createdAt));
    // The window is derived from `period`, `customFrom` and `customTo`; all three are captured
    // by `rangeFrom`/`rangeTo` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales, period, customFrom, customTo]);

  const liveCost: LiveCostLookup = useMemo(() => {
    const byVariant = new Map<string, number>();
    for (const product of products) {
      for (const variant of product.variants ?? []) {
        if (variant.costPrice > 0) byVariant.set(variant.id, variant.costPrice);
      }
    }
    return (variantId) => (variantId ? byVariant.get(variantId) : undefined);
  }, [products]);

  const profit = useMemo(
    () => profitDisplay(summariseSales(periodSales, liveCost)),
    [periodSales, liveCost],
  );
  const periodTotal = periodSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const supplierPayables = companies.reduce((sum, company) => sum + company.outstandingPayable, 0);

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

  const periodOptions: { key: Exclude<Period, "custom">; label: string }[] = [
    { key: "month", label: t("branchPage.thisMonth") },
    { key: "sixMonths", label: t("branchPage.sixMonths") },
    { key: "year", label: t("branchPage.thisYear") },
  ];

  const figures = isCurrent
    ? [
        { id: "sales", label: t("branchPage.netSales"), value: money(periodTotal), note: null as string | null },
        { id: "profit", label: t("overview.netProfit"), value: profitValue, note: profitHint },
        { id: "receivables", label: t("branchPage.customerReceivables"), value: money(branch.creditOutstanding), note: null },
        { id: "payables", label: t("overview.supplierPayables"), value: money(supplierPayables), note: null },
      ]
    : [
        { id: "sales", label: t("overall.salesToDate"), value: money(branch.salesTotal), note: null as string | null },
        { id: "receivables", label: t("branchPage.customerReceivables"), value: money(branch.creditOutstanding), note: null },
        {
          id: "inventory",
          label: t("overview.inventoryValue"),
          value: money(branch.inventoryValue, branch.inventoryCostIncomplete),
          note: null,
        },
      ];

  const waiting = isCurrent && !(salesReady && productsReady && companiesReady);

  return (
    <div data-testid={`branch-performance-${branch.id}`}>
      {isCurrent && (
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
      )}

      {waiting ? (
        <div className="mt-3">
          <SkeletonList rows={2} bare tile={false} />
        </div>
      ) : (
        <>
          <div
            className={`${isCurrent ? "mt-3" : ""} rounded-[var(--radius-card)] p-4`}
            style={{ background: "var(--tone-card)" }}
          >
            <div className="grid grid-cols-2 gap-x-4 gap-y-5">
              {figures.map((figure) => (
                <div className="min-w-0" key={figure.id} data-testid={`branch-figure-${figure.id}-${branch.id}`}>
                  <p className="text-12" style={{ color: "var(--text-secondary)" }}>{figure.label}</p>
                  <p className="text-18 font-bold mt-1 tabular-nums break-words">{figure.value}</p>
                  {figure.note && (
                    <p className="text-11 mt-0.5" style={{ color: "var(--text-tertiary)" }}>{figure.note}</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          {isCurrent ? (
            <div
              className="mt-2 rounded-[var(--radius-card)] p-4"
              style={{ background: "var(--tone-card)" }}
              data-testid={`branch-health-card-${branch.id}`}
            >
              <p className="text-15 font-bold">{t("branchPage.inventoryHealth")}</p>
              <div className="mt-3 flex flex-col gap-2.5">
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
            <p
              className="text-11 mt-2 px-1"
              style={{ color: "var(--text-tertiary)" }}
            >
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
