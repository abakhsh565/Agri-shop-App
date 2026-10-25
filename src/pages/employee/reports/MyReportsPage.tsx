import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuthStore } from "@/stores/authStore";
import { useCartStore } from "@/stores/cartStore";
import { useProductsStore } from "@/stores/productsStore";
import { useSalesStore } from "@/stores/salesStore";
import { useShopStore } from "@/stores/shopStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { supabase } from "@/lib/supabase";
import {
  formatCurrency,
  formatSmartDateTime,
  getStockStatus,
  productLowStockThreshold,
} from "@/lib/formatters";
import { pkDateFromISO, pkMonthStart, pkToday, pkWeekStart } from "@/lib/pkDate";
import {
  AlertTriangle,
  Ban,
  BarChart3,
  ChevronDown,
  ChevronRight,
  MapPin,
  Receipt,
  RotateCcw,
  ShoppingCart,
} from "lucide-react";

type Period = "today" | "week" | "month";
type ActivityKind = "sale" | "return" | "void";

interface HandledReturn {
  id: string;
  return_number: string;
  total_refund: number;
  reason: string | null;
  created_at: string;
}

interface ActivityEvent {
  id: string;
  kind: ActivityKind;
  title: string;
  meta: string;
  amount: number;
  at: string;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
      {children}
    </p>
  );
}

/**
 * The employee's own report.
 *
 * Every number here is read from the branch the employee is standing in: the sales and product
 * stores are reset and reloaded by the shell on a branch switch, and the returns query is
 * explicitly filtered to the active branch. Nothing on this screen aggregates across branches.
 *
 * The screen follows the employee's permissions rather than the owner's report: a section that
 * needs a grant is absent, not empty, when that grant is missing. Business profit, cost prices,
 * supplier payables and other employees' performance are not read at all.
 */
