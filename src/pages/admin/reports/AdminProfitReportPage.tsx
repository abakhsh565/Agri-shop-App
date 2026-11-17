import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ReceiptText } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import RollingNumber from "@/components/ui/RollingNumber";
import NavHeader from "@/components/ui/NavHeader";
import PeriodTabs from "@/components/ui/PeriodTabs";
import BranchSwitchChip from "@/components/shop/BranchSwitchChip";
import DateRangeSheet from "@/components/ui/DateRangeSheet";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useReturnTo } from "@/lib/useReturnTo";
import { formatCurrency } from "@/lib/formatters";
import { pkDateFromISO, pkMonthStart, pkMonthStartOf, pkToday } from "@/lib/pkDate";
import { lineCogs, profitDisplay, summariseSales, type LiveCostLookup } from "@/lib/profit";
import { useSalesStore } from "@/stores/salesStore";
import { useProductsStore } from "@/stores/productsStore";
import { useBranchPeriodReport } from "@/lib/branchReports";
import { useShopStore } from "@/stores/shopStore";

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
  const returnTo = useReturnTo(base === "/admin" ? `${base}/reports/directory` : `${base}/reports`);

  // The branch this screen is measured in: chosen with the same switcher Finance uses, so the
  // answer on the page and the branch in the header can never be two different places.
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const activeBranchName = useShopStore((s) => s.activeBranchName);
  const openSwitcher = useShopStore((s) => s.openSwitcher);

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
  const { rows: branchRows, failed: branchFailed } = useBranchPeriodReport(
    rangeFrom,
    rangeTo,
    activeBranchId ?? undefined,
  );
  /*
   * One branch, the one the switcher is standing in. The report used to draw every readable
   * branch as a comparison list under the figures; the branch is now chosen at the top with the
   * same switcher as Finance, and the page shows that branch's numbers rather than asking the
   * reader to find their own row (owner, 2026-11-17).
   */
  const activeRow = branchRows?.find((row) => row.isCurrent) ?? null;
  const listSales = activeRow?.listSales ?? null;
  const discounts = activeRow?.discounts ?? null;
  const charged = activeRow?.grossSales ?? null;
  const netSales = activeRow?.netSales ?? null;
  const returns = activeRow?.returns ?? null;
  const cogs = activeRow?.cogs ?? null;
  const profitFigure = activeRow?.profit ?? (display.kind === "exact" ? display.amount : null);
  const marginPct =
    charged != null && charged > 0 && profitFigure != null
      ? Math.round((profitFigure / charged) * 100)
      : null;
  const saleCount = periodSales.length;
  const averageSale = charged != null && saleCount > 0 ? charged / saleCount : null;

  const productRows = useMemo<ProductProfit[]>(() => {
    const byName = new Map<string, ProductProfit>();
    for (const sale of periodSales) {
      /*
       * A bill-level discount belongs to the sale, not to one line, so it is shared out across the
       * lines in proportion to what each line was worth. Without this the products here added up
       * to the ticketed total while the branch above reported what was charged — two profits for
       * one period, differing by exactly the discount given (owner, 2026-11-17).
       */
      const lineNet = sale.items.reduce((sum, item) => sum + item.lineTotal, 0);
      const billDiscount = sale.discount ?? 0;
      for (const item of sale.items) {
        const name = item.productName || item.variantName;
        if (!name) continue;
        const entry =
          byName.get(name) ??
          { name, qty: 0, revenue: 0, cost: 0, unknownLines: 0, profit: 0, margin: 0 };
        const share = lineNet > 0 && billDiscount > 0 ? (item.lineTotal / lineNet) * billDiscount : 0;
        entry.qty += item.qty;
        entry.revenue += item.lineTotal - share;
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

      {/* The branch every figure on this page belongs to, chosen here instead of listed below
          (owner, 2026-11-17). It sits under the title, centred, so it reads as the scope of the
          screen rather than as one more control in a row of them. */}
      <div className="flex justify-center px-4 pt-1">
        <BranchSwitchChip
          branchName={activeBranchName ?? t("sales.thisBranch")}
          onClick={() => openSwitcher()}
          testId="profit-branch-switch"
          maxWidth="max-w-full"
        />
      </div>

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
          className="rounded-[var(--radius-card)] p-5"
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
            {profitFigure == null ? (
              "—"
            ) : (
              <RollingNumber
                text={`${(activeRow?.unknownLines ?? 0) > 0 ? "≥ " : ""}${money(profitFigure)}`}
                animateOnMount
              />
            )}
          </p>
          {/* Two facts, not two explanations: the margin the figure represents and the size of the
              period it came from. A shop owner reads "19% · 12 sales · avg Rs. 1,646" at a glance;
              the old sentence underneath said what profit was, which the label already said. */}
          <div className="flex items-center gap-2 flex-wrap mt-2">
            {marginPct != null && (
              <span
                className="text-11 font-semibold px-2 py-0.5 rounded-full tabular-nums"
                style={{ background: "var(--tone-card)", color: "var(--brand-dark)" }}
                dir="ltr"
              >
                {marginPct}%
              </span>
            )}
            <span className="text-11 tabular-nums" style={{ color: "var(--text-secondary)" }}>
              {t("profit.salesMeta", {
                count: String(saleCount),
                average: averageSale == null ? "—" : money(averageSale),
              })}
            </span>
          </div>
          {(activeRow?.unknownLines ?? 0) > 0 && (
            <p className="text-10 mt-1.5" style={{ color: "var(--text-secondary)" }}>
              {t("profit.costMissingOn", { count: String(activeRow?.unknownLines ?? 0) })}
            </p>
          )}
        </div>

        {/*
         * What the headline was built from, in the order it is built: the goods were ticketed at
         * one figure, some of it was given away, returns came off, and the cost of the goods is
         * known. Four figures, four labels, no explanations — each one is a word a shop owner
         * already uses.
         */}
        <div className="grid grid-cols-2 gap-3 mt-3">
          <StatTile
            testId="profit-list-sales"
            label={t("profit.listSales")}
            value={listSales == null ? "—" : money(listSales)}
          />
          <StatTile
            testId="profit-discounts"
            label={t("profit.discountsGiven")}
            value={discounts == null ? "—" : `−${money(discounts)}`}
            tone="warn"
          />
          <StatTile
            testId="profit-revenue"
            label={t("sales.netSales")}
            value={netSales == null ? "—" : money(netSales)}
          />
          <StatTile
            testId="profit-cogs"
            label={t("reports.costOfGoods")}
            value={cogs == null ? "—" : money(cogs)}
          />
        </div>
        {branchFailed && (
          <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>
            {t("profit.branchReadFailed")}
          </p>
        )}
        {returns != null && returns > 0 && (
          <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>
            {t("hub.sales.returns")} −{money(returns)}
          </p>
        )}
      </div>


      {/* Which products kept the money, from the sale lines this branch can read. */}
      <div className="px-4 pt-4">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="profit-by-product"
        >
          <p className="text-14 font-bold">{t("profit.byProduct")}</p>

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
          <p className="text-11" style={{ color: "var(--text-tertiary)" }}>
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

/**
 * One figure the headline was built from. Label, amount, nothing else: four of these in a 2×2
 * grid replace four tiles that each carried a sentence explaining themselves (owner, 2026-11-17).
 */
function StatTile({
  label,
  value,
  testId,
  tone,
}: {
  label: string;
  value: string;
  testId: string;
  /** Discounts are money that was not kept, so they read in the warning colour. */
  tone?: "warn";
}) {
  return (
    <div
      className="rounded-[var(--radius-card)] p-4 min-w-0"
      style={{ background: "var(--tone-card)" }}
      data-testid={testId}
    >
      <p className="text-11" style={{ color: "var(--text-secondary)" }}>
        {label}
      </p>
      <p
        className="text-18 font-bold mt-1.5 tabular-nums break-words"
        style={tone === "warn" ? { color: "var(--warning-text, var(--text-primary))" } : undefined}
      >
        {value}
      </p>
    </div>
  );
}
