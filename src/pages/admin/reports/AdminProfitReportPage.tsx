import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ReceiptText } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import PeriodTabs from "@/components/ui/PeriodTabs";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import ListRow from "@/components/ui/ListRow";
import { Skeleton } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { formatCurrency } from "@/lib/formatters";
import { pkDateFromISO, pkMonthStart, pkMonthStartOf, pkToday } from "@/lib/pkDate";
import { lineCogs, profitDisplay, summariseSales, type LiveCostLookup } from "@/lib/profit";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useBranchPeriodReport } from "@/lib/branchReports";

/**
 * What the period kept, after the goods it sold are paid for.
 *
 * WHY THIS SCREEN EXISTS. The Reports hub names Profit as one of the six questions a shop asks.
 * Before this screen that tile could only open the general Reports page, which is about sales
 * and money in and answers profit in one row among six; the owner's board gives the question its
 * own screen, so it gets one — with the same period strip and the same arithmetic as Sales.
 *
 * THE FIGURES ARE THE APP'S OWN. Revenue and cost come from `@/lib/profit`, the single
 * implementation Home, Sales, the sale record and Reports already call, so this screen cannot
 * disagree with any of them. An unknown cost is still never a zero cost: the headline becomes a
 * floor (≥) or the reason it cannot be shown, and the count of lines with no cost is stated
 * under it rather than quietly folded in.
 *
 * TWO BREAKDOWNS, BOTH REAL. By product, from the period's own sale lines (the screen's working
 * branch); and by branch, from `get_branch_period_report` (0253), which resolves the same window
 * for every branch this account may read at the database. The branch split cannot be inferred on
 * the client: the session's sales feed is scoped to the branch it is working in, so a client-side
 * grouping would draw one branch and call it the business. A branch's profit is shown as a floor
 * (≥) while any line in that branch carries no recorded cost.
 *
 * RETURNS ARE NOT IN THIS NUMBER, and the label says "Recorded sales" rather than "Net sales"
 * for that reason: profit is measured on the sales as recorded, exactly as the other screens
 * measure it, and the returns analysis lives on the Sales report where refunds are attributed.
 */
type Preset = "month" | "sixMonths" | "year";
type Period = Preset | "custom";

/** One product's contribution to the period, with unknown costs kept apart from known ones. */
interface ProductProfit {
  name: string;
  qty: number;
  revenue: number;
  /** Sum of the line costs that are actually known. */
  cost: number;
  /** Lines of this product with no usable cost — its profit is a floor while this is above zero. */
  unknownLines: number;
  /** revenue − known cost. Never treat this as exact while `unknownLines` is above zero. */
  profit: number;
  margin: number;
}

