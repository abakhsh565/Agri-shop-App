import { useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronRight } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useShopStore } from "@/stores/shopStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import type { User } from "@/types";

/**
 * Branch assignments — who works where, grouped by branch.
 *
 * This is the read half of branch scope. The WRITE half stays on the employee's own page, where
 * `setEmployeeBranchScope` and the per-branch role editor already live; putting a second editor
 * here would be a second place for the same assignment to be right or wrong, and the person's
 * page is the only place that can also say what role they hold in each branch.
 *
 * An employee whose scope is `null` works in every branch — that is what the database means by
 * no restriction — so they appear under each branch and their line says "All branches" rather
 * than being shown in one arbitrary branch. Invitations are excluded: a pending membership is
 * not somebody working here yet, and the directory already counts them separately.
 */
export default function AdminBranchAssignmentsPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const employees = useEmployeesStore((s) => s.employees);
  const employeesReady = useEmployeesStore((s) => s.ready);
  const loadEmployees = useEmployeesStore((s) => s.load);

  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);
  useEffect(() => {
    if (!employeesReady) void loadEmployees();
  }, [employeesReady, loadEmployees]);

  const working = useMemo(
    () =>
      employees
        .filter((employee) => employee.isActive && employee.membershipStatus !== "pending")
        .sort((a, b) => a.name.localeCompare(b.name)),
    [employees],
  );

  function assignedTo(branchId: string): User[] {
    return working.filter(
      (employee) => employee.branchScope == null || employee.branchScope.includes(branchId),
    );
  }

  const loading = !branchesLoaded || !employeesReady;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="branch-assignments-page"
    >
      <StatusBar />
      <NavHeader
        title={t("hub.people.branches")}
        backTo={`${base}/settings/hub/people`}
      />

      <div className="px-4 pt-1 pb-2">
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>
          {t("people.branchAssignmentsHint")}
        </p>
      </div>

      <div className="px-4 pb-10 flex flex-col gap-2.5">
        {loading && <SkeletonList rows={3} />}

        {!loading && branches.length === 0 && (
          <p className="text-12" style={{ color: "var(--text-secondary)" }}>
            {t("people.noBranch")}
          </p>
        )}

        {!loading &&
          branches.map((branch) => {
            const team = assignedTo(branch.id);
            return (
              <div
                key={branch.id}
                className="rounded-[var(--radius-card)] p-4"
                style={{ background: "var(--tone-card)" }}
                data-testid={`branch-assignment-${branch.id}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-14 font-bold min-w-0 truncate">{branch.name}</p>
                  <p className="text-13 font-bold tabular-nums shrink-0">
                    {team.length.toLocaleString("en-PK")}
                  </p>
                </div>
                <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  {t("people.workingHere")}
                </p>

                {team.length === 0 ? (
                  <p className="text-11 mt-3" style={{ color: "var(--text-tertiary)" }}>
                    {t("people.noEmployeesInBranch")}
                  </p>
                ) : (
                  <div className="mt-2">
                    {team.map((employee) => (
                      <button
                        key={employee.id}
                        type="button"
                        onClick={() => navigate(`${base}/employees/${employee.id}`)}
                        data-testid={`branch-assignment-employee-${employee.id}`}
                        className="w-full flex items-center gap-3 py-2 text-start ds-pressable"
                      >
                        <div
                          className="size-8 rounded-full flex items-center justify-center text-11 font-bold shrink-0"
                          style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                          aria-hidden
                        >
                          {employee.name ? employee.name.charAt(0) : "?"}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-12 font-semibold truncate">{employee.name}</p>
                          <p
                            className="text-10 truncate"
                            style={{ color: "var(--text-secondary)" }}
                          >
                            {employee.isOriginalOwner
                              ? t("settings.owner")
                              : employee.roleName || employee.jobTitle || t("empDetail.noRole")}
                            {employee.branchScope == null ? ` · ${t("people.allBranches")}` : ""}
                          </p>
                        </div>
                        <ChevronRight
                          size={13}
                          className="shrink-0"
                          style={{ color: "var(--text-secondary)" }}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

        <div className="flex items-start gap-2.5 mt-1" style={{ color: "var(--text-tertiary)" }}>
          <Building2 size={14} className="shrink-0 mt-0.5" />
          <p className="text-10">{t("people.branchEditHint")}</p>
        </div>
      </div>
    </div>
  );
}
