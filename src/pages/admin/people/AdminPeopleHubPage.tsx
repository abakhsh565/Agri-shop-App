import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Building2, ChevronRight, History, Plus, ShieldCheck, UserPlus, Users } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { hasPermission } from "@/lib/tenantContext";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useShopStore } from "@/stores/shopStore";
import { listEmployeeAccessRequests } from "@/lib/employeeAccessRequests";
import { hubSection } from "@/lib/settingsHub";
import type { User } from "@/types";

/**
 * Employees & Access — who works here, what they do, and where.
 *
 * SHAPE (owner's reference, 2026-10-29): the section's name in the bar, then search, the two
 * counts the owner checks first — how many people there are, and how many invitations are still
 * waiting — four status filters, and one card per person carrying their role, their branch and
 * the state of their account. The card ends with "View employee", which is also what tapping
 * anywhere on it does.
 *
 * WHY IT IS THE SECTION ITSELF, not a list of jobs. The generic hub asked the owner to open
 * "Employees" before seeing any employee, and then offered four more rows that each opened a
 * screen this page now links to directly. The directory is the question; roles, assignments and
 * activity are things you do to the people in it, so they sit under "Manage access" below the
 * list rather than in front of it.
 *
 * THE PEOPLE ARE THE BUSINESS'S, NOT ONE BRANCH'S. The old list narrowed to the working branch,
 * which is right for a branch's roster but wrong for this screen: the directory and the branch
 * assignment screen must agree about who works where, and the reference shows people from more
 * than one branch side by side. The branch each person belongs to is stated on their row, and an
 * employee with no branch restriction says "All branches" instead of being assigned to one.
 *
 * THE ROLE IS READ WITH THE TEAM. `roleName` arrives from the employees store (one roles read)
 * rather than one `get_employee_access` call per row, so the directory cannot cost an RPC per
 * employee and still opens for a viewer who may read the team but not inspect each person.
 */
type StatusFilter = "all" | "active" | "pending" | "deactivated";

function statusOf(employee: User): Exclude<StatusFilter, "all"> {
  if (!employee.isActive) return "deactivated";
  if (employee.membershipStatus === "pending") return "pending";
  return "active";
}

function statusColor(status: Exclude<StatusFilter, "all">) {
  if (status === "deactivated") return { bg: "var(--error-bg)", color: "var(--error)" };
  if (status === "pending") return { bg: "var(--warning-bg)", color: "var(--warning)" };
  return { bg: "var(--brand-light)", color: "var(--brand-dark)" };
}

