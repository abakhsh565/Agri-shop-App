import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Package,
  ShoppingCart,
  Truck,
  Users,
  Wallet,
} from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { useSalesStore } from "@/stores/salesStore";
import { useCustomersStore } from "@/stores/customersStore";
import { useProductsStore } from "@/stores/productsStore";
import { useCompaniesStore } from "@/stores/companiesStore";
import { useShopStore } from "@/stores/shopStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { canSeeDashboard, hasPermission } from "@/lib/tenantContext";
import { resolveEmployeeWorkspace } from "@/lib/employeeWorkspace";
import { formatCurrency, productLowStockThreshold } from "@/lib/formatters";
import { pkDate, pkDateFromISO, pkMonthStart } from "@/lib/pkDate";
import { loadCreditPayments, summariseMoneyIn, type CreditPaymentRow } from "@/lib/money";
import { profitDisplay, summariseSales } from "@/lib/profit";
import { supabase } from "@/lib/supabase";

/**
 * The employee dashboard used to draw only `sales_overview`. The other nine blocks were
 * selectable on Roles & Access but never rendered, which made a finance or inventory role
 * look exactly like a sales role with fewer numbers.
 *
 * This component is the draw layer for those blocks. It is deliberately not a second
 * permission system: the database decides which widgets a role may see, `canSeeDashboard`
 * reads that answer, and every block re-checks the permission its data actually needs.
 * A block never falls back to zero when its permission is absent — it is not drawn at all.
 */

interface PurchaseExpenseRow {
  id: string;
  totalAmount: number;
  amountPaid: number;
  companyName: string;
  createdAt: string;
}

type PrimaryModule = "sales" | "finance" | "inventory" | "purchases" | "customers" | "team";

const WIDGET_ORDER: Record<PrimaryModule, string[]> = {
  sales: [
    "quick_alerts",
    "revenue_analysis",
    "team_performance",
    "profit_loss",
    "customer_outstanding",
    "money_movements",
    "inventory_position",
    "supplier_payables",
    "expense_analysis",
  ],
  finance: [
    "quick_alerts",
    "money_movements",
    "customer_outstanding",
    "expense_analysis",
    "profit_loss",
    "supplier_payables",
    "inventory_position",
    "team_performance",
    "revenue_analysis",
  ],
  inventory: [
    "quick_alerts",
    "inventory_position",
    "supplier_payables",
    "expense_analysis",
    "money_movements",
    "team_performance",
    "profit_loss",
    "customer_outstanding",
    "revenue_analysis",
  ],
  purchases: [
    "quick_alerts",
    "supplier_payables",
    "expense_analysis",
    "inventory_position",
    "money_movements",
    "team_performance",
    "profit_loss",
    "customer_outstanding",
    "revenue_analysis",
  ],
  customers: [
    "quick_alerts",
    "customer_outstanding",
    "revenue_analysis",
    "money_movements",
    "expense_analysis",
    "profit_loss",
    "team_performance",
    "inventory_position",
    "supplier_payables",
  ],
  team: [
    "quick_alerts",
    "team_performance",
    "revenue_analysis",
    "profit_loss",
    "customer_outstanding",
    "inventory_position",
    "supplier_payables",
    "money_movements",
    "expense_analysis",
  ],
};

function Section({
  title,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <section
      className="rounded-[var(--radius-card)] p-4"
      style={{ background: "var(--surface-2)", border: "1px solid var(--divider)" }}
    >
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>{title}</p>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="flex items-center gap-0.5 text-11 font-semibold shrink-0 active:opacity-60"
            style={{ color: "var(--brand-dark)" }}
          >
            {actionLabel}
            <ChevronRight size={12} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-tile)] px-3 py-3" style={{ background: "var(--surface)" }}>
      <p className="ds-section-label" style={{ color: "var(--text-secondary)" }}>{label}</p>
      <p className="text-16 font-bold mt-0.5" style={{ color: "var(--text-primary)" }}>{value}</p>
      {hint && <p className="text-10 mt-0.5" style={{ color: "var(--text-tertiary)" }}>{hint}</p>}
    </div>
  );
}

