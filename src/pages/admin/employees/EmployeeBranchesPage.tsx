import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Store } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useRolesStore } from "@/stores/rolesStore";
import { useShellBase } from "@/lib/useShellBase";
import { branchKind } from "@/lib/branchKind";
import { supabase } from "@/lib/supabase";

interface BranchRow {
  id: string;
  name: string;
  is_default: boolean;
}

/**
 * The branches a person is enrolled in, read from the same access model that authorizes them.
 * The screen is a list of doors, not an editor: tap a branch to see only that branch's numbers.
 */
export default function EmployeeBranchesPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const base = useShellBase();
  const { language } = useThemeStore();
  const t = useT();
  const employees = useEmployeesStore((s) => s.employees);
  const employeesReady = useEmployeesStore((s) => s.ready);
  const getEmployeeAccess = useEmployeesStore((s) => s.getEmployeeAccess);
  const getEmployeePerformance = useEmployeesStore((s) => s.getEmployeePerformance);
  const rolesStore = useRolesStore();
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [branchScope, setBranchScope] = useState<string[] | null>(null);
  const [roleId, setRoleId] = useState<string | null>(null);
  const [branchRoles, setBranchRoles] = useState<Record<string, { roleId: string | null; roleName: string | null }>>({});
  const [loading, setLoading] = useState(true);

  const emp = employees.find((employee) => employee.id === employeeId);
  const rtl = language === "ur";

  useEffect(() => {
    void rolesStore.load();
    void supabase.from("branches").select("id, name, is_default").eq("is_active", true).then(({ data }) => {
      setBranches((data as BranchRow[]) ?? []);
    });
  }, []);

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    Promise.all([
      getEmployeeAccess(employeeId),
      getEmployeePerformance(employeeId).catch(() => null),
    ])
      .then(([access]) => {
        if (cancelled) return;
        setBranchScope(access.branchScope);
        setRoleId(access.roleId);
        setBranchRoles(access.branchRoles);
      })
      .catch(() => {
        if (!cancelled) setBranchScope([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [employeeId, getEmployeeAccess, getEmployeePerformance]);

  if (!emp) {
    return (
      <div style={{ background: "var(--background)", color: "var(--text-primary)" }} className="flex flex-col min-h-full">
        <StatusBar />
        <NavHeader title={t("empBranches.title")} backTo={`${base}/employees`} />
        {employeesReady ? (
          <p className="text-13 text-center py-16" style={{ color: "var(--text-secondary)" }}>{t("empDetail.notFound")}</p>
        ) : (
          <SkeletonList rows={4} />
        )}
      </div>
    );
  }

  const scope = branchScope === null ? branches : branches.filter((branch) => branchScope.includes(branch.id));
  const defaultRoleName = (roleId ? rolesStore.roles.find((role) => role.id === roleId)?.name : null)
    ?? emp.roleName
    ?? t("empDetail.noRole");
  const roleFor = (branchId: string) =>
    branchRoles[branchId]?.roleName
    ?? (branchRoles[branchId]?.roleId
      ? rolesStore.roles.find((role) => role.id === branchRoles[branchId].roleId)?.name
      : null)
    ?? defaultRoleName;

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="flex flex-col w-full min-h-full pb-10"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="employee-branches-page"
    >
      <StatusBar />
      <NavHeader title={t("empBranches.title")} backTo={`${base}/employees/${emp.id}`} />

      <div className="px-4 pt-1">
        <p className="text-12" style={{ color: "var(--text-secondary)", lineHeight: 1.6 }}>
          {t("empBranches.intro")}
        </p>
        <p className="text-11 mt-2" style={{ color: "var(--text-tertiary)", lineHeight: 1.55 }}>
          {t("empBranches.introTwo")}
        </p>
      </div>

      <div className="px-4 pt-5">
        {loading ? (
          <SkeletonList rows={3} />
        ) : scope.length === 0 ? (
          <div
            className="rounded-[var(--radius-card)] p-6 text-center"
            style={{ background: "var(--tone-card)" }}
          >
            <Store size={22} className="mx-auto mb-2" style={{ color: "var(--text-secondary)" }} />
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("empBranches.empty")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {scope.map((branch) => (
              <button
                key={branch.id}
                type="button"
                onClick={() => navigate(`${base}/employees/${emp.id}/performance?branch=${encodeURIComponent(branch.id)}`)}
                className="rounded-[var(--radius-card)] px-4 py-3.5 flex items-center gap-3 text-start active:opacity-70"
                style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
              >
                <span
                  className="size-10 rounded-[var(--radius-tile)] flex items-center justify-center shrink-0"
                  style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                >
                  <Store size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-13 font-semibold truncate">{branch.name}</span>
                    <span
                      className="text-9 font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                      style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                    >
                      {branchKind(t, branch.is_default)}
                    </span>
                  </span>
                  <span className="block text-10 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                    {roleFor(branch.id)}
                  </span>
                </span>
                <ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="px-4 pt-5">
        <button
          type="button"
          onClick={() => navigate(`${base}/employees/${emp.id}/role?customize=1`)}
          className="w-full h-11 rounded-[var(--radius-field)] text-12 font-semibold active:opacity-70"
          style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)", color: "var(--text-primary)" }}
        >
          {t("empBranches.manage")}
        </button>
      </div>
    </div>
  );
}
