import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Calendar, ChevronRight, ShoppingCart, Store, TrendingUp, Users } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useEmployeesStore, type EmployeePerformance } from "@/stores/employeesStore";
import { useShellBase } from "@/lib/useShellBase";
import { formatCurrency, formatSmartDateTime } from "@/lib/formatters";
import { useCurrentTime } from "@/lib/useCurrentTime";

/**
 * One employee's work in one branch (or every branch).
 *
 * Period selection is deliberately absent: `get_employee_performance` returns a single
 * all-time aggregate plus today's sales/revenue, and painting five period tabs over that one
 * number would make every tab tell the same lie. The all-time scope is stated on the screen,
 * and the detailed date-ranged report is one tap away.
 */
export default function EmployeePerformancePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const [searchParams] = useSearchParams();
  const branchId = searchParams.get("branch");
  const navigate = useNavigate();
  const base = useShellBase();
  const { language } = useThemeStore();
  const t = useT();
  const now = useCurrentTime();
  const employees = useEmployeesStore((s) => s.employees);
  const employeesReady = useEmployeesStore((s) => s.ready);
  const getEmployeePerformance = useEmployeesStore((s) => s.getEmployeePerformance);
  const [performance, setPerformance] = useState<EmployeePerformance | null>(null);
  const [loading, setLoading] = useState(true);

  const emp = employees.find((employee) => employee.id === employeeId);
  const rtl = language === "ur";

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    setLoading(true);
    getEmployeePerformance(employeeId)
      .then((next) => { if (!cancelled) setPerformance(next); })
      .catch(() => { if (!cancelled) setPerformance(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [employeeId, getEmployeePerformance]);

  if (!emp) {
    return (
      <div style={{ background: "var(--background)", color: "var(--text-primary)" }} className="flex flex-col min-h-full">
        <StatusBar />
        <NavHeader title={t("empPerformance.title")} backTo={`${base}/employees`} />
        {employeesReady ? (
          <p className="text-13 text-center py-16" style={{ color: "var(--text-secondary)" }}>{t("empDetail.notFound")}</p>
        ) : (
          <SkeletonList rows={4} />
        )}
      </div>
    );
  }

  const branchLine = branchId
    ? performance?.branches.find((line) => line.branchId === branchId) ?? null
    : null;
  const line = branchLine ?? performance?.totals ?? null;
  const recent = (performance?.recent ?? []).filter((sale) => !branchId || sale.branchId === branchId);
  const scopeName = branchLine?.branchName ?? t("empPerformance.allBranches");
  const roleName = branchLine?.roleName ?? emp.roleName ?? t("empDetail.noRole");
  const backTo = branchId ? `${base}/employees/${emp.id}/branches` : `${base}/employees/${emp.id}`;

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="flex flex-col w-full min-h-full pb-10"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="employee-performance-page"
    >
      <StatusBar />
      <NavHeader title={t("empPerformance.title")} backTo={backTo} />

      <div className="px-4 pt-1">
        <div
          className="rounded-[var(--radius-card)] px-4 py-3.5 flex items-center gap-3"
          style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
        >
          <span
            className="size-11 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
            style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
          >
            <Store size={18} />
          </span>
          <div className="min-w-0">
            <p className="text-14 font-bold truncate">{scopeName}</p>
            <p className="text-10 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
              {branchId ? roleName : t("empPerformance.allTimeScope")}
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="px-4 pt-4"><SkeletonList rows={3} /></div>
      ) : (
        <>
          <div className="px-4 pt-4">
            <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--tone-card)" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-10 font-medium" style={{ color: "var(--text-secondary)" }}>
                    {t("empPerformance.totalSale")}
                  </p>
                  <p className="text-22 font-bold tabular-nums mt-1">{formatCurrency(line?.revenue ?? 0)}</p>
                  <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>
                    {t("empPerformance.selectedPeriod", { scope: scopeName })}
                  </p>
                </div>
                <span
                  className="size-9 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                >
                  <TrendingUp size={16} />
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-4 pt-3" style={{ borderTop: "1px solid var(--divider)" }}>
                {[
                  { label: t("empDetail.totalSales"), value: line?.salesCount ?? 0 },
                  { label: t("employee.itemsSold"), value: line?.itemsSold ?? 0 },
                  { label: t("empDetail.customers"), value: line?.customers ?? 0 },
                ].map((stat) => (
                  <div key={stat.label}>
                    <p className="text-10" style={{ color: "var(--text-secondary)" }}>{stat.label}</p>
                    <p className="text-15 font-bold tabular-nums mt-0.5">{stat.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="px-4 pt-5">
            <div className="flex items-center justify-between gap-3 mb-2.5">
              <p className="text-15 font-bold">{t("empDetail.recentSales")}</p>
              <button
                type="button"
                onClick={() => navigate(`${base}/sales`, { state: { employeeId: emp.id } })}
                className="text-11 font-semibold flex items-center gap-1 active:opacity-60"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("empPerformance.detailed")} <ChevronRight size={12} />
              </button>
            </div>
            {recent.length === 0 ? (
              <div className="rounded-[var(--radius-card)] p-6 text-center" style={{ background: "var(--tone-card)" }}>
                <ShoppingCart size={20} className="mx-auto mb-2" style={{ color: "var(--text-secondary)" }} />
                <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("sales.noSales")}</p>
              </div>
            ) : (
              <ListCard>
                {recent.map((sale) => (
                  <ListRow
                    key={sale.id}
                    onClick={() => navigate(`${base}/sales/${sale.id}`)}
                    trailing={
                      <span className="text-12 font-bold shrink-0" style={{ color: "var(--text-primary)" }}>
                        {formatCurrency(sale.totalAmount)}
                      </span>
                    }
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-12 font-semibold truncate">{sale.customerName || t("empPerformance.walkIn")}</p>
                        <span className="text-10 shrink-0" style={{ color: "var(--text-secondary)" }}>
                          {formatSmartDateTime(sale.createdAt, now, t)}
                        </span>
                      </div>
                      <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        {!branchId && sale.branchName ? `${sale.branchName} · ` : ""}
                        {sale.itemCount} · {sale.paymentType === "full" ? t("sales.paid") : t("sales.credit")}
                      </p>
                    </div>
                  </ListRow>
                ))}
              </ListCard>
            )}
          </div>

          <div className="px-4 pt-5">
            <div
              className="rounded-[var(--radius-tile)] px-4 py-3 flex items-start gap-3"
              style={{ background: "var(--tone-card)" }}
            >
              <Calendar size={16} className="shrink-0 mt-0.5" style={{ color: "var(--text-secondary)" }} />
              <p className="text-10" style={{ color: "var(--text-secondary)", lineHeight: 1.55 }}>
                {t("empPerformance.note")}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