function PersonRow({
  name,
  detail,
  value,
  onClick,
}: {
  name: string;
  detail?: string;
  value: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="min-w-0">
        <p className="text-13 font-semibold truncate" style={{ color: "var(--text-primary)" }}>{name}</p>
        {detail && <p className="text-10 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>{detail}</p>}
      </div>
      <p className="text-12 font-bold shrink-0" style={{ color: "var(--text-primary)" }}>{value}</p>
    </>
  );
  if (!onClick) {
    return <div className="flex items-center justify-between gap-3 py-2.5">{body}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center justify-between gap-3 py-2.5 text-start active:opacity-60"
    >
      {body}
    </button>
  );
}

function AlertRow({
  label,
  count,
  onOpen,
  tone,
}: {
  label: string;
  count: number;
  onOpen: () => void;
  tone: "warning" | "danger" | "neutral";
}) {
  const color = tone === "danger" ? "#ef4444" : tone === "warning" ? "#f59e0b" : "var(--text-secondary)";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full flex items-center gap-3 py-2.5 text-start active:opacity-60"
    >
      <AlertTriangle size={15} style={{ color }} className="shrink-0" />
      <span className="flex-1 text-12 min-w-0" style={{ color: "var(--text-primary)" }}>{label}</span>
      <span
        className="text-11 font-bold min-w-6 h-6 px-1.5 rounded-full flex items-center justify-center"
        style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
      >
        {count}
      </span>
      <ChevronRight size={13} style={{ color: "var(--text-tertiary)" }} className="shrink-0" />
    </button>
  );
}

