import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Photo from "@/components/ui/Photo";
import {
  Calendar,
  ChevronRight,
  Copy,
  Download,
  History,
  Mail,
  Phone,
  Search,
  ShieldCheck,
  ShoppingCart,
  Store,
  UserCheck,
  UserX,
  Users,
  Wallet,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListRow from "@/components/ui/ListRow";
import Sheet from "@/components/ui/Sheet";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { SkeletonList } from "@/components/ui/Skeleton";
import { SectionActionsButton } from "@/components/ui/SectionActionsSheet";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import {
  useEmployeesStore,
  type EmployeeBranchRole,
  type EmployeePerformance,
} from "@/stores/employeesStore";
import { useShopStore } from "@/stores/shopStore";
import { useRolesStore } from "@/stores/rolesStore";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { hasPermission } from "@/lib/tenantContext";
import { useShellBase } from "@/lib/useShellBase";
import { formatCurrency } from "@/lib/formatters";
import type { MembershipRole } from "@/types";

interface EmployeeAccessSummary {
  roleId: string | null;
  membershipRole: MembershipRole;
  branchScope: string[] | null;
  branchRoles: Record<string, EmployeeBranchRole>;
}

function initialsOf(name: string): string {
  return name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

/**
 * The employee's front page.
 *
 * The screen answers three questions before it offers a single write: who this person is, what
 * their work has produced, and which scoped screen owns the rest of the detail. Access editing,
 * branch assignment and invitation repair each live on their own screen now; the overflow sheet
 * is the only place that needs to know all of them.
 */
export default function EmployeeDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const base = useShellBase();
  const { language } = useThemeStore();
  const t = useT();
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const canViewActivity = hasPermission("activity.view");
  const employees = useEmployeesStore((s) => s.employees);
  const employeesReady = useEmployeesStore((s) => s.ready);
  const getEmployeeAccess = useEmployeesStore((s) => s.getEmployeeAccess);
  const getEmployeePerformance = useEmployeesStore((s) => s.getEmployeePerformance);
  const setActiveAction = useEmployeesStore((s) => s.setActive);
  const roles = useRolesStore((s) => s.roles);
  const loadRoles = useRolesStore((s) => s.load);
  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const [access, setAccess] = useState<EmployeeAccessSummary | null>(null);
  const [performance, setPerformance] = useState<EmployeePerformance | null>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [branchesOpen, setBranchesOpen] = useState(false);
  const [period, setPeriod] = useState<"all" | "today">("all");
  const [confirmAction, setConfirmAction] = useState<null | "deactivate" | "cancelInvite" | "reactivate">(null);
  const [statusBusy, setStatusBusy] = useState(false);
  const statusBusyRef = useRef(false);

  const emp = employees.find((employee) => employee.id === employeeId);
  const isUrdu = language === "ur";
  const employeesParent = base === "/co-owner" ? `${base}/team` : `${base}/employees`;

  useEffect(() => { void loadRoles(); }, [loadRoles]);
  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    setAccess(null);
    getEmployeeAccess(employeeId)
      .then((next) => {
        if (!cancelled) {
          setAccess({
            roleId: next.roleId,
            membershipRole: next.membershipRole,
            branchScope: next.branchScope,
            branchRoles: next.branchRoles,
          });
        }
      })
      .catch(() => { if (!cancelled) setAccess(null); });
    return () => { cancelled = true; };
  }, [employeeId, getEmployeeAccess]);

  useEffect(() => {
    if (!employeeId) return;
    let cancelled = false;
    setPerformance(null);
    getEmployeePerformance(employeeId)
      .then((next) => { if (!cancelled) setPerformance(next); })
      .catch(() => { if (!cancelled) setPerformance(null); });
    return () => { cancelled = true; };
  }, [employeeId, getEmployeePerformance]);

  const assignedBranches = useMemo(() => {
    if (!access) return [];
    return access.branchScope === null
      ? branches
      : branches.filter((branch) => access.branchScope?.includes(branch.id));
  }, [access, branches]);

  const chartRows = useMemo(() => {
    const lineByBranch = new Map(
      (performance?.branches ?? []).map((line) => [line.branchId, line]),
    );
    const rows = assignedBranches.length > 0
      ? assignedBranches.map((branch) => {
          const line = lineByBranch.get(branch.id);
          return {
            id: branch.id,
            name: branch.name,
            value: (period === "today" ? line?.todayRevenue : line?.revenue) ?? 0,
          };
        })
      : (performance?.branches ?? []).map((line) => ({
          id: line.branchId ?? line.branchName ?? "branch",
          name: line.branchName ?? "—",
          value: period === "today" ? line.todayRevenue : line.revenue,
        }));
    return rows.sort((left, right) => right.value - left.value);
  }, [assignedBranches, performance, period]);
  const hasChart = chartRows.some((row) => row.value > 0);

  if (!emp) {
    return (
      <div style={{ background: "var(--background)", color: "var(--text-primary)" }} className="flex flex-col min-h-full">
        <StatusBar />
        <NavHeader title={t("admin.employees")} backTo={employeesParent} />
        {employeesReady ? (
          <div className="flex flex-col items-center py-20 gap-2">
            <Search size={28} className="mx-auto block" style={{ color: "var(--text-tertiary)" }} />
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("empDetail.notFound")}</p>
          </div>
        ) : (
          <SkeletonList rows={4} />
        )}
      </div>
    );
  }

  const isOwner = access?.membershipRole === "owner" || emp.isOriginalOwner;
  const isInvited = emp.membershipStatus === "pending" && emp.isActive;
  const isActive = emp.isActive;
  const canEditAccess = user?.membershipRole === "owner" && !emp.isOriginalOwner && !isOwner;
  const canSeeSalary = user?.membershipRole === "owner" && !emp.isOriginalOwner;
  const role = access?.roleId ? roles.find((candidate) => candidate.id === access.roleId) ?? null : null;
  const roleName = isOwner
    ? t("empDetail.ownerFull")
    : role?.name ?? emp.roleName ?? t("empDetail.noRole");
  const branchCount = access?.branchScope === null
    ? branches.length
    : assignedBranches.length || performance?.branches.length || 0;
  const branchLabel = isOwner || access?.branchScope === null
    ? t("addEmployee.allBranches")
    : t("empDetail.branchCount", { count: branchCount });
  const lastLogin = emp.lastLoginAt
    ? new Date(emp.lastLoginAt).toLocaleString(isUrdu ? "ur-PK" : "en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : t("empDetail.neverLoggedIn");
  const memberSince = new Date(emp.createdAt).toLocaleDateString(isUrdu ? "ur-PK" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
  const totals = performance?.totals ?? { salesCount: 0, revenue: 0, itemsSold: 0, customers: 0, todaySales: 0, todayRevenue: 0 };
  const shownRevenue = period === "today" ? totals.todayRevenue : totals.revenue;
  const maxBranchValue = Math.max(1, ...chartRows.map((row) => row.value));
  const branchRoleName = (branchId: string) => {
    if (isOwner) return t("empDetail.ownerFull");
    const branchRole = access?.branchRoles?.[branchId];
    if (branchRole?.roleName) return branchRole.roleName;
    if (branchRole?.roleId) {
      return roles.find((candidate) => candidate.id === branchRole.roleId)?.name ?? roleName;
    }
    return roleName;
  };
  const statusLabel = isInvited
    ? t("employees.invited")
    : isActive
      ? t("employees.active")
      : t("employees.deactivated");

  function closeAndGo(path: string) {
    setActionsOpen(false);
    navigate(path);
  }

  async function copyEmployeeNumber() {
    try {
      await navigator.clipboard.writeText(emp!.employeeNumber ?? emp!.phone);
      addToast(t("empDetail.copied"), "success");
    } catch {
      addToast(t("common.error"), "error");
    }
  }

  function exportDetails() {
    const rows: Array<Array<string | number>> = [
      [t("empDetail.name"), emp!.name],
      [t("empDetail.phone"), emp!.phone],
      [t("empDetail.number"), emp!.employeeNumber ?? ""],
      [t("empDetail.rolePermissions"), roleName],
      [t("empDetail.assignedBranches"), branchLabel],
      [t("empDetail.accountStatus"), statusLabel],
      [t("empDetail.lastLogin"), lastLogin],
      [t("empDetail.memberSince"), memberSince],
      [t("empDetail.totalRevenue"), totals.revenue],
      [t("empDetail.totalSales"), totals.salesCount],
      [t("employee.itemsSold"), totals.itemsSold],
      [t("empDetail.customers"), totals.customers],
    ];
    const csv = rows
      .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
      .join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${emp!.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "employee"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setActionsOpen(false);
    addToast(t("empDetail.exported"), "success");
  }

  async function updateStatus(next: boolean) {
    try {
      await setActiveAction(emp!.id, next, user?.id);
      addToast(
        next
          ? t("empDetail.reactivated", { name: emp!.name })
          : isInvited
            ? t("empDetail.inviteCancelled", { name: emp!.name })
            : t("empDetail.deactivated", { name: emp!.name }),
        next ? "success" : "info",
      );
    } catch (error) {
      addToast(error instanceof Error ? error.message : t("common.error"), "error");
    }
  }

  async function runStatusChange() {
    if (statusBusyRef.current || !confirmAction) return;
    statusBusyRef.current = true;
    setStatusBusy(true);
    try {
      await updateStatus(confirmAction === "reactivate");
      setConfirmAction(null);
    } finally {
      statusBusyRef.current = false;
      setStatusBusy(false);
    }
  }

  return (
    <div
      dir={isUrdu ? "rtl" : "ltr"}
      className="flex flex-col w-full min-h-full pb-10"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="employee-profile-page"
    >
      <StatusBar />
      <NavHeader
        title={t("empDetail.profileTitle")}
        backTo={employeesParent}
        right={
          <SectionActionsButton
            onClick={() => setActionsOpen(true)}
            label={t("empDetail.actions")}
            testId="employee-actions"
          />
        }
      />

      <div className="px-4 pt-1 pb-4" style={{ borderBottom: "1px solid var(--divider)" }}>
        <div>
          <div className="flex items-start gap-3">
            <Photo
              src={emp.photoUrl}
              alt={emp.name}
              className="size-14 rounded-[var(--radius-tile)] object-cover shrink-0"
              fallback={
                <div
                  className="size-14 rounded-[var(--radius-tile)] flex items-center justify-center text-18 font-bold shrink-0"
                  style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
                >
                  {initialsOf(emp.name)}
                </div>
              }
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <p className="text-16 font-bold truncate">{emp.name}</p>
                <span
                  className="text-9 font-bold px-2 py-0.5 rounded-full shrink-0"
                  style={isActive
                    ? { background: "var(--brand-light)", color: "var(--brand-dark)" }
                    : { background: "var(--error-bg)", color: "var(--error)" }}
                >
                  {statusLabel}
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1 min-w-0">
                <p className="text-10 truncate" style={{ color: "var(--text-secondary)" }}>
                  {roleName} · {emp.employeeNumber ?? "—"}
                </p>
                <button
                  type="button"
                  onClick={() => void copyEmployeeNumber()}
                  aria-label={t("empDetail.copy")}
                  className="flex items-center gap-0.5 text-9 font-semibold shrink-0 active:opacity-60"
                  style={{ color: "var(--text-secondary)" }}
                >
                  <Copy size={10} /> {t("empDetail.copy")}
                </button>
              </div>
              <p className="text-12 mt-1.5 truncate" style={{ color: "var(--text-primary)" }}>{emp.phone}</p>
            </div>
            <button
              type="button"
              onClick={() => window.open(`tel:${emp.phone}`, "_self")}
              className="h-9 px-3.5 rounded-full flex items-center gap-1.5 text-11 font-bold shrink-0 active:opacity-70"
              style={{ border: "1px solid var(--border-control)", background: "transparent", color: "var(--text-primary)" }}
            >
              <Phone size={13} />
              {t("empDetail.call")}
            </button>
          </div>
        </div>
      </div>

      {isInvited && (
        <div className="px-4 py-3 flex items-center gap-3" style={{ borderBottom: "1px solid var(--divider)" }}>
            <Mail size={15} className="shrink-0" style={{ color: "var(--warning, #f59e0b)" }} />
            <div className="min-w-0 flex-1">
              <p className="text-11 font-semibold">{t("empDetail.invitationPending")}</p>
              <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                {t("empDetail.invitationPendingHint", { name: emp.name })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate(`${base}/employees/${emp.id}/invitation`)}
              className="shrink-0 text-10 font-bold active:opacity-60"
              style={{ color: "var(--text-primary)" }}
            >
              {t("empDetail.viewInvitation")}
            </button>
        </div>
      )}

      <div className="px-4 pt-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-14 font-semibold" style={{ color: "var(--text-secondary)" }}>
            {t("empDetail.overview")}
          </p>
          {!isInvited && (
            <button
              type="button"
              onClick={() => navigate(`${base}/employees/${emp.id}/performance`)}
              className="text-11 font-semibold flex items-center gap-0.5 active:opacity-60"
              style={{ color: "var(--text-secondary)" }}
            >
              {t("empPerformance.detailed")} <ChevronRight size={12} />
            </button>
          )}
        </div>
        {isInvited ? (
          <div className="flex items-start gap-3 py-4" style={{ borderBottom: "1px solid var(--divider)" }}>
            <ShoppingCart size={18} className="shrink-0 mt-0.5" style={{ color: "var(--text-secondary)" }} />
            <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("empDetail.noPerformance")}</p>
          </div>
        ) : (
          <div className="pt-3" data-testid="employee-performance-overview">
            <div className="flex items-center gap-5" role="tablist" aria-label={t("empDetail.overview")}>
              {(["all", "today"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={period === key}
                  onClick={() => setPeriod(key)}
                  className="pb-1 text-12 font-semibold active:opacity-60"
                  style={{
                    color: period === key ? "var(--text-primary)" : "var(--text-secondary)",
                    borderBottom: period === key ? "2px solid var(--brand)" : "2px solid transparent",
                  }}
                >
                  {key === "all" ? t("empDetail.allTime") : t("empDetail.today")}
                </button>
              ))}
            </div>

            <p className="text-10 mt-4" style={{ color: "var(--text-secondary)" }}>
              {t("empDetail.totalRevenue")}
            </p>
            <p className="text-28 font-bold tabular-nums mt-0.5" data-testid="employee-revenue">
              {formatCurrency(shownRevenue)}
            </p>

            <div
              className={`grid ${period === "all" ? "grid-cols-3" : "grid-cols-1"} gap-3 mt-4 pt-3`}
              style={{ borderTop: "1px solid var(--divider)" }}
            >
              {[
                {
                  label: t("empDetail.totalSales"),
                  value: period === "today" ? totals.todaySales : totals.salesCount,
                },
                ...(period === "all"
                  ? [
                      { label: t("employee.itemsSold"), value: totals.itemsSold },
                      { label: t("empDetail.customers"), value: totals.customers },
                    ]
                  : []),
              ].map((stat) => (
                <div key={stat.label}>
                  <p className="text-10" style={{ color: "var(--text-secondary)" }}>{stat.label}</p>
                  <p className="text-15 font-bold tabular-nums mt-0.5">{stat.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 pt-4" style={{ borderTop: "1px solid var(--divider)" }} data-testid="employee-branch-performance">
              <p className="text-12 font-semibold" style={{ color: "var(--text-secondary)" }}>
                {t("overall.branchPerformance")}
              </p>
              {chartRows.length === 0 || !hasChart ? (
                <p className="text-11 mt-2" style={{ color: "var(--text-tertiary)" }}>
                  {t("empDetail.branchPerformanceEmpty")}
                </p>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  {chartRows.map((row) => (
                    <div key={row.id}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-11 truncate" style={{ color: "var(--text-primary)" }}>{row.name}</span>
                        <span className="text-11 font-semibold tabular-nums shrink-0">{formatCurrency(row.value)}</span>
                      </div>
                      <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: "var(--muted)" }}>
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${row.value > 0 ? Math.max(4, (row.value / maxBranchValue) * 100) : 0}%`,
                            background: "var(--brand)",
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="px-4 pt-5">
        <p className="text-14 font-semibold" style={{ color: "var(--text-secondary)" }}>{t("empDetail.access")}</p>
        <ListRow
          icon={ShieldCheck}
          title={t("empDetail.rolePermissions")}
          meta={isOwner ? t("empDetail.ownerFull") : roleName}
          trailing={<ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />}
          onClick={() => navigate(`${base}/employees/${emp.id}/role`)}
          style={{ borderBottom: "1px solid var(--divider)" }}
        />
      </div>

      <div className="px-4 pt-5">
        <p className="text-14 font-semibold" style={{ color: "var(--text-secondary)" }}>{t("empDetail.workAssignment")}</p>
        <ListRow
          icon={Store}
          title={t("empDetail.assignedBranches")}
          meta={branchLabel}
          trailing={<ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />}
          onClick={() => setBranchesOpen(true)}
          style={{ borderBottom: "1px solid var(--divider)" }}
        />
      </div>

      {canSeeSalary && (
        <div className="px-4 pt-5">
          <p className="text-14 font-semibold" style={{ color: "var(--text-secondary)" }}>{t("empDetail.salary")}</p>
          <ListRow
            icon={Wallet}
            title={t("employeeSalary.title")}
            description={t("empDetail.salaryHint")}
            trailing={<ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />}
            onClick={() => navigate(`${base}/employees/${emp.id}/salary`)}
            style={{ borderBottom: "1px solid var(--divider)" }}
          />
        </div>
      )}

      {canViewActivity && (
        <div className="px-4 pt-5">
          <p className="text-14 font-semibold" style={{ color: "var(--text-secondary)" }}>{t("empDetail.businessActivity")}</p>
          <ListRow
            icon={History}
            testId="emp-activity-link"
            title={t("empDetail.recentActivity")}
            trailing={<ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />}
            onClick={() => navigate(`${base}/settings/hub/people/activity/${emp.id}`)}
            style={{ borderBottom: "1px solid var(--divider)" }}
          />
        </div>
      )}

      <div className="px-4 pt-5">
        <p className="text-14 font-semibold" style={{ color: "var(--text-secondary)" }}>{t("empDetail.accountSecurity")}</p>
        <ListRow
          icon={Calendar}
          title={t("empDetail.lastLogin")}
          value={lastLogin}
          style={{ borderBottom: "1px solid var(--divider)" }}
        />
        <ListRow
          icon={Users}
          title={t("empDetail.memberSince")}
          value={memberSince}
        />
      </div>

      <Sheet
        open={branchesOpen}
        title={t("empDetail.assignedBranches")}
        onClose={() => setBranchesOpen(false)}
        closeButton={false}
      >
        <div className="px-4">
          {assignedBranches.length === 0 ? (
            <p className="text-12 py-6 text-center" style={{ color: "var(--text-secondary)" }}>
              {t("empBranches.empty")}
            </p>
          ) : (
            assignedBranches.map((branch, index) => (
              <ListRow
                key={branch.id}
                icon={Store}
                title={branch.name}
                meta={branchRoleName(branch.id)}
                style={index < assignedBranches.length - 1 ? { borderBottom: "1px solid var(--divider)" } : undefined}
              />
            ))
          )}
        </div>
      </Sheet>

      <Sheet
        open={actionsOpen}
        title={t("empDetail.actions")}
        onClose={() => setActionsOpen(false)}
        closeButton={false}
      >
        <div className="px-4 pt-1">
          <ListRow
            icon={ShieldCheck}
            title={t("empDetail.manageAccess")}
            onClick={() => closeAndGo(`${base}/employees/${emp.id}/role`)}
          />
          <ListRow
            icon={Store}
            title={t("empDetail.manageBranches")}
            onClick={() => closeAndGo(`${base}/employees/${emp.id}/branches`)}
          />
          {canSeeSalary && (
            <ListRow
              icon={Wallet}
              title={t("employeeSalary.title")}
              onClick={() => closeAndGo(`${base}/employees/${emp.id}/salary`)}
            />
          )}
          {isInvited && (
            <ListRow
              icon={Mail}
              title={t("empDetail.resendInvitation")}
              onClick={() => closeAndGo(`${base}/employees/${emp.id}/invitation`)}
            />
          )}
          {canViewActivity && (
            <ListRow
              icon={History}
              title={t("empDetail.viewAccessHistory")}
              onClick={() => closeAndGo(`${base}/settings/hub/people/activity/${emp.id}`)}
            />
          )}
          <ListRow
            icon={Download}
            title={t("empDetail.exportDetails")}
            onClick={exportDetails}
          />
          {!emp.isOriginalOwner && isActive && (
            <ListRow
              icon={UserX}
              danger
              title={isInvited ? t("empDetail.cancelInvite") : t("empDetail.deactivateShort")}
              onClick={() => {
                setActionsOpen(false);
                setConfirmAction(isInvited ? "cancelInvite" : "deactivate");
              }}
            />
          )}
          {!emp.isOriginalOwner && !isActive && (
            <ListRow
              icon={UserCheck}
              title={t("empDetail.reactivateShort")}
              onClick={() => {
                setActionsOpen(false);
                setConfirmAction("reactivate");
              }}
            />
          )}
          {canEditAccess && (
            <ListRow
              icon={UserCheck}
              title={t("empDetail.customize")}
              onClick={() => closeAndGo(`${base}/employees/${emp.id}/role?customize=1`)}
            />
          )}
        </div>
      </Sheet>

      <ConfirmDialog
        open={confirmAction !== null}
        title={
          confirmAction === "cancelInvite"
            ? t("empDetail.cancelInviteQ", { name: emp.name })
            : confirmAction === "reactivate"
              ? t("empDetail.reactivateQ", { name: emp.name })
              : t("empDetail.deactivateQ", { name: emp.name })
        }
        message={
          confirmAction === "cancelInvite"
            ? t("empDetail.cancelInviteHint")
            : confirmAction === "reactivate"
              ? t("empDetail.reactivateHint")
              : t("empDetail.deactivateHint")
        }
        confirmLabel={
          confirmAction === "cancelInvite"
            ? t("empDetail.cancelInvite")
            : confirmAction === "reactivate"
              ? t("empDetail.reactivate")
              : t("empDetail.deactivate")
        }
        cancelLabel={t("common.cancel")}
        destructive={confirmAction !== "reactivate"}
        loading={statusBusy}
        onConfirm={runStatusChange}
        onCancel={() => !statusBusy && setConfirmAction(null)}
      />
    </div>
  );
}
