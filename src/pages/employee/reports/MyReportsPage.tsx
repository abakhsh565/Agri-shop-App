import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import EmptyState from "@/components/ui/EmptyState";
import PeriodTabs from "@/components/ui/PeriodTabs";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useAuthStore } from "@/stores/authStore";
import { useCartStore } from "@/stores/cartStore";
import { useProductsStore } from "@/stores/productsStore";
import { useSalesStore } from "@/stores/salesStore";
import { useShopStore } from "@/stores/shopStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { branchKind } from "@/lib/branchKind";
import { supabase } from "@/lib/supabase";
import {
  formatCurrency,
  formatSmartDateTime,
  getStockStatus,
  productLowStockThreshold,
} from "@/lib/formatters";
import { pkDate, pkDateFromISO, pkMonthStart, pkToday, pkWeekStart } from "@/lib/pkDate";
import {
  AlertTriangle,
  Ban,
  BarChart3,
  Check,
  ChevronDown,
  ChevronRight,
  Lock,
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

/** One figure in the report's stat block. Read-only by construction: it renders a number. */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="rounded-[var(--radius-tile)] px-3 py-3"
      style={{ background: "var(--surface-2)" }}
    >
      <p className="ds-stat-label truncate">{label}</p>
      <p
        className="text-17 font-bold mt-1 tabular-nums truncate"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </p>
    </div>
  );
}