export default function EmployeePersonaWidgets({
  salesOverviewVisible,
}: {
  salesOverviewVisible: boolean;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const language = useThemeStore((s) => s.language);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const sales = useSalesStore((s) => s.sales);
  const customers = useCustomersStore((s) => s.customers);
  const products = useProductsStore((s) => s.products);
  const companies = useCompaniesStore((s) => s.companies);
  const [purchases, setPurchases] = useState<PurchaseExpenseRow[]>([]);
  const [creditPayments, setCreditPayments] = useState<CreditPaymentRow[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [moneyLoading, setMoneyLoading] = useState(false);

  const canSales = hasPermission("sales.view");
  const canCustomers = hasPermission("customers.view");
  const canInventory = hasPermission("inventory.view");
  const canPurchases = hasPermission("purchases.view");
  const canPayments = hasPermission("payments.view");
  const canTeam = hasPermission("employees.view");
  const canReports = hasPermission("reports.view");
  const canAlerts = hasPermission("alerts.view");

  const allowed: Record<string, boolean> = {
    revenue_analysis: canSeeDashboard("revenue_analysis") && canSales,
    expense_analysis: canSeeDashboard("expense_analysis") && canPurchases,
    profit_loss: canSeeDashboard("profit_loss") && canReports && canSales,
    customer_outstanding: canSeeDashboard("customer_outstanding") && canCustomers,
    inventory_position: canSeeDashboard("inventory_position") && canInventory,
    supplier_payables: canSeeDashboard("supplier_payables") && canPurchases,
    team_performance: canSeeDashboard("team_performance") && canTeam,
    money_movements: canSeeDashboard("money_movements") && canPayments,
    quick_alerts: canSeeDashboard("quick_alerts") && canAlerts,
  };

  const wantsExpenses = allowed.expense_analysis;
  const wantsMoney = allowed.money_movements;

  const workspace = resolveEmployeeWorkspace(hasPermission);
  const primary: PrimaryModule = workspace === "products" ? "inventory" : workspace ?? "team";

  const monthStart = pkMonthStart();
  const today = pkDate(new Date());

  const monthSales = useMemo(
    () => sales.filter((sale) => !sale.isVoided && pkDateFromISO(sale.createdAt) >= monthStart),
    [sales, monthStart],
  );

  const dayKeys = useMemo(
    () =>
      Array.from({ length: 7 }, (_, index) => {
        const day = new Date();
        day.setDate(day.getDate() - (6 - index));
        return pkDate(day);
      }),
    [],
  );

  const revenueByDay = useMemo(() => {
    const map = new Map<string, number>(dayKeys.map((day) => [day, 0]));
    for (const sale of sales) {
      if (sale.isVoided) continue;
      const day = pkDateFromISO(sale.createdAt);
      if (!map.has(day)) continue;
      map.set(day, (map.get(day) ?? 0) + sale.totalAmount);
    }
    return map;
  }, [sales, dayKeys]);

  const variantCost = useMemo(() => {
    const map = new Map<string, number>();
    for (const product of products) {
      for (const variant of product.variants) map.set(variant.id, variant.costPrice);
    }
    return map;
  }, [products]);

  const profitSummary = useMemo(
    () => summariseSales(monthSales, (variantId) => variantId ? variantCost.get(variantId) : undefined),
    [monthSales, variantCost],
  );
  const profitView = profitDisplay(profitSummary);

  const stock = useMemo(() => {
    let inStock = 0;
    let low = 0;
    let out = 0;
    let units = 0;
    const needsRestock: { id: string; name: string; qty: number; low: number; out: boolean }[] = [];
    for (const product of products) {
      const qty = product.variants.length > 0
        ? product.variants.reduce((sum, variant) => sum + variant.stockQty, 0)
        : product.stockQty;
      const threshold = productLowStockThreshold(product.variants);
      units += qty;
      if (qty <= 0) {
        out++;
        needsRestock.push({ id: product.id, name: product.name, qty, low: threshold, out: true });
      } else if (qty <= threshold) {
        low++;
        needsRestock.push({ id: product.id, name: product.name, qty, low: threshold, out: false });
      } else {
        inStock++;
      }
    }
    needsRestock.sort((a, b) => Number(b.out) - Number(a.out) || a.qty - b.qty);
    return { inStock, low, out, units, needsRestock: needsRestock.slice(0, 4) };
  }, [products]);

  const owingCustomers = useMemo(
    () =>
      customers
        .filter((customer) => customer.outstandingBalance > 0)
        .sort((a, b) => b.outstandingBalance - a.outstandingBalance),
    [customers],
  );
  const outstandingTotal = owingCustomers.reduce((sum, customer) => sum + customer.outstandingBalance, 0);
  const overdueCustomers = owingCustomers.filter((customer) => customer.dueDate && customer.dueDate < today);

  const owingSuppliers = useMemo(
    () =>
      companies
        .filter((company) => company.outstandingPayable > 0)
        .sort((a, b) => b.outstandingPayable - a.outstandingPayable),
    [companies],
  );
  const payableTotal = owingSuppliers.reduce((sum, company) => sum + company.outstandingPayable, 0);

  const team = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>();
    for (const sale of monthSales) {
      const key = sale.employeeId || sale.employeeName;
      const current = map.get(key) ?? { name: sale.employeeName, total: 0, count: 0 };
      current.total += sale.totalAmount;
      current.count += 1;
      map.set(key, current);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [monthSales]);
  const teamTotal = team.reduce((sum, person) => sum + person.total, 0);

  const money = useMemo(
    () =>
      summariseMoneyIn({
        sales: monthSales,
        payments: creditPayments,
        inPeriod: (iso) => pkDateFromISO(iso) >= monthStart,
      }),
    [monthSales, creditPayments, monthStart],
  );

  const monthPurchases = useMemo(
    () => purchases.filter((purchase) => pkDateFromISO(purchase.createdAt) >= monthStart),
    [purchases, monthStart],
  );
  const purchaseTotal = monthPurchases.reduce((sum, purchase) => sum + purchase.totalAmount, 0);
  const openPurchases = monthPurchases.filter(
    (purchase) => purchase.totalAmount - purchase.amountPaid > 0.009,
  );
  const supplierSpend = useMemo(() => {
    const map = new Map<string, { name: string; total: number; count: number }>();
    for (const purchase of monthPurchases) {
      const name = purchase.companyName || "—";
      const current = map.get(name) ?? { name, total: 0, count: 0 };
      current.total += purchase.totalAmount;
      current.count += 1;
      map.set(name, current);
    }
    return [...map.values()].sort((a, b) => b.total - a.total);
  }, [monthPurchases]);

  useEffect(() => {
    if (!wantsExpenses || !activeBranchId || !user) {
      setPurchases([]);
      setPurchasesLoading(false);
      return;
    }
    let current = true;
    setPurchases([]);
    setPurchasesLoading(true);
    supabase
      .from("purchases")
      .select("id, total_amount, amount_paid, company_name, created_at")
      .order("created_at", { ascending: false })
      .limit(200)
      .then(({ data, error }) => {
        if (!current) return;
        if (error || !data) {
          setPurchases([]);
          setPurchasesLoading(false);
          return;
        }
        setPurchases(
          (data as Array<{
            id: string;
            total_amount: number | string | null;
            amount_paid: number | string | null;
            company_name: string | null;
            created_at: string | null;
          }>).map((row) => ({
            id: row.id,
            totalAmount: Number(row.total_amount ?? 0),
            amountPaid: Number(row.amount_paid ?? 0),
            companyName: row.company_name ?? "",
            createdAt: row.created_at ?? "",
          })),
        );
        setPurchasesLoading(false);
      });
    return () => {
      current = false;
    };
  }, [wantsExpenses, activeBranchId, user?.id]);

  useEffect(() => {
    if (!wantsMoney) {
      setCreditPayments([]);
      setMoneyLoading(false);
      return;
    }
    let current = true;
    setCreditPayments([]);
    setMoneyLoading(true);
    loadCreditPayments()
      .then((rows) => {
        if (!current) return;
        setCreditPayments(rows);
        setMoneyLoading(false);
      })
      .catch(() => {
        if (!current) return;
        setCreditPayments([]);
        setMoneyLoading(false);
      });
    return () => {
      current = false;
    };
  }, [wantsMoney, activeBranchId]);

  const isUrdu = language === "ur";
  const weekday = (day: string) =>
    new Date(`${day}T00:00:00`).toLocaleDateString(isUrdu ? "ur-PK" : "en-PK", { weekday: "short" });
  const maxDayRevenue = Math.max(1, ...revenueByDay.values());
  const expenseValue = purchasesLoading ? "—" : formatCurrency(purchaseTotal);
  const unreadAlerts =
    (canCustomers ? overdueCustomers.length : 0) +
    (canInventory ? stock.low + stock.out : 0) +
    (canPurchases ? owingSuppliers.length : 0);

  const widgets: Record<string, ReactNode> = {
    revenue_analysis: (
      <Section
        key="revenue_analysis"
        title={t("dashboard.revenue")}
        actionLabel={t("dashboard.viewSales")}
        onAction={() => navigate("/employee/sales")}
      >
        <div className="flex items-end justify-between gap-3 mb-3">
          <div>
            <p className="text-20 font-bold" style={{ color: "var(--text-primary)" }}>
              {formatCurrency(monthSales.reduce((sum, sale) => sum + sale.totalAmount, 0))}
            </p>
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {t("dashboard.thisMonth")} · {t("dashboard.last7Days")}
            </p>
          </div>
        </div>
        <div className="flex items-end gap-1.5 h-20" dir="ltr">
          {dayKeys.map((day) => {
            const value = revenueByDay.get(day) ?? 0;
            return (
              <div key={day} className="flex-1 flex flex-col items-center justify-end gap-1 h-full">
                <div
                  className="w-full rounded-t-[4px]"
                  style={{
                    height: `${Math.max(3, Math.round((value / maxDayRevenue) * 64))}px`,
                    background: value > 0 ? "var(--brand)" : "var(--divider)",
                  }}
                  title={formatCurrency(value)}
                />
                <span className="text-9" style={{ color: "var(--text-tertiary)" }}>{weekday(day)}</span>
              </div>
            );
          })}
        </div>
        {monthSales.length === 0 && (
          <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>{t("dashboard.noSalesWeek")}</p>
        )}
      </Section>
    ),

    expense_analysis: (
      <Section
        key="expense_analysis"
        title={t("dashboard.purchasesThisMonth")}
        actionLabel={t("dashboard.viewPurchases")}
        onAction={() => navigate("/employee/purchases")}
      >
        <div className="flex items-end justify-between gap-3 mb-2">
          <div>
            <p className="text-20 font-bold" style={{ color: "var(--text-primary)" }}>{expenseValue}</p>
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {monthPurchases.length} {t("dashboard.purchaseOrders")}
            </p>
          </div>
          {openPurchases.length > 0 && (
            <span
              className="text-10 font-semibold px-2 py-1 rounded-full"
              style={{ background: "rgba(245,158,11,0.12)", color: "#b45309" }}
            >
              {openPurchases.length} {t("dashboard.stillUnpaid")}
            </span>
          )}
        </div>
        {supplierSpend.slice(0, 3).map((supplier) => (
          <PersonRow
            key={supplier.name}
            name={supplier.name}
            detail={`${supplier.count} ${t("dashboard.purchaseOrders")}`}
            value={formatCurrency(supplier.total)}
          />
        ))}
        {!purchasesLoading && supplierSpend.length === 0 && (
          <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>
            {t("dashboard.noPurchasesThisMonth")}
          </p>
        )}
      </Section>
    ),

    profit_loss: (
      <Section
        key="profit_loss"
        title={t("dashboard.profit")}
        actionLabel={t("dashboard.viewReports")}
        onAction={() => navigate("/employee/reports")}
      >
        <div className="grid grid-cols-2 gap-2">
          <Metric label={t("dashboard.revenue")} value={formatCurrency(profitSummary.revenue)} />
          {profitView.kind === "exact" ? (
            <>
              <Metric label={t("dashboard.costOfGoods")} value={formatCurrency(profitSummary.cogs)} />
              <Metric label={t("dashboard.grossProfit")} value={formatCurrency(profitView.amount)} />
              <Metric label={t("dashboard.margin")} value={`${profitView.margin}%`} />
            </>
          ) : (
            <Metric
              label={t("dashboard.grossProfit")}
              value={profitView.kind === "atLeast" ? `≥ ${formatCurrency(profitView.amount)}` : "—"}
            />
          )}
        </div>
        {profitView.kind !== "exact" && (
          <p className="text-10 mt-2.5" style={{ color: "var(--text-secondary)" }}>
            {t("dashboard.profitUnknown", { count: profitView.unknownLines })}
          </p>
        )}
      </Section>
    ),

    customer_outstanding: (
      <Section
        key="customer_outstanding"
        title={t("dashboard.customerCredit")}
        actionLabel={t("dashboard.viewCustomers")}
        onAction={() => navigate("/employee/customers")}
      >
        <div className="flex items-end justify-between gap-3 mb-2">
          <div>
            <p className="text-20 font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(outstandingTotal)}</p>
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {owingCustomers.length} {t("dashboard.customersOwing")}
            </p>
          </div>
          {overdueCustomers.length > 0 && (
            <span
              className="text-10 font-semibold px-2 py-1 rounded-full"
              style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}
            >
              {overdueCustomers.length} {t("dashboard.overdue")}
            </span>
          )}
        </div>
        {owingCustomers.slice(0, 4).map((customer) => (
          <PersonRow
            key={customer.id}
            name={customer.name}
            detail={customer.phone}
            value={formatCurrency(customer.outstandingBalance)}
            onClick={() => navigate(`/employee/customers/${customer.id}`)}
          />
        ))}
        {owingCustomers.length === 0 && (
          <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>{t("dashboard.noOutstanding")}</p>
        )}
      </Section>
    ),

    inventory_position: (
      <Section
        key="inventory_position"
        title={t("dashboard.stockPosition")}
        actionLabel={t("dashboard.viewStock")}
        onAction={() => navigate("/employee/products")}
      >
        <div className="grid grid-cols-3 gap-2">
          <Metric label={t("dashboard.inStock")} value={String(stock.inStock)} />
          <Metric label={t("dashboard.lowStock")} value={String(stock.low)} />
          <Metric label={t("dashboard.outOfStock")} value={String(stock.out)} />
        </div>
        <div className="flex items-center gap-2 mt-3 mb-1">
          <Package size={13} style={{ color: "var(--text-secondary)" }} />
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>
            {stock.units.toLocaleString("en-PK")} {t("dashboard.unitsOnHand")}
          </p>
        </div>
        {stock.needsRestock.map((product) => (
          <PersonRow
            key={product.id}
            name={product.name}
            detail={product.out ? t("dashboard.outOfStock") : t("dashboard.needsRestocking")}
            value={`${product.qty} / ${product.low}`}
            onClick={() => navigate("/employee/products")}
          />
        ))}
        {stock.needsRestock.length === 0 && (
          <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>{t("dashboard.noLowStock")}</p>
        )}
      </Section>
    ),

    supplier_payables: (
      <Section
        key="supplier_payables"
        title={t("dashboard.supplierBills")}
        actionLabel={t("dashboard.viewPurchases")}
        onAction={() => navigate("/employee/purchases")}
      >
        <div className="flex items-end justify-between gap-3 mb-2">
          <div>
            <p className="text-20 font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(payableTotal)}</p>
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {owingSuppliers.length} {t("dashboard.suppliersAwaiting")}
            </p>
          </div>
          <Truck size={18} style={{ color: "var(--text-tertiary)" }} />
        </div>
        {owingSuppliers.slice(0, 4).map((company) => (
          <PersonRow
            key={company.id}
            name={company.name}
            detail={company.phone}
            value={formatCurrency(company.outstandingPayable)}
            onClick={() => navigate("/employee/purchases")}
          />
        ))}
        {owingSuppliers.length === 0 && (
          <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>{t("dashboard.noPayables")}</p>
        )}
      </Section>
    ),

    team_performance: (
      <Section
        key="team_performance"
        title={t("dashboard.teamPerformance")}
        actionLabel={t("dashboard.viewTeam")}
        onAction={() => navigate("/employee/team")}
      >
        <div className="flex items-end justify-between gap-3 mb-2">
          <div>
            <p className="text-20 font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(teamTotal)}</p>
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {team.length} {t("dashboard.sellers")} · {t("dashboard.thisMonth")}
            </p>
          </div>
          <Users size={18} style={{ color: "var(--text-tertiary)" }} />
        </div>
        {team.slice(0, 5).map((person, index) => (
          <PersonRow
            key={`${person.name}-${index}`}
            name={`${index + 1}. ${person.name}`}
            detail={`${person.count} ${t("common.sales")}`}
            value={formatCurrency(person.total)}
          />
        ))}
        {team.length === 0 && (
          <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>{t("dashboard.noTeamSales")}</p>
        )}
      </Section>
    ),

    money_movements: (
      <Section
        key="money_movements"
        title={canSales ? t("dashboard.moneyIn") : t("dashboard.paymentsReceived")}
        actionLabel={t("dashboard.viewFinance")}
        onAction={() => navigate("/employee/finance")}
      >
        {canSales ? (
          <>
            <p className="text-20 font-bold mb-2" style={{ color: "var(--text-primary)" }}>
              {moneyLoading ? "—" : formatCurrency(money.total)}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Metric label={t("dashboard.atCounter")} value={moneyLoading ? "—" : formatCurrency(money.counter)} />
              <Metric label={t("dashboard.creditCollected")} value={moneyLoading ? "—" : formatCurrency(money.udhaar)} />
            </div>
            <p className="text-10 mt-2" style={{ color: "var(--text-secondary)" }}>
              {t("dashboard.newCredit")}: {formatCurrency(money.creditGiven)} · {t("dashboard.thisMonth")}
            </p>
          </>
        ) : (
          <Metric
            label={t("dashboard.creditCollected")}
            value={moneyLoading ? "—" : formatCurrency(money.udhaar)}
            hint={t("dashboard.thisMonth")}
          />
        )}
      </Section>
    ),

    quick_alerts: (
      <Section
        key="quick_alerts"
        title={t("dashboard.quickAlertsTitle")}
        actionLabel={t("dashboard.viewReports")}
        onAction={() => navigate("/employee/reports")}
      >
        {unreadAlerts === 0 ? (
          <div className="flex items-center gap-2 py-1">
            <CheckCircle2 size={16} style={{ color: "var(--brand-dark)" }} />
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("dashboard.allClear")}</p>
          </div>
        ) : (
          <>
            {canCustomers && overdueCustomers.length > 0 && (
              <AlertRow
                label={t("dashboard.customersPastDue")}
                count={overdueCustomers.length}
                tone="danger"
                onOpen={() => navigate("/employee/customers")}
              />
            )}
            {canInventory && stock.low + stock.out > 0 && (
              <AlertRow
                label={t("dashboard.productsNeedRestock")}
                count={stock.low + stock.out}
                tone="warning"
                onOpen={() => navigate("/employee/products")}
              />
            )}
            {canPurchases && owingSuppliers.length > 0 && (
              <AlertRow
                label={t("dashboard.supplierBillsPending")}
                count={owingSuppliers.length}
                tone="neutral"
                onOpen={() => navigate("/employee/purchases")}
              />
            )}
          </>
        )}
      </Section>
    ),
  };

  const orderedKeys = WIDGET_ORDER[primary].filter((key) => allowed[key]);

  if (orderedKeys.length === 0) {
    if (salesOverviewVisible) return null;
    return (
      <div className="px-4 pt-8 pb-5 text-center">
        <ShoppingCart size={26} className="mx-auto mb-2" style={{ color: "var(--text-tertiary)" }} />
        <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("dashboard.noWidgets")}</p>
      </div>
    );
  }

  return (
    <div className="px-4 pt-5 pb-5 flex flex-col gap-3">
      {primary !== "sales" && (
        <div className="flex items-center gap-2">
          <Wallet size={13} style={{ color: "var(--brand-dark)" }} />
          <p className="text-10 font-semibold" style={{ color: "var(--text-secondary)" }}>
            {t("dashboard.roleWorkspace")}
          </p>
        </div>
      )}
      {orderedKeys.map((key) => widgets[key])}
    </div>
  );
}
