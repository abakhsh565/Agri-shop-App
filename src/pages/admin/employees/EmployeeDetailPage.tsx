import { useNavigate, useParams } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useSalesStore } from "@/stores/salesStore";
import { useCustomersStore } from "@/stores/customersStore";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { pkToday, pkDateFromISO } from "@/lib/pkDate";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useCurrentTime } from "@/lib/useCurrentTime";
import {
  Phone, Briefcase, Hash, ShieldCheck, UserX, UserCheck,
  TrendingUp, ShoppingCart, Users, Calendar, ChevronRight,
  Eye, Package
} from "lucide-react";
import type { Sale } from "@/types";

function initBgColor(name: string | null | undefined) {
  const colors = ["#84cc16","#3b82f6","#8b5cf6","#f59e0b","#06b6d4","#ec4899"];
  let hash = 0;
  if (!name) return colors[0];
  for (const c of name) hash = (hash * 31 + c.charCodeAt(0)) & 0xffff;
  return colors[hash % colors.length];
}

export default function EmployeeDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const t = useT();
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const isUrdu = language === "ur";
  const employees = useEmployeesStore((s) => s.employees);
  const setActiveAction = useEmployeesStore((s) => s.setActive);
  const sales = useSalesStore((s) => s.sales);
  const customers = useCustomersStore((s) => s.customers);
  const now = useCurrentTime();

  const emp = employees.find((e) => e.id === employeeId);
  if (!emp) return (
    <div style={{ background: "var(--background)", color: "var(--text-primary)" }} className="flex flex-col min-h-full">
      <StatusBar />
      <NavHeader title="Employee" />
      <div className="flex flex-col items-center py-20 gap-2">
        <p className="text-3xl">🔍</p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Employee not found</p>
      </div>
    </div>
  );

  const empSales = sales.filter((s: Sale) => !s.isVoided && (s.employeeId === emp.id || s.employeeName === emp.name));
  const todayStr = pkToday();

  // Performance stats
  const totalRevenue = empSales.reduce((sum, x) => sum + x.totalAmount, 0);
  const totalTransactions = empSales.length;
  const avgSaleValue = totalTransactions > 0 ? Math.round(totalRevenue / totalTransactions) : 0;
  const todaySales = empSales.filter(s => pkDateFromISO(s.createdAt) === todayStr);
  const todayRevenue = todaySales.reduce((sum, x) => sum + x.totalAmount, 0);
  const todayTransactions = todaySales.length;

  // Unique customers served
  const customerIds = [...new Set(empSales.map(s => s.customerId).filter(Boolean))];
  const uniqueCustomers = customerIds
    .map(id => customers.find(c => c.id === id))
    .filter(Boolean);

  // Total items sold
  const totalItems = empSales.reduce((sum, s) => sum + s.items.reduce((isum, it) => isum + it.qty, 0), 0);

  // Recent sales (last 5)
  const recentSales = [...empSales].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 5);

  // Sales by payment type
  const paidSales = empSales.filter(s => s.paymentType === "full");
  const creditSales = empSales.filter(s => s.paymentType !== "full");
  const creditOutstanding = creditSales.reduce((sum, s) => sum + (s.outstandingBalance || 0), 0);
  const creditExtended = creditSales.reduce((sum, s) => sum + s.totalAmount, 0);
  const creditPaidBack = creditExtended - creditOutstanding;
  const creditPct = creditExtended > 0 ? Math.min(100, Math.round((creditPaidBack / creditExtended) * 100)) : 0;

  const initials = emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const roleLabel = emp.role === "co_admin" ? t("emp.coAdmin") : emp.role === "admin" ? t("emp.admin") : t("emp.employee");
  const isActive = emp.isActive;

  const pl = (n: number, singular: string, plural: string) => `${n} ${n === 1 ? singular : plural}`;
  const stats = [
    { icon: TrendingUp, label: t("admin.totalRevenue"), value: formatCurrency(totalRevenue), color: "var(--brand)" },
    { icon: ShoppingCart, label: t("admin.totalSales"), value: pl(totalTransactions, t("emp.sale"), t("emp.sales")), color: "#3b82f6" },
    { icon: Package, label: t("employee.itemsSold"), value: pl(totalItems, t("emp.item"), t("emp.items")), color: "#8b5cf6" },
    { icon: Users, label: t("admin.customersServed"), value: pl(uniqueCustomers.length, t("emp.customer"), t("emp.customers")), color: "#06b6d4" },
    { icon: Calendar, label: t("emp.today"), value: `${pl(todayTransactions, t("emp.sale"), t("emp.sales"))} · ${formatCurrency(todayRevenue)}`, color: "#f59e0b" },
    { icon: ShieldCheck, label: t("emp.avgSale"), value: formatCurrency(avgSaleValue), color: "#ec4899" },
  ];

  async function setActive(next: boolean) {
    try {
      await setActiveAction(emp!.id, next, user?.id);
      addToast(
        next ? `${emp!.name} reactivated` : `${emp!.name} deactivated — historical sales are preserved`,
        next ? "success" : "info",
      );
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Could not update employee", "error");
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full pb-20"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={emp.name} />

      {/* Avatar + name card */}
      <div className="px-4 pt-3 animate-fade-in-up">
        <div
          className="rounded-2xl p-5 flex items-center gap-4"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-light)" }}
        >
          {emp.photoUrl ? (
            <img src={emp.photoUrl} alt={emp.name} className="w-16 h-16 rounded-full object-cover shrink-0" />
          ) : (
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold shrink-0"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
            >
              {initials}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold truncate" style={{ color: "var(--text-primary)" }}>{emp.name}</p>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>{emp.jobTitle ?? roleLabel}</p>
            <div className="flex items-center gap-2 mt-2">
              <span
                className="text-xs font-bold px-2.5 py-0.5 rounded-full"
                style={isActive
                  ? { background: "rgba(132,204,22,0.15)", color: "var(--brand-dark)" }
                  : { background: "#fee2e2", color: "#dc2626" }
                }
              >
                {isActive ? t("employees.active") : t("employees.deactivated")}
              </span>
              <span
                className="text-xs font-medium px-2.5 py-0.5 rounded-full"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)", color: "var(--text-secondary)" }}
              >
                {roleLabel}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Contact & Details */}
      <div className="px-4 pt-4 animate-fade-in-up delay-75">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          Contact & Details
        </p>
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border-light)" }}
        >
          {[
            { icon: Phone, label: "Phone", value: emp.phone },
            { icon: Hash, label: "Employee #", value: emp.employeeNumber ?? "—" },
            { icon: Briefcase, label: "Role", value: roleLabel },
          ].map(({ icon: Icon, label, value }, i, arr) => (
            <div
              key={label}
              className="flex items-center justify-between px-4 py-3.5"
              style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--divider)" : "none" }}
            >
              <div className="flex items-center gap-3">
                <Icon size={16} style={{ color: "var(--brand)" }} />
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</span>
              </div>
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Performance Stats */}
      <div className="px-4 pt-5 animate-fade-in-up delay-100">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          Performance Overview
        </p>
        <div className="grid grid-cols-2 gap-3">
          {stats.map(({ icon: Icon, label, value, color }) => (
            <div
              key={label}
              className="rounded-xl p-3.5"
              style={{ background: "var(--surface-2)", border: "1px solid var(--border-light)" }}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center"
                  style={{ background: `${color}20` }}
                >
                  <Icon size={12} style={{ color }} />
                </div>
                <span className="text-[10px] font-medium" style={{ color: "var(--text-secondary)" }}>{label}</span>
              </div>
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Payment Breakdown */}
      <div className="px-4 pt-5 animate-fade-in-up delay-125">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          Payment Breakdown
        </p>
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border-light)" }}
        >
          {[
            { label: "Paid Sales", value: `${paidSales.length} (${formatCurrency(paidSales.reduce((s, x) => s + x.totalAmount, 0))})`, color: "var(--brand-dark)" },
            { label: "Credit Sales", value: `${creditSales.length} (${formatCurrency(creditSales.reduce((s, x) => s + x.totalAmount, 0))})`, color: "#f59e0b" },
            { label: "Outstanding Balance", value: formatCurrency(creditOutstanding), color: creditOutstanding > 0 ? "#dc2626" : "var(--brand-dark)" },
          ].map(({ label, value, color }, i, arr) => (
            <div
              key={label}
              className="flex items-center justify-between px-4 py-3"
              style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--divider)" : "none" }}
            >
              <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</span>
              <span className="text-sm font-bold" style={{ color }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Credit Extension Summary */}
      {creditExtended > 0 && (
        <div className="px-4 pt-5 animate-fade-in-up delay-[135ms]">
          <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
            Credit Extended
          </p>
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid var(--border-light)" }}
          >
            <div className="px-4 py-3 flex items-center justify-between" style={{ background: "var(--surface-2)" }}>
              <span className="text-xs font-bold uppercase tracking-wider" style={{ color: "var(--text-secondary)" }}>Collection Progress</span>
              <span
                className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                style={{ color: creditPct >= 80 ? "#22c55e" : creditPct >= 50 ? "#f59e0b" : "#ef4444", background: (creditPct >= 80 ? "#22c55e" : creditPct >= 50 ? "#f59e0b" : "#ef4444") + "22" }}
              >
                {creditPct}% collected
              </span>
            </div>
            <div className="px-4 py-3">
              <div className="h-2 rounded-full w-full" style={{ background: "var(--divider)" }}>
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${creditPct}%`, background: creditPct >= 80 ? "#22c55e" : creditPct >= 50 ? "#f59e0b" : "#ef4444" }}
                />
              </div>
              <div className="flex items-center justify-between mt-2">
                <div>
                  <p className="text-[10px] uppercase" style={{ color: "var(--text-secondary)" }}>Extended</p>
                  <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{formatCurrency(creditExtended)}</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] uppercase" style={{ color: "var(--text-secondary)" }}>Collected</p>
                  <p className="text-sm font-bold" style={{ color: "#22c55e" }}>{formatCurrency(creditPaidBack)}</p>
                </div>
                <div className="text-end">
                  <p className="text-[10px] uppercase" style={{ color: "var(--text-secondary)" }}>Outstanding</p>
                  <p className="text-sm font-bold" style={{ color: creditOutstanding > 0 ? "#ef4444" : "var(--text-primary)" }}>{formatCurrency(creditOutstanding)}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customers Served */}
      {uniqueCustomers.length > 0 && (
        <div className="px-4 pt-5 animate-fade-in-up delay-150">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
              Customers Served ({uniqueCustomers.length})
            </p>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
            {uniqueCustomers.map((c) => {
              if (!c) return null;
              const cBg = initBgColor(c.name);
              const custSales = empSales.filter(s => s.customerId === c.id);
              const custTotal = custSales.reduce((s, x) => s + x.totalAmount, 0);
              return (
                <button
                  key={c.id}
                  onClick={() => navigate(`/admin/customers/${c.id}`)}
                  className="flex flex-col items-center gap-1.5 min-w-[80px] shrink-0"
                >
                  {c.imageUrl ? (
                    <img src={c.imageUrl} alt={c.name} className="w-11 h-11 rounded-full object-cover" />
                  ) : (
                    <div
                      className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-bold"
                      style={{ background: cBg, color: "#fff" }}
                    >
                      {c.name ? c.name.charAt(0) : "?"}
                    </div>
                  )}
                  <span className="text-[10px] font-semibold truncate max-w-[72px]" style={{ color: "var(--text-primary)" }}>
                    {c.name.split(" ")[0]}
                  </span>
                  <span className="text-[9px]" style={{ color: "var(--text-secondary)" }}>
                    {custSales.length} sale{custSales.length !== 1 ? "s" : ""}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Recent Sales */}
      <div className="px-4 pt-5 animate-fade-in-up delay-[175ms]">
        <div className="flex items-center justify-between mb-3">
          <p className="text-[11px] font-bold uppercase tracking-widest" style={{ color: "var(--text-secondary)" }}>
            Recent Sales ({empSales.length})
          </p>
          {empSales.length > 5 && (
            <button
              onClick={() => navigate("/admin/sales", { state: { employeeId: emp.id } })}
              className="text-xs font-semibold flex items-center gap-1"
              style={{ color: "var(--brand)" }}
            >
              View All <ChevronRight size={12} />
            </button>
          )}
        </div>
        {recentSales.length === 0 ? (
          <div
            className="rounded-xl p-6 text-center"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border-light)" }}
          >
            <ShoppingCart size={20} className="mx-auto mb-2" style={{ color: "var(--text-secondary)" }} />
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No sales yet</p>
          </div>
        ) : (
          <div
            className="rounded-xl overflow-hidden"
            style={{ border: "1px solid var(--border-light)" }}
          >
            {recentSales.map((sale, i) => (
              <button
                key={sale.id}
                onClick={() => navigate(`/admin/sales/${sale.id}`)}
                className="flex items-center justify-between px-4 py-3 w-full text-start transition-opacity active:opacity-70"
                style={{ borderBottom: i < recentSales.length - 1 ? "1px solid var(--divider)" : "none" }}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-[13px] font-bold truncate" style={{ color: "var(--text-primary)" }}>{sale.customerName}</p>
                    <span className="text-[10px] shrink-0" style={{ color: "var(--text-secondary)" }}>
                      {formatSmartDateTime(sale.createdAt, now, t)}
                    </span>
                  </div>
                  <p className="text-[10px] mt-0.5" style={{ color: "var(--text-secondary)", opacity: 0.7 }}>
                    {sale.items.length} item{sale.items.length !== 1 ? "s" : ""} · {sale.paymentType === "full" ? "Paid" : "Credit"}
                  </p>
                </div>
                <span className="text-[13px] font-bold shrink-0 ms-2" style={{ color: "var(--text-primary)" }}>
                  {formatCurrency(sale.totalAmount)}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="px-4 pt-5 animate-fade-in-up delay-[200ms]">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          Actions
        </p>
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => navigate("/admin/sales", { state: { employeeId: emp.id } })}
            className="h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            <Eye size={14} />
            View All Sales
          </button>
          <button
            onClick={() => window.open(`tel:${emp.phone}`, "_self")}
            className="h-11 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            <Phone size={14} />
            Call Employee
          </button>
        </div>
      </div>

      {/* Deactivate / reactivate */}
      {!emp.isOriginalOwner && (
        <div className="px-4 pt-5 pb-6 animate-fade-in-up delay-[225ms]">
          {isActive ? (
            <button
              className="w-full h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
              style={{ border: "1.5px solid var(--error)", color: "var(--error)", background: "transparent" }}
              onClick={() => {
                if (confirm(`Deactivate ${emp.name}? They will lose access, but all their past sales stay on record.`)) {
                  setActive(false);
                }
              }}
            >
              <UserX size={15} />
              Deactivate Employee
            </button>
          ) : (
            <button
              className="w-full h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
              onClick={() => setActive(true)}
            >
              <UserCheck size={15} />
              Reactivate Employee
            </button>
          )}
        </div>
      )}
    </div>
  );
}