export default function AdminProfitReportPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  // The Reports hub is this screen's parent, and the hub passes itself when it opens the tile.
  const returnTo = useReturnTo(`${base}/settings/hub/reports`);

  const sales = useSalesStore((s) => s.sales);
  const salesReady = useSalesStore((s) => s.ready);
  const loadSales = useSalesStore((s) => s.load);
  const products = useProductsStore((s) => s.products);
  const productsReady = useProductsStore((s) => s.ready);
  const loadProducts = useProductsStore((s) => s.load);

  const [period, setPeriod] = useState<Period>("month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [rangeOpen, setRangeOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  useEffect(() => {
    if (!salesReady) void loadSales();
  }, [salesReady, loadSales]);
  useEffect(() => {
    if (!productsReady) void loadProducts();
  }, [productsReady, loadProducts]);

  const todayISO = pkToday();
  const rangeFrom =
    period === "custom"
      ? customFrom || pkMonthStart()
      : period === "sixMonths"
        ? pkMonthStartOf(todayISO, -5)
        : period === "year"
          ? `${todayISO.slice(0, 4)}-01-01`
          : pkMonthStart();
  const rangeTo = period === "custom" ? customTo || todayISO : todayISO;

  const periodSales = useMemo(
    () =>
      sales.filter((sale) => {
        if (sale.isVoided) return false;
        const day = pkDateFromISO(sale.createdAt);
        return day >= rangeFrom && day <= rangeTo;
      }),
    [sales, rangeFrom, rangeTo],
  );

  // The live variant cost only fills lines written before COGS snapshots existed; it is never
  // used as a zero. The shared reader decides that, not this screen.
  const liveCost: LiveCostLookup = useMemo(() => {
    const byVariant = new Map<string, number>();
    for (const product of products) {
      for (const variant of product.variants ?? []) {
        if (variant.costPrice > 0) byVariant.set(variant.id, variant.costPrice);
      }
    }
    return (variantId) => (variantId ? byVariant.get(variantId) : undefined);
  }, [products]);

  const summary = useMemo(
    () => summariseSales(periodSales, liveCost),
    [periodSales, liveCost],
  );
  const display = profitDisplay(summary);

  // The same window, per branch, resolved at the database. The table below is this answer, not
  // a regrouping of `periodSales` — see the file header.
  const { rows: branchRows, failed: branchFailed } = useBranchPeriodReport(rangeFrom, rangeTo);

  const productRows = useMemo<ProductProfit[]>(() => {
    const byName = new Map<string, ProductProfit>();
    for (const sale of periodSales) {
      for (const item of sale.items) {
        const name = item.productName || item.variantName;
        if (!name) continue;
        const entry =
          byName.get(name) ??
          { name, qty: 0, revenue: 0, cost: 0, unknownLines: 0, profit: 0, margin: 0 };
        entry.qty += item.qty;
        entry.revenue += item.lineTotal;
        const cost = lineCogs(item, liveCost);
        if (cost == null) entry.unknownLines += 1;
        else entry.cost += cost;
        byName.set(name, entry);
      }
    }
    return [...byName.values()]
      .map((entry) => ({
        ...entry,
        profit: entry.revenue - entry.cost,
        margin:
          entry.unknownLines === 0 && entry.revenue > 0
            ? Math.round(((entry.revenue - entry.cost) / entry.revenue) * 100)
            : 0,
      }))
      .sort((a, b) => b.profit - a.profit);
  }, [periodSales, liveCost]);

  const topProducts = productRows.slice(0, 4);
  const periodLine = `${rangeFrom} – ${rangeTo}`;
  const money = (value: number) => formatCurrency(value);

  const periodOptions: { key: Preset; label: string }[] = [
    { key: "month", label: t("branchPage.thisMonth") },
    { key: "sixMonths", label: t("branchPage.sixMonths") },
    { key: "year", label: t("branchPage.thisYear") },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="profit-report-page"
    >
      <StatusBar />
      <NavHeader title={t("profit.title")} backTo={returnTo} />

      <div className="px-4 pt-2">
        <PeriodTabs
          options={periodOptions}
          value={period === "custom" ? null : period}
          onChange={(key) => setPeriod(key)}
          onFilter={() => setRangeOpen(true)}
          filterActive={period === "custom"}
          label={t("overview.periodLabel")}
          filterLabel={t("admin.selectDateRange")}
          testIdPrefix="profit-period"
        />
      </div>

      {/* The headline. One tinted surface, as on Sales: the figure the rest of the screen
          explains is separated by tone, never by a border. */}
      <div className="px-4 pt-3">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--brand-light)" }}
          data-testid="profit-hero"
        >
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {t("profit.netProfit")}
          </p>
          <p
            className="text-26 font-bold mt-1 tabular-nums break-words"
            style={{ color: "var(--brand-dark)" }}
            data-testid="profit-net"
          >
            {display.kind === "unknown"
              ? t("profit.addCostToSeeProfit")
              : `${display.kind === "atLeast" ? "≥ " : ""}${money(display.amount)}`}
          </p>
          <p className="text-10 mt-1" style={{ color: "var(--text-secondary)" }}>
            {t("profit.netProfitHint")}
          </p>

          {display.kind === "exact" && summary.revenue > 0 && (
            <p className="text-10 mt-1" style={{ color: "var(--text-secondary)" }}>
              {/* The number is wrapped so Urdu cannot move the % to the left of it: the label is
                  RTL, the figure is not. */}
              {t("profit.margin")} <span dir="ltr">{display.margin}%</span>
            </p>
          )}
          {display.kind !== "exact" && (
            <p className="text-10 mt-1" style={{ color: "var(--text-secondary)" }}>
              {display.kind === "unknown"
                ? t("profit.addCostToSeeProfit")
                : t("profit.costMissingOn", { count: String(display.unknownLines) })}
            </p>
          )}
        </div>

        {/* The two halves of the headline, side by side, as the board draws them. */}
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div
            className="rounded-[var(--radius-card)] p-3.5 min-w-0"
            style={{ background: "var(--tone-card)" }}
            data-testid="profit-revenue"
          >
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {t("sales.revenue")}
            </p>
            <p className="text-18 font-bold mt-1 tabular-nums break-words">
              {salesReady ? money(summary.revenue) : "—"}
            </p>
            <p className="text-10 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {t("profit.revenueHint")}
            </p>
          </div>
          <div
            className="rounded-[var(--radius-card)] p-3.5 min-w-0"
            style={{ background: "var(--tone-card)" }}
            data-testid="profit-cogs"
          >
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {t("reports.costOfGoods")}
            </p>
            <p className="text-18 font-bold mt-1 tabular-nums break-words">
              {salesReady && summary.unknownLines < summary.lines ? money(summary.cogs) : "—"}
            </p>
            <p className="text-10 mt-0.5" style={{ color: "var(--text-tertiary)" }}>
              {t("profit.costHint")}
            </p>
          </div>
        </div>
      </div>

      {/* Which branches kept the money in this window, read per branch at the database. */}
      <div className="px-4 pt-2">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="profit-by-branch"
        >
          <p className="text-14 font-bold">{t("profit.byBranch")}</p>
          <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {t("profit.byBranchHint")}
          </p>

          {branchFailed ? (
            <p className="text-12 mt-3" style={{ color: "var(--text-secondary)" }}>
              {t("profit.branchReadFailed")}
            </p>
          ) : branchRows === null ? (
            <div className="flex flex-col gap-3 mt-3" aria-busy="true">
              <Skeleton w="100%" h="34px" />
              <Skeleton w="100%" h="34px" />
            </div>
          ) : branchRows.length === 0 ? (
            <p className="text-12 mt-3" style={{ color: "var(--text-secondary)" }}>
              {t("profit.noBranchInScope")}
            </p>
          ) : (
            <div className="flex flex-col gap-3 mt-3">
              {branchRows.map((row) => (
                <div key={row.branchId} data-testid={`profit-branch-${row.branchId}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-13 font-semibold truncate min-w-0">
                      {row.branchName}
                      {row.isCurrent && (
                        <span className="text-10 font-normal ms-1.5" style={{ color: "var(--text-tertiary)" }}>
                          {t("reports.thisBranch")}
                        </span>
                      )}
                    </p>
                    <p className="text-13 font-bold tabular-nums shrink-0">
                      {row.profit == null
                        ? "—"
                        : `${row.unknownLines > 0 ? "≥ " : ""}${money(row.profit)}`}
                    </p>
                  </div>
                  <div
                    className="flex items-baseline justify-between gap-3 mt-0.5"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    <p className="text-10 truncate min-w-0">
                      {t("sales.revenue")} {row.grossSales == null ? "—" : money(row.grossSales)}
                      {" · "}
                      {row.unknownLines > 0
                        ? t("profit.unknownCostLine")
                        : `${t("reports.costOfGoods")} ${row.cogs == null ? "—" : money(row.cogs)}`}
                    </p>
                    {row.netSales != null && row.returns != null && (
                      <p className="text-10 tabular-nums shrink-0">
                        {t("sales.netSales")} {money(row.netSales)}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {branchRows && branchRows.some((row) => row.unknownLines > 0) && (
            <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>
              {t("profit.costMissingSomeBranches")}
            </p>
          )}
        </div>
      </div>

      {/* Which products kept the money, from the sale lines this branch can read. */}
      <div className="px-4 pt-2">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="profit-by-product"
        >
          <p className="text-14 font-bold">{t("profit.byProduct")}</p>
          <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {t("profit.byProductHint")}
          </p>

          {!salesReady ? (
            <p className="text-12 mt-3" style={{ color: "var(--text-secondary)" }}>—</p>
          ) : topProducts.length === 0 ? (
            <p className="text-12 mt-3" style={{ color: "var(--text-secondary)" }}>
              {t("profit.noSalesInPeriod")}
            </p>
          ) : (
            <div className="flex flex-col gap-3 mt-3">
              {topProducts.map((product) => (
                <div key={product.name} data-testid={`profit-product-${product.name}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-13 font-semibold truncate min-w-0">{product.name}</p>
                    <p className="text-13 font-bold tabular-nums shrink-0">
                      {product.unknownLines > 0 ? "≥ " : ""}
                      {money(product.profit)}
                    </p>
                  </div>
                  <div
                    className="flex items-baseline justify-between gap-3 mt-0.5"
                    style={{ color: "var(--text-tertiary)" }}
                  >
                    <p className="text-10 truncate min-w-0">
                      {t("sales.revenue")} {money(product.revenue)} ·{" "}
                      {product.unknownLines === 0
                        ? `${t("reports.costOfGoods")} ${money(product.cost)}`
                        : t("profit.unknownCostLine")}
                    </p>
                    {product.unknownLines === 0 && (
                      <p className="text-10 tabular-nums shrink-0">{product.margin}%</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {productRows.length > 0 && (
            <Button
              fullWidth
              variant="outline"
              className="mt-3"
              testId="profit-view-breakdown"
              onClick={() => setBreakdownOpen(true)}
            >
              {t("profit.viewBreakdown")}
            </Button>
          )}

          {display.kind !== "exact" && summary.lines > 0 && (
            <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>
              {t("profit.costMissingOn", { count: String(summary.unknownLines) })}
            </p>
          )}
        </div>
      </div>

      <div className="pt-3 pb-8">
        <ListRow
          testId="profit-row-all-sales"
          icon={ReceiptText}
          title={t("hub.sales.viewAllSales")}
          trailing={
            <ChevronRight
              size={14}
              style={{ color: "var(--text-secondary)" }}
              className="shrink-0"
            />
          }
          onClick={() => navigate(`${base}/sales`)}
        />
      </div>

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

      <Sheet
        open={breakdownOpen}
        title={t("profit.breakdownTitle")}
        onClose={() => setBreakdownOpen(false)}
        closeButton={false}
      >
        <div className="px-4 pb-2">
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {t("profit.breakdownHint")}
          </p>
          <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>
            {periodLine}
          </p>

          <div className="flex flex-col gap-3 mt-4">
            {productRows.map((product) => (
              <div key={product.name} data-testid={`profit-breakdown-${product.name}`}>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-13 font-semibold truncate min-w-0">{product.name}</p>
                  <p className="text-13 font-bold tabular-nums shrink-0">
                    {product.unknownLines > 0 ? "≥ " : ""}
                    {money(product.profit)}
                  </p>
                </div>
                <div className="flex items-baseline justify-between gap-3 mt-0.5">
                  <p className="text-10 truncate min-w-0" style={{ color: "var(--text-tertiary)" }}>
                    {t("sales.revenue")} {money(product.revenue)} ·{" "}
                    {product.unknownLines === 0
                      ? `${t("reports.costOfGoods")} ${money(product.cost)}`
                      : t("profit.unknownCostLine")}
                  </p>
                  <p className="text-10 tabular-nums shrink-0" style={{ color: "var(--text-tertiary)" }}>
                    {t("sales.soldQty", { count: product.qty.toLocaleString("en-PK") })}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {productRows.length === 0 && (
            <p className="text-12 mt-4" style={{ color: "var(--text-secondary)" }}>
              {t("profit.noSalesInPeriod")}
            </p>
          )}
        </div>
      </Sheet>
    </div>
  );
}