/** A three-way stock count, read at a glance rather than as three list rows. */
function StockStat({ label, value, tone }: { label: string; value: number; tone: "ok" | "low" | "out" }) {
  const color = value === 0
    ? "var(--text-tertiary)"
    : tone === "out"
      ? "var(--error)"
      : tone === "low"
        ? "var(--warning)"
        : "var(--brand)";
  return (
    <div
      className="rounded-[var(--radius-tile)] px-3 py-3 flex flex-col"
      style={{ background: "var(--surface-2)" }}
    >
      <span
        className="size-1.5 rounded-full mb-2"
        style={{ background: color }}
        aria-hidden="true"
      />
      <p className="ds-stat-label leading-tight">{label}</p>
      <p
        className="text-20 font-bold mt-1 tabular-nums"
        style={{ color: "var(--text-primary)" }}
      >
        {value}
      </p>
    </div>
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
 *
 * It is a *report*, not a form: there is no field, toggle or button that can change a figure.
 * The only interaction is choosing which period to read and leaving for the underlying record.
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
  const canActivity = can("activity.view");

  const activeBranch = branches.find((b) => b.id === activeBranchId) ?? null;
  const branchKindLabel = branchKind(t, activeBranch?.isMain);
  const branchPlace = activeBranch?.place ?? null;
  const branchLocation = branchPlace
    ? (branchPlace.label && branchPlace.label !== activeBranchName ? branchPlace.label : branchPlace.address)
    : null;

  const reportAt = useMemo(() => new Date().toISOString(), []);

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
  const averageSale = periodSales.length > 0 ? periodTotal / periodSales.length : 0;
  const customersServed = new Set(
    periodSales.map((sale) => sale.customerId).filter(Boolean),
  ).size;
  const periodReturns = returns.filter((r) => inPeriod(r.created_at));
  const voidsHandled = mySales.filter(
    (sale) =>
      sale.isVoided &&
      sale.voidedBy === user?.id &&
      inPeriod(sale.voidedAt ?? sale.createdAt),
  ).length;

  const cashTaken = periodSales.reduce(
    (sum, sale) => (sale.paymentMethod === "cash" ? sum + sale.amountPaid : sum),
    0,
  );
  const digitalTaken = periodSales.reduce(
    (sum, sale) => (sale.paymentMethod === "bank_transfer" ? sum + sale.amountPaid : sum),
    0,
  );
  const creditGiven = periodSales.reduce((sum, sale) => sum + sale.outstandingBalance, 0);

  // The last seven days are a trend, not a period total: the hero figure above already answers
  // "how much in the chosen period". Keeping the window fixed means the shape of the week does
  // not disappear when someone switches between Today and This month.
  const trend = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const sale of mySales) {
      if (sale.isVoided) continue;
      const key = pkDateFromISO(sale.createdAt);
      byDay.set(key, (byDay.get(key) ?? 0) + sale.totalAmount);
    }
    const days: { key: string; day: string; total: number; isToday: boolean }[] = [];
    const now = new Date();
    for (let offset = 6; offset >= 0; offset -= 1) {
      const d = new Date(now);
      d.setDate(now.getDate() - offset);
      const key = pkDate(d);
      days.push({
        key,
        day: String(Number(key.slice(8))),
        total: byDay.get(key) ?? 0,
        isToday: offset === 0,
      });
    }
    const max = Math.max(1, ...days.map((d) => d.total));
    const sum = days.reduce((total, d) => total + d.total, 0);
    return { days, max, sum };
  }, [mySales]);

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
  const periodLabel = periodOptions.find((option) => option.key === period)?.label ?? "";

  const moneyMix = [
    {
      key: "cash",
      label: t("reports.cashTaken"),
      hint: t("reports.cashTakenHint"),
      amount: cashTaken,
      color: "var(--brand)",
    },
    {
      key: "digital",
      label: t("reports.digitalTaken"),
      hint: t("reports.digitalTakenHint"),
      amount: digitalTaken,
      color: "color-mix(in srgb, var(--brand) 55%, var(--text-secondary))",
    },
    {
      key: "credit",
      label: t("reports.creditGiven"),
      hint: t("reports.creditGivenHint"),
      amount: creditGiven,
      color: "var(--text-tertiary)",
    },
  ].map((entry) => ({
    ...entry,
    percent: periodTotal > 0 ? Math.round((entry.amount / periodTotal) * 100) : 0,
  }));

  const initials = (user?.name ?? "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
      data-testid="my-reports-page"
    >
      <StatusBar />
      <NavHeader title={t("reports.mine")} />

      {/* The report masthead: whose report this is, where it was read, and the fact that it is
          a record rather than a form. The badge is the promise; the footer repeats the rule. */}
      <div className="px-4 pt-1">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="size-10 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0 text-14 font-bold"
              style={{
                background: "color-mix(in srgb, var(--brand) 22%, transparent)",
                color: "var(--brand-dark)",
              }}
              aria-hidden="true"
            >
              {initials || "—"}
            </span>
            <div className="min-w-0">
              <p className="ds-section-label">{t("reports.reportLabel")}</p>
              <p
                className="text-18 font-bold truncate"
                style={{ color: "var(--text-primary)" }}
                data-testid="reports-employee-name"
              >
                {user?.name ?? t("common.employee")}
              </p>
              <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-tertiary)" }}>
                {t("reports.ownNumbers")}
              </p>
            </div>
          </div>
          <span
            className="ds-badge gap-1 shrink-0"
            style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
            data-testid="reports-read-only"
          >
            <Lock size={10} strokeWidth={2.4} />
            {t("reports.readOnly")}
          </span>
        </div>
      </div>

      {/* Which branch these figures describe — and the way to change it for someone who works
          in more than one. The owner's reports have the same context; this one never says
          "all branches". */}
      <div className="px-4 pt-2">
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
          {/* Main or Sub, said on every screen a branch is named: the figures under this line
              belong to one ledger, never to both kinds together. */}
          {branchKindLabel && (
            <span
              className="text-10 font-bold h-5 px-1.5 rounded-full flex items-center shrink-0"
              data-testid="reports-branch-kind"
              style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
            >
              {branchKindLabel}
            </span>
          )}
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
        <div className="px-4 pt-3">
          {/* The app's one period tab, so a report and the business overview show the same
              control rather than two lookalikes with their own heights and weights. */}
          <PeriodTabs
            options={periodOptions}
            value={period}
            onChange={(key) => setPeriod(key)}
            label={t("reports.period")}
            filterLabel={t("reports.period")}
            testIdPrefix="reports-period"
          />
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
            <section className="px-4 pt-3" data-testid="reports-my-performance">
              <div
                className="rounded-[var(--radius-card)] p-5"
                style={{ background: "var(--card)" }}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="ds-section-label">{t("reports.salesHandled")}</p>
                  <span className="text-10 font-semibold" style={{ color: "var(--text-tertiary)" }}>
                    {periodLabel}
                  </span>
                </div>
                <p
                  className="text-34 font-bold leading-none mt-3 tabular-nums"
                  style={{ color: "var(--text-primary)" }}
                  data-testid="reports-period-total"
                >
                  {formatCurrency(periodTotal)}
                </p>
                <div
                  className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-2 text-12"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <span>{t("reports.transactionsCount", { count: periodSales.length })}</span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {t("reports.avgSale")} {formatCurrency(Math.round(averageSale))}
                  </span>
                </div>

                <div
                  className="mt-4 pt-4"
                  style={{ borderTop: "1px solid var(--divider)" }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <p className="ds-section-label">{t("reports.lastSevenDays")}</p>
                  </div>
                  {trend.sum === 0 ? (
                    <p className="text-12 mt-3" style={{ color: "var(--text-tertiary)" }}>
                      {t("reports.noRecentSales")}
                    </p>
                  ) : (
                    <>
                      <div
                        className="flex items-end gap-1.5 h-24 mt-3"
                        role="img"
                        aria-label={t("reports.chartLabel")}
                      >
                        {trend.days.map((day) => (
                          <div
                            key={day.key}
                            className="flex-1 rounded-t-[4px]"
                            aria-hidden="true"
                            style={{
                              height: day.total > 0
                                ? `${Math.max(6, Math.round((day.total / trend.max) * 100))}%`
                                : "2px",
                              background: day.total > 0
                                ? (day.isToday
                                  ? "var(--brand)"
                                  : "color-mix(in srgb, var(--brand) 42%, var(--surface-2))")
                                : "var(--surface-3)",
                            }}
                          />
                        ))}
                      </div>
                      <div className="flex gap-1.5 mt-1.5" aria-hidden="true">
                        {trend.days.map((day) => (
                          <span
                            key={day.key}
                            className="flex-1 text-center text-9 tabular-nums"
                            style={{ color: day.isToday ? "var(--text-primary)" : "var(--text-tertiary)" }}
                          >
                            {day.day}
                          </span>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => navigate("/employee/sales")}
                  className="w-full h-10 mt-4 rounded-full text-12 font-semibold ds-pressable"
                  style={{
                    border: "1px solid var(--border-control)",
                    color: "var(--text-primary)",
                    background: "transparent",
                  }}
                >
                  {t("reports.allSales")}
                </button>
              </div>
            </section>
          )}

          {canSales && (
            <section className="px-4 pt-3" data-testid="reports-at-a-glance">
              <div
                className="rounded-[var(--radius-card)] p-4"
                style={{ background: "var(--card)" }}
              >
                <p className="ds-section-label mb-3">{t("reports.atAGlance")}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Stat
                    label={t("reports.transactions")}
                    value={String(periodSales.length)}
                  />
                  <Stat
                    label={t("reports.customersServed")}
                    value={String(customersServed)}
                  />
                  {canReturns && (
                    <Stat
                      label={t("reports.returnsHandled")}
                      value={String(periodReturns.length)}
                    />
                  )}
                  {canVoids && (
                    <Stat
                      label={t("reports.voidsHandled")}
                      value={String(voidsHandled)}
                    />
                  )}
                </div>
              </div>
            </section>
          )}

          {canSales && (
            <section className="px-4 pt-3" data-testid="reports-my-sales">
              <div
                className="rounded-[var(--radius-card)] p-4"
                style={{ background: "var(--card)" }}
              >
                <p className="ds-section-label">{t("reports.moneyMix")}</p>
                <div className="mt-3 flex flex-col gap-3">
                  {moneyMix.map((entry) => (
                    <div key={entry.key}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p
                            className="text-12 font-semibold truncate"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {entry.label}
                          </p>
                          <p
                            className="text-10 mt-0.5 truncate"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            {entry.hint}
                          </p>
                        </div>
                        <div className="text-end shrink-0">
                          <p
                            className="text-13 font-semibold tabular-nums"
                            style={{ color: "var(--text-primary)" }}
                          >
                            {formatCurrency(entry.amount)}
                          </p>
                          <p
                            className="text-10 mt-0.5"
                            style={{ color: "var(--text-tertiary)" }}
                          >
                            {t("reports.shareOfSales", { percent: entry.percent })}
                          </p>
                        </div>
                      </div>
                      <div
                        className="mt-2 h-1.5 rounded-full overflow-hidden"
                        style={{ background: "var(--surface-3)" }}
                      >
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${entry.percent}%`, background: entry.color }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-10 mt-3" style={{ color: "var(--text-tertiary)" }}>
                  {t("reports.creditNotCash")}
                </p>
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
                {canActivity && (
                  <ListRow
                    onClick={() => navigate("/employee/activity")}
                    title={t("reports.allActivity")}
                    trailing={<ChevronRight size={14} style={{ color: "var(--text-secondary)" }} />}
                  />
                )}
              </ListCard>
            </section>
          )}

          {(canStock || cartItems.length > 0) && (
            <section className="px-4 pt-5" data-testid="reports-tasks">
              <SectionTitle>{t("reports.tasks")}</SectionTitle>
              {noTasks ? (
                <div
                  className="rounded-[var(--radius-card)] p-4 flex items-center gap-3"
                  style={{ background: "var(--card)" }}
                  data-testid="reports-tasks-clear"
                >
                  <span
                    className="size-9 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
                  >
                    <Check size={16} strokeWidth={2.4} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-13 font-semibold" style={{ color: "var(--text-primary)" }}>
                      {t("reports.allClear")}
                    </p>
                    <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                      {t("reports.noTasks")}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {canStock && stock.low + stock.out > 0 && (
                    <button
                      type="button"
                      onClick={() => navigate("/employee/products")}
                      data-testid="reports-low-stock"
                      className="w-full rounded-[var(--radius-card)] p-4 flex items-center gap-3 text-start ds-pressable"
                      style={{ background: "var(--card)" }}
                    >
                      <span
                        className="size-9 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "var(--warning-bg)", color: "var(--warning)" }}
                      >
                        <AlertTriangle size={16} strokeWidth={2} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-13 font-semibold" style={{ color: "var(--text-primary)" }}>
                          {t("reports.lowStock")}
                        </span>
                        <span className="block text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          {t("reports.lowStockHint", { count: stock.low + stock.out })}
                        </span>
                      </span>
                    </button>
                  )}
                  {cartItems.length > 0 && (
                    <button
                      type="button"
                      onClick={() => navigate("/employee/sale/cart")}
                      data-testid="reports-unfinished-sale"
                      className="w-full rounded-[var(--radius-card)] p-4 flex items-center gap-3 text-start ds-pressable"
                      style={{ background: "var(--card)" }}
                    >
                      <span
                        className="size-9 rounded-full flex items-center justify-center shrink-0"
                        style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
                      >
                        <ShoppingCart size={16} strokeWidth={2} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-13 font-semibold" style={{ color: "var(--text-primary)" }}>
                          {t("reports.unfinishedSale")}
                        </span>
                        <span className="block text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          {t("reports.unfinishedSaleHint", { count: cartItems.length })}
                        </span>
                      </span>
                    </button>
                  )}
                </div>
              )}
            </section>
          )}

          {(canSales || canStock) && (
            <section className="px-4 pt-5" data-testid="reports-branch-summary">
              <SectionTitle>{t("reports.branchContext")}</SectionTitle>
              <p className="text-11 mb-2" style={{ color: "var(--text-tertiary)" }}>
                {t("reports.branchContextNote")}
              </p>
              {canSales && (
                <div
                  className="rounded-[var(--radius-card)] p-4"
                  style={{ background: "var(--card)" }}
                  data-testid="reports-branch-card"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <MapPin size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
                    <p
                      className="text-12 font-semibold truncate"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {activeBranchName ?? t("audit.noBranch")}
                    </p>
                    {branchKindLabel && (
                      <span className="text-10 shrink-0" style={{ color: "var(--text-tertiary)" }}>
                        {branchKindLabel}
                      </span>
                    )}
                    <span className="ms-auto text-10 shrink-0" style={{ color: "var(--text-tertiary)" }}>
                      {t("reports.thisBranch")}
                    </span>
                  </div>
                  <div
                    className="flex items-baseline justify-between gap-3 mt-3 pb-3"
                    style={{ borderBottom: "1px solid var(--divider)" }}
                  >
                    <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                      {t("reports.branchSales")}
                    </p>
                    <p
                      className="text-22 font-bold tabular-nums"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {formatCurrency(branchTotal)}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-3">
                    <Stat
                      label={t("reports.branchTransactions")}
                      value={String(branchPeriodSales.length)}
                    />
                    <Stat
                      label={t("reports.branchCustomers")}
                      value={String(branchCustomers)}
                    />
                  </div>
                </div>
              )}
              {canStock && (
                <div className={canSales ? "pt-4" : ""}>
                  <SectionTitle>{t("reports.stockAvailability")}</SectionTitle>
                  <div className="grid grid-cols-3 gap-2" data-testid="reports-stock">
                    <StockStat label={t("products.inStock")} value={stock.inStock} tone="ok" />
                    <StockStat label={t("products.lowStock")} value={stock.low} tone="low" />
                    <StockStat label={t("products.outOfStock")} value={stock.out} tone="out" />
                  </div>
                </div>
              )}
            </section>
          )}

          <div
            className="mx-4 mt-5 mb-10 rounded-[var(--radius-card)] p-4 flex items-start gap-3"
            style={{ background: "var(--surface-2)" }}
            data-testid="reports-footer"
          >
            <span
              className="size-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
            >
              <Lock size={14} strokeWidth={2.2} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-12 font-semibold" style={{ color: "var(--text-primary)" }}>
                {t("reports.readOnly")}
              </p>
              <p className="text-10 mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {t("reports.readOnlyNote")}
              </p>
              <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>
                {t("reports.generated", { date: formatSmartDateTime(reportAt, undefined, t) })}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