export default function MyReportsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";

  const user = useAuthStore((s) => s.user);
  const sales = useSalesStore((s) => s.sales);
  const salesReady = useSalesStore((s) => s.ready);
  const products = useProductsStore((s) => s.products);
  const productsReady = useProductsStore((s) => s.ready);
  const branches = useShopStore((s) => s.branches);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const activeBranchName = useShopStore((s) => s.activeBranchName);
  const openSwitcher = useShopStore((s) => s.openSwitcher);
  const cartItems = useCartStore((s) => s.items);

  const [period, setPeriod] = useState<Period>("today");
  const [returns, setReturns] = useState<HandledReturn[]>([]);
  const [returnsReady, setReturnsReady] = useState(true);

  // The permissions this branch grants. `*` is the owner's implicit grant, the same rule the
  // server applies — an ordinary membership is limited to what its role actually holds.
  const permissions = user?.membershipRole === "owner" ? ["*"] : user?.permissions ?? [];
  const can = (code: string) => permissions.includes("*") || permissions.includes(code);
  const canSales = can("sales.view");
  const canReturns = can("returns.view");
  const canVoids = can("sales.void");
  const canStock = can("products.view") || can("inventory.view");

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const branchPlace = activeBranch?.place ?? null;
  const branchLocation = branchPlace
    ? (branchPlace.label && branchPlace.label !== activeBranchName ? branchPlace.label : branchPlace.address)
    : null;

  useEffect(() => {
    if (!canReturns || !user?.id || !activeBranchId) {
      setReturns([]);
      setReturnsReady(true);
      return;
    }
    let alive = true;
    setReturnsReady(false);
    void (async () => {
      try {
        const { data, error } = await supabase
          .from("returns")
          .select("id,return_number,total_refund,reason,created_at")
          .eq("processed_by", user.id)
          .eq("branch_id", activeBranchId)
          .order("created_at", { ascending: false })
          .limit(200);
        if (alive && !error && data) setReturns(data as HandledReturn[]);
      } catch {
        // A branch that cannot read returns still gets the rest of the report; the section
        // is permission-gated before this query runs, so a refusal here is not user-facing.
      } finally {
        if (alive) setReturnsReady(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [canReturns, user?.id, activeBranchId]);

  const ready = salesReady && (!canStock || productsReady) && returnsReady;
  const fromDate =
    period === "today" ? pkToday() : period === "week" ? pkWeekStart() : pkMonthStart();
  const inPeriod = (iso: string) => pkDateFromISO(iso) >= fromDate;

  // Sales rows are already branch-scoped by the server. "Mine" is the same identity rule the
  // employee's own Home uses, so the report and the dashboard can never disagree about whose
  // sale a row is.
  const mySales = useMemo(
    () =>
      sales.filter(
        (sale) => sale.employeeId === user?.id || sale.employeeName === user?.name,
      ),
    [sales, user?.id, user?.name],
  );

  const periodSales = mySales.filter((sale) => !sale.isVoided && inPeriod(sale.createdAt));
  const periodTotal = periodSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const periodReturns = returns.filter((r) => inPeriod(r.created_at));
  const voidsHandled = mySales.filter(
    (sale) =>
      sale.isVoided &&
      sale.voidedBy === user?.id &&
      inPeriod(sale.voidedAt ?? sale.createdAt),
  ).length;

  function totalSince(start: string): number {
    return mySales.reduce(
      (sum, sale) =>
        !sale.isVoided && pkDateFromISO(sale.createdAt) >= start
          ? sum + sale.totalAmount
          : sum,
      0,
    );
  }

  const cashTaken = periodSales.reduce(
    (sum, sale) => (sale.paymentMethod === "cash" ? sum + sale.amountPaid : sum),
    0,
  );
  const digitalTaken = periodSales.reduce(
    (sum, sale) => (sale.paymentMethod === "bank_transfer" ? sum + sale.amountPaid : sum),
    0,
  );
  const creditGiven = periodSales.reduce((sum, sale) => sum + sale.outstandingBalance, 0);

  // Stock is a current fact, not a period figure. Counted per product, using the same
  // threshold rule as the dashboard and inventory alerts.
  const stock = useMemo(() => {
    let inStock = 0;
    let low = 0;
    let out = 0;
    for (const product of products) {
      if (product.stockQty <= 0) {
        out += 1;
        continue;
      }
      const threshold = productLowStockThreshold(product.variants);
      if (getStockStatus(product.stockQty, threshold) === "low_stock") low += 1;
      else inStock += 1;
    }
    return { inStock, low, out };
  }, [products]);

  const branchPeriodSales = canSales
    ? sales.filter((sale) => !sale.isVoided && inPeriod(sale.createdAt))
    : [];
  const branchTotal = branchPeriodSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
  const branchCustomers = new Set(
    branchPeriodSales.map((sale) => sale.customerId).filter(Boolean),
  ).size;

  const activity: ActivityEvent[] = [];
  if (canSales) {
    for (const sale of mySales) {
      if (sale.isVoided) {
        if (!canVoids || sale.voidedBy !== user?.id) continue;
        const at = sale.voidedAt ?? sale.createdAt;
        activity.push({
          id: `void:${sale.id}`,
          kind: "void",
          title: t("audit.saleVoided"),
          meta: `${sale.customerName} · ${formatSmartDateTime(at, undefined, t)}`,
          amount: sale.totalAmount,
          at,
        });
      } else {
        activity.push({
          id: `sale:${sale.id}`,
          kind: "sale",
          title: sale.customerName,
          meta: `${sale.saleNumber} · ${formatSmartDateTime(sale.createdAt, undefined, t)}`,
          amount: sale.totalAmount,
          at: sale.createdAt,
        });
      }
    }
  }
  if (canReturns) {
    for (const item of returns) {
      activity.push({
        id: `return:${item.id}`,
        kind: "return",
        title: t("audit.returnProcessed"),
        meta: `${item.return_number} · ${formatSmartDateTime(item.created_at, undefined, t)}`,
        amount: Number(item.total_refund),
        at: item.created_at,
      });
    }
  }
  activity.sort((a, b) => +new Date(b.at) - +new Date(a.at));
  const recentActivity = activity.slice(0, 6);

  const noTasks = stock.low + stock.out === 0 && cartItems.length === 0;
  const canAnyReport = canSales || canReturns || canStock;

  const periodOptions: { key: Period; label: string }[] = [
    { key: "today", label: t("sales.today") },
    { key: "week", label: t("sales.thisWeek") },
    { key: "month", label: t("sales.thisMonth") },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
      data-testid="my-reports-page"
    >
      <StatusBar />
      <NavHeader title={t("reports.mine")} />

      {/* Which branch these figures describe — and the way to change it for someone who works
          in more than one. The owner's reports have the same context; this one never says
          "all branches". */}
      <div className="px-4 pb-1">
        <button
          type="button"
          data-testid="reports-branch-context"
          onClick={branches.length > 1 ? () => openSwitcher() : undefined}
          disabled={branches.length <= 1}
          className="flex items-center gap-1.5 max-w-full text-start active:opacity-60 disabled:opacity-100"
        >
          <MapPin size={12} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
          <span className="text-13 font-semibold truncate" style={{ color: "var(--text-primary)" }}>
            {activeBranchName ?? t("audit.noBranch")}
          </span>
          {branchLocation && (
            <span className="text-12 truncate" style={{ color: "var(--text-secondary)" }}>
              · {branchLocation}
            </span>
          )}
          {branches.length > 1 && (
            <ChevronDown size={12} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
          )}
        </button>
      </div>

      {canSales && (
        <div className="flex gap-2 px-4 pt-3 pb-1">
          {periodOptions.map((option) => (
            <button
              key={option.key}
              type="button"
              data-testid={`reports-period-${option.key}`}
              onClick={() => setPeriod(option.key)}
              className="shrink-0 h-8 px-4 rounded-full text-xs font-bold transition-colors"
              style={{
                background: period === option.key ? "var(--brand)" : "var(--surface-2)",
                color: period === option.key ? "#0a0a0a" : "var(--text-secondary)",
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}

      {!ready ? (
        <div className="px-4 pt-3">
          <SkeletonList rows={5} />
        </div>
      ) : !canAnyReport ? (
        <EmptyState icon={BarChart3} title={t("reports.noAccess")} />
      ) : (
        <>
          {canSales && (
            <section className="px-4 pt-4" data-testid="reports-my-performance">
              <SectionTitle>{t("reports.myPerformance")}</SectionTitle>
              <div
                className="rounded-[var(--radius-card)] p-5"
                style={{ background: "var(--brand)" }}
              >
                <p className="ds-section-label" style={{ color: "rgba(0,0,0,0.55)" }}>
                  {t("reports.salesCompleted")}
                </p>
                <p className="text-34 font-bold leading-none mt-1" style={{ color: "#0a0a0a" }}>
                  {formatCurrency(periodTotal)}
                </p>
                <p className="text-12 mt-2" style={{ color: "rgba(0,0,0,0.65)" }}>
                  {t("reports.transactionsCount", { count: periodSales.length })}
                </p>
              </div>
              {(canReturns || canVoids) && (
                <div className="mt-2">
                  <ListCard>
                    {canReturns && (
                      <ListRow
                        title={t("reports.returnsHandled")}
                        testId="reports-returns"
                        trailing={<span className="ds-row-strong">{periodReturns.length}</span>}
                      />
                    )}
                    {canVoids && (
                      <ListRow
                        title={t("reports.voidsHandled")}
                        testId="reports-voids"
                        trailing={<span className="ds-row-strong">{voidsHandled}</span>}
                      />
                    )}
                  </ListCard>
                </div>
              )}
            </section>
          )}

          {canSales && (
            <section className="px-4 pt-5" data-testid="reports-my-sales">
              <SectionTitle>{t("reports.mySales")}</SectionTitle>
              <ListCard>
                <ListRow
                  title={t("sales.today")}
                  trailing={<span className="ds-row-strong">{formatCurrency(totalSince(pkToday()))}</span>}
                />
                <ListRow
                  title={t("sales.thisWeek")}
                  trailing={<span className="ds-row-strong">{formatCurrency(totalSince(pkWeekStart()))}</span>}
                />
                <ListRow
                  title={t("sales.thisMonth")}
                  trailing={<span className="ds-row-strong">{formatCurrency(totalSince(pkMonthStart()))}</span>}
                />
              </ListCard>

              <div className="pt-4">
                <SectionTitle>{t("reports.paymentBreakdown")}</SectionTitle>
                <ListCard>
                  <ListRow
                    title={t("reports.cashTaken")}
                    meta={t("reports.cashTakenHint")}
                    trailing={<span className="ds-row-strong">{formatCurrency(cashTaken)}</span>}
                  />
                  <ListRow
                    title={t("reports.digitalTaken")}
                    meta={t("reports.digitalTakenHint")}
                    trailing={<span className="ds-row-strong">{formatCurrency(digitalTaken)}</span>}
                  />
                  <ListRow
                    title={t("reports.creditGiven")}
                    meta={t("reports.creditGivenHint")}
                    trailing={<span className="ds-row-strong">{formatCurrency(creditGiven)}</span>}
                  />
                </ListCard>
              </div>

              <div className="pt-4">
                <SectionTitle>{t("reports.salesHistory")}</SectionTitle>
                <ListCard>
                  {periodSales.length === 0 ? (
                    <ListRow title={t("reports.noSalesInPeriod")} />
                  ) : (
                    periodSales.slice(0, 3).map((sale) => (
                      <ListRow
                        key={sale.id}
                        onClick={() => navigate(`/employee/sales/${sale.id}`)}
                        title={sale.customerName}
                        meta={`${formatSmartDateTime(sale.createdAt, undefined, t)} · ${
                          sale.paymentType === "full" ? t("dashboard.paid") : t("dashboard.credit")
                        }`}
                        trailing={<span className="ds-row-strong">{formatCurrency(sale.totalAmount)}</span>}
                      />
                    ))
                  )}
                  <ListRow
                    onClick={() => navigate("/employee/sales")}
                    title={t("reports.allSales")}
                    trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
                  />
                </ListCard>
              </div>
            </section>
          )}

          {(canSales || canReturns) && (
            <section className="px-4 pt-5" data-testid="reports-activity">
              <SectionTitle>{t("reports.myActivity")}</SectionTitle>
              <ListCard>
                {recentActivity.length === 0 ? (
                  <ListRow title={t("reports.noActivity")} meta={t("reports.activityHint")} />
                ) : (
                  recentActivity.map((event) => (
                    <ListRow
                      key={event.id}
                      icon={event.kind === "return" ? RotateCcw : event.kind === "void" ? Ban : Receipt}
                      title={event.title}
                      meta={event.meta}
                      trailing={
                        <span className="ds-row-strong">
                          {event.kind === "return" ? `− ${formatCurrency(event.amount)}` : formatCurrency(event.amount)}
                        </span>
                      }
                    />
                  ))
                )}
              </ListCard>
            </section>
          )}

          {(canStock || cartItems.length > 0) && (
            <section className="px-4 pt-5" data-testid="reports-tasks">
              <SectionTitle>{t("reports.tasks")}</SectionTitle>
              <ListCard>
                {canStock && stock.low + stock.out > 0 && (
                  <ListRow
                    icon={AlertTriangle}
                    onClick={() => navigate("/employee/products")}
                    title={t("reports.lowStock")}
                    meta={t("reports.lowStockHint", { count: stock.low + stock.out })}
                    testId="reports-low-stock"
                    trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
                  />
                )}
                {cartItems.length > 0 && (
                  <ListRow
                    icon={ShoppingCart}
                    onClick={() => navigate("/employee/sale/cart")}
                    title={t("reports.unfinishedSale")}
                    meta={t("reports.unfinishedSaleHint", { count: cartItems.length })}
                    testId="reports-unfinished-sale"
                    trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
                  />
                )}
                {noTasks && <ListRow title={t("reports.noTasks")} />}
              </ListCard>
            </section>
          )}

          {(canSales || canStock) && (
            <section className="px-4 pt-5 pb-8" data-testid="reports-branch-summary">
              <SectionTitle>{t("reports.branchSummary")}</SectionTitle>
              {canSales && (
                <ListCard>
                  <ListRow
                    title={t("reports.branchSales")}
                    trailing={<span className="ds-row-strong">{formatCurrency(branchTotal)}</span>}
                  />
                  <ListRow
                    title={t("reports.branchTransactions")}
                    trailing={<span className="ds-row-strong">{branchPeriodSales.length}</span>}
                  />
                  <ListRow
                    title={t("reports.branchCustomers")}
                    trailing={<span className="ds-row-strong">{branchCustomers}</span>}
                  />
                </ListCard>
              )}
              {canStock && (
                <div className={canSales ? "pt-4" : ""}>
                  <SectionTitle>{t("reports.stockAvailability")}</SectionTitle>
                  <ListCard>
                    <ListRow
                      title={t("products.inStock")}
                      trailing={<span className="ds-row-strong">{stock.inStock}</span>}
                    />
                    <ListRow
                      title={t("products.lowStock")}
                      trailing={<span className="ds-row-strong">{stock.low}</span>}
                    />
                    <ListRow
                      title={t("products.outOfStock")}
                      trailing={<span className="ds-row-strong">{stock.out}</span>}
                    />
                  </ListCard>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