export default function AdminPeopleHubPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const employees = useEmployeesStore((s) => s.employees);
  const ready = useEmployeesStore((s) => s.ready);
  const load = useEmployeesStore((s) => s.load);
  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);

  const canManage = hasPermission("employees.manage");
  const canSeeActivity = hasPermission("activity.view");

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [pendingRequests, setPendingRequests] = useState(0);

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);
  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);

  // An access request stays actionable after its notification is marked read, so the directory
  // carries the same small door the old list had. A view-only role never calls the RPC.
  useEffect(() => {
    if (!canManage) return;
    let alive = true;
    void listEmployeeAccessRequests("pending")
      .then((rows) => { if (alive) setPendingRequests(rows.length); })
      .catch(() => { if (alive) setPendingRequests(0); });
    return () => { alive = false; };
  }, [canManage]);

  const branchNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const branch of branches) map.set(branch.id, branch.name);
    return map;
  }, [branches]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return employees.filter((employee) => {
      if (filter !== "all" && statusOf(employee) !== filter) return false;
      if (!needle) return true;
      return (
        employee.name.toLowerCase().includes(needle) ||
        employee.phone.toLowerCase().includes(needle)
      );
    });
  }, [employees, query, filter]);

  const pendingCount = employees.filter((employee) => statusOf(employee) === "pending").length;

  /** The role line: what they do, then where. Owner is a role even without a template. */
  function roleLine(employee: User): string {
    const role = employee.isOriginalOwner
      ? t("settings.owner")
      : employee.roleName || employee.jobTitle || t("empDetail.noRole");
    return `${role} · ${branchLine(employee)}`;
  }

  /** Where they work: none of the branch restriction, one branch, or several. */
  function branchLine(employee: User): string {
    if (employee.branchScope == null) return t("people.allBranches");
    if (employee.branchScope.length === 0) return t("people.noBranch");
    if (employee.branchScope.length === 1) {
      return branchNameById.get(employee.branchScope[0]) ?? t("people.noBranch");
    }
    return t("people.branchCount", { count: String(employee.branchScope.length) });
  }

  function openEmployee(employee: User) {
    navigate(`${base}/employees/${employee.id}`);
  }

  // The destinations below the roster come from the same catalogue the Settings menu reads.
  // The directory itself is this page, so the "Employees" row that only described it is not
  // repeated; the invite row is, because adding somebody is a job you start from the roster.
  const manageRows = (hubSection("people")?.rows ?? []).filter((row) =>
    ["invite", "roles", "branches", "activity"].includes(row.id),
  );

  const filters: { key: StatusFilter; label: string }[] = [
    { key: "all", label: t("people.filterAll") },
    { key: "active", label: t("employees.active") },
    { key: "pending", label: t("people.filterPending") },
    { key: "deactivated", label: t("employees.deactivated") },
  ];

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="people-hub-page"
    >
      <StatusBar />
      <NavHeader
        title={t("settings.menu.people")}
        backTo={`${base}/settings`}
        right={
          canManage ? (
            <button
              type="button"
              onClick={() => navigate(`${base}/employees/new`)}
              aria-label={t("people.addEmployee")}
              data-testid="people-add-employee"
              className="w-11 h-11 flex items-center justify-center rounded-full ds-pressable"
              style={{ color: "var(--text-primary)" }}
            >
              <Plus size={18} />
            </button>
          ) : undefined
        }
      />

      <div className="px-4 pt-1">
        <SearchBar
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder={t("people.searchPlaceholder")}
          aria-label={t("people.searchPlaceholder")}
          data-testid="people-search"
        />

        {/* The two counts the roster is read with. They are counts of the loaded team, not a
            second server read, so a chip below can never describe a different population. */}
        <div className="grid grid-cols-2 gap-4 mt-4">
          <div data-testid="people-total">
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {t("people.totalEmployees")}
            </p>
            <p className="text-26 font-bold mt-0.5 tabular-nums">
              {ready ? employees.length.toLocaleString("en-PK") : "—"}
            </p>
          </div>
          <div data-testid="people-pending">
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {t("people.pendingInvitations")}
            </p>
            <p className="text-26 font-bold mt-0.5 tabular-nums">
              {ready ? pendingCount.toLocaleString("en-PK") : "—"}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mt-4 overflow-x-auto" role="group" aria-label={t("people.filterAll")}>
          {filters.map((option) => {
            const selected = filter === option.key;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setFilter(option.key)}
                data-testid={`people-filter-${option.key}`}
                className="h-8 px-3.5 rounded-full text-12 font-semibold shrink-0 transition-colors"
                style={
                  selected
                    ? { background: "var(--brand)", color: "#0a0a0a" }
                    : { background: "var(--tone-card)", color: "var(--text-secondary)" }
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 pt-4 pb-2">
        <p className="ds-section px-0 mb-2">{t("hub.people.employees")}</p>
      </div>

      <div className="px-4 pb-6 flex flex-col gap-2">
        {!ready && <SkeletonList rows={4} tile />}

        {ready && visible.length === 0 && (
          <EmptyState
            icon={Users}
            title={query || filter !== "all" ? t("people.noMatch") : t("empList.empty")}
          />
        )}

        {ready && visible.map((employee) => {
          const status = statusOf(employee);
          const { bg, color } = statusColor(status);
          return (
            <button
              key={employee.id}
              type="button"
              onClick={() => openEmployee(employee)}
              data-testid={`people-employee-${employee.id}`}
              className="w-full text-start rounded-[var(--radius-card)] p-3.5 ds-pressable"
              style={{ background: "var(--tone-card)", color: "var(--text-primary)" }}
            >
              <div className="flex items-start gap-3">
                <div
                  className="size-10 rounded-full flex items-center justify-center font-bold text-14 shrink-0"
                  style={{
                    background: status === "active" ? "var(--brand)" : "var(--surface-2)",
                    color: status === "active" ? "#0a0a0a" : "var(--text-secondary)",
                  }}
                  aria-hidden
                >
                  {employee.name ? employee.name.charAt(0) : "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-14 font-bold truncate min-w-0">{employee.name}</p>
                    <span
                      className="shrink-0 text-9 font-bold px-2 py-0.5 rounded-full"
                      style={{ background: bg, color }}
                    >
                      {status === "active"
                        ? t("employees.active")
                        : status === "pending"
                          ? t("employees.invited")
                          : t("employees.deactivated")}
                    </span>
                  </div>
                  <p
                    className="text-11 mt-0.5 truncate"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {roleLine(employee)}
                  </p>
                </div>
              </div>
              <div
                className="mt-2 flex items-center justify-end gap-1 text-11 font-semibold"
                style={{ color: "var(--text-secondary)" }}
              >
                {t("people.viewEmployee")}
                <ChevronRight size={12} className="shrink-0" />
              </div>
            </button>
          );
        })}
      </div>

      {/* The connected screens. They are things you do TO the people above, so they follow the
          roster rather than standing in front of it. */}
      <div className="px-4 pb-10">
        <p className="ds-section px-0 mb-2">{t("people.manageAccess")}</p>
        {canManage && pendingRequests > 0 && (
          <ListRow
            testId="people-access-requests"
            icon={UserPlus}
            title={t("accessRequests.title")}
            description={t("accessRequests.pendingCount", { count: pendingRequests })}
            trailing={
              <ChevronRight
                size={14}
                style={{ color: "var(--text-secondary)" }}
                className="shrink-0"
              />
            }
            onClick={() => navigate(`${base}/employees/requests`)}
          />
        )}
        {manageRows
          .filter((row) => row.id !== "activity" || canSeeActivity)
          .map((row) => {
              const Icon =
                row.id === "invite"
                  ? UserPlus
                  : row.id === "roles"
                    ? ShieldCheck
                    : row.id === "branches"
                      ? Building2
                      : History;
              return (
                <ListRow
                  key={row.id}
                  testId={`people-manage-${row.id}`}
                  icon={Icon}
                  title={t(row.labelKey)}
                  description={row.hintKey ? t(row.hintKey) : undefined}
                  trailing={
                    <ChevronRight
                      size={14}
                      style={{ color: "var(--text-secondary)" }}
                      className="shrink-0"
                    />
                  }
                  onClick={() => navigate(`${base}${row.to}`)}
                />
              );
            })}
      </div>
    </div>
  );
}
