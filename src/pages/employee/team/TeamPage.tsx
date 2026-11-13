import { useEffect } from "react";
import { Users } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { useT } from "@/lib/i18n";
import { hasPermission } from "@/lib/tenantContext";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useSalesStore } from "@/stores/salesStore";
import { useShopStore } from "@/stores/shopStore";
import { formatCurrency } from "@/lib/formatters";
import { pkToday } from "@/lib/pkDate";

/**
 * A read-only team view for an employee who has been granted employee visibility.
 * It is not the owner's people directory: no invitation, role or access action is offered here.
 */
export default function EmployeeTeamPage() {
  const t = useT();
  const employees = useEmployeesStore((s) => s.employees);
  const loading = useEmployeesStore((s) => s.loading);
  const load = useEmployeesStore((s) => s.load);
  const sales = useSalesStore((s) => s.sales);
  const activeBranchName = useShopStore((s) => s.activeBranchName);
  const canSeeSales = hasPermission("sales.view");

  useEffect(() => {
    void load();
  }, [load]);

  const team = employees.filter((employee) => employee.membershipRole !== "owner");
  const month = pkToday().slice(0, 7);
  const byEmployee = new Map<string, number>();
  if (canSeeSales) {
    for (const sale of sales) {
      if (sale.isVoided || sale.createdAt.slice(0, 7) !== month) continue;
      const key = sale.employeeId ?? sale.employeeName;
      byEmployee.set(key, (byEmployee.get(key) ?? 0) + sale.totalAmount);
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="employee-team-page"
    >
      <StatusBar />
      <NavHeader title={t("nav.team")} backTo="/employee/more" />

      <div className="px-4 pt-1">
        <div
          className="rounded-[var(--radius-card)] p-4 flex items-center justify-between gap-3"
          style={{ background: "var(--tone-card)" }}
        >
          <div className="min-w-0">
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("nav.team")}</p>
            <p className="text-20 font-bold mt-0.5 tabular-nums">{loading ? "—" : team.length}</p>
            <p className="text-10 mt-0.5 truncate" style={{ color: "var(--text-tertiary)" }}>
              {activeBranchName ?? t("audit.noBranch")}
            </p>
          </div>
          <span
            className="size-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--tone-sunken)" }}
          >
            <Users size={18} />
          </span>
        </div>
      </div>

      <div className="px-4 pt-4 pb-8">
        <p className="ds-section px-1 mb-2">{t("more.teamHeading")}</p>
        <div className="flex flex-col gap-2">
          {loading ? (
            <p className="text-12 py-8 text-center" style={{ color: "var(--text-secondary)" }}>
              {t("common.loading")}
            </p>
          ) : team.length === 0 ? (
            <p className="text-12 py-8 text-center" style={{ color: "var(--text-secondary)" }}>
              {t("people.noMatch")}
            </p>
          ) : team.map((employee) => {
            const total = byEmployee.get(employee.id) ?? byEmployee.get(employee.name) ?? 0;
            return (
              <div
                key={employee.id}
                className="rounded-[var(--radius-tile)] p-3.5 flex items-center gap-3"
                style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
              >
                <span
                  className="size-9 rounded-full flex items-center justify-center text-11 font-bold shrink-0"
                  style={{ background: "var(--tone-sunken)" }}
                >
                  {(employee.name || employee.phone || "?").charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-12 font-bold truncate">{employee.name || employee.phone}</p>
                  <p className="text-10 truncate" style={{ color: "var(--text-secondary)" }}>
                    {employee.roleName || employee.jobTitle || t("nav.team")}
                  </p>
                </div>
                {canSeeSales && (
                  <span className="text-11 font-semibold tabular-nums shrink-0">
                    {formatCurrency(total)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
