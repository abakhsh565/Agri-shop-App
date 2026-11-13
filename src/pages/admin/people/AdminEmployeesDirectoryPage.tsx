import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Plus, Users } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { SkeletonList } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { hasPermission } from "@/lib/tenantContext";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";
import { useThemeStore } from "@/stores/themeStore";
import type { User } from "@/types";

/**
 * The roster — who works here, what they do, and where.
 *
 * The original owner is never a row in this directory: ownership is its own account and
 * workspace, not an employee assignment. Co-Owners are filtered by the employee store for
 * the same reason. This screen shows the people who can be managed as employees.
 */
type StatusFilter = "all" | "active" | "pending" | "deactivated";

function statusOf(employee: User): Exclude<StatusFilter, "all"> {
  if (!employee.isActive) return "deactivated";
  if (employee.membershipStatus === "pending") return "pending";
  return "active";
}

export default function AdminEmployeesDirectoryPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const employees = useEmployeesStore((s) => s.employees);
  const ready = useEmployeesStore((s) => s.ready);
  const load = useEmployeesStore((s) => s.load);
  const currentUserId = useAuthStore((s) => s.user?.id);
  const branches = useShopStore((s) => s.branches);
  const branchesLoaded = useShopStore((s) => s.branchesLoaded);
  const loadBranches = useShopStore((s) => s.loadBranches);
  const isRtl = useThemeStore((s) => s.language) === "ur";
  const ForwardChevron = isRtl ? ChevronLeft : ChevronRight;

  const canManage = hasPermission("employees.manage");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  useEffect(() => {
    if (!branchesLoaded) void loadBranches();
  }, [branchesLoaded, loadBranches]);

  const branchById = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch])),
    [branches],
  );

  function roleLine(employee: User): string {
    return employee.roleName || employee.jobTitle || t("empDetail.noRole");
  }

  function branchLine(employee: User): string {
    const scope = employee.branchScope ?? [];
    if (scope.length === 0) return t("people.allBranches");
    if (scope.length === 1) {
      return branchById.get(scope[0])?.name ?? t("people.noBranch");
    }
    return t("people.branchCount", { count: String(scope.length) });
  }

  function statusMeta(status: Exclude<StatusFilter, "all">) {
    if (status === "active") {
      return {
        label: t("employees.active"),
        bg: "var(--brand-light)",
        color: "var(--brand-dark)",
      };
    }
    if (status === "pending") {
      return {
        label: t("employees.invited"),
        bg: "var(--warning-bg)",
        color: "var(--warning)",
      };
    }
    return {
      label: t("employees.deactivated"),
      bg: "var(--tone-sunken)",
      color: "var(--text-secondary)",
    };
  }

  const visible = employees.filter((employee) => {
    // The signed-in account and the original owner are not employees in this directory.
    if (employee.id === currentUserId || employee.isOriginalOwner) return false;
    if (filter !== "all" && statusOf(employee) !== filter) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return [employee.name, employee.phone, roleLine(employee), branchLine(employee)]
      .join(" ")
      .toLowerCase()
      .includes(needle);
  });

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
      data-testid="employees-directory-page"
    >
      <StatusBar />
      <NavHeader title={t("hub.people.employees")} backTo={`${base}/settings/hub/people`} />

      <div className="px-4 pt-1">
        <SearchBar
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder={t("people.searchPlaceholder")}
          aria-label={t("people.searchPlaceholder")}
          data-testid="employees-search"
        />

        {canManage && (
          <button
            type="button"
            onClick={() => navigate(`${base}/employees/new`)}
            data-testid="employees-add"
            className="mt-3 h-12 w-full rounded-full flex items-center justify-center gap-2 text-14 font-medium ds-pressable"
            style={{ background: "var(--surface-2)", color: "var(--brand)" }}
          >
            <Plus size={16} />
            {t("people.addEmployee")}
          </button>
        )}

        <div
          className="flex items-center gap-2 mt-5 overflow-x-auto"
          role="group"
          aria-label={t("people.filterAll")}
        >
          {filters.map((option) => {
            const selected = filter === option.key;
            return (
              <button
                key={option.key}
                type="button"
                aria-pressed={selected}
                onClick={() => setFilter(option.key)}
                data-testid={`employees-filter-${option.key}`}
                className="h-10 px-4 rounded-full text-12 font-semibold shrink-0 transition-colors ds-pressable"
                style={
                  selected
                    ? { background: "var(--brand)", color: "#0a0a0a" }
                    : { background: "var(--surface-2)", color: "var(--text-secondary)" }
                }
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="px-4 pt-5 pb-10">
        {ready && visible.length > 0 && (
          <p
            className="text-10 font-semibold uppercase tracking-[0.18em] mb-3"
            style={{ color: "var(--text-secondary)" }}
          >
            {t("hub.people.employees")}
          </p>
        )}

        {!ready && <SkeletonList rows={5} tile />}

        {ready && visible.length === 0 && (
          <EmptyState
            icon={Users}
            title={query || filter !== "all" ? t("people.noMatch") : t("empList.empty")}
          />
        )}

        {ready && visible.length > 0 && (
          <div className="flex flex-col gap-3">
            {visible.map((employee) => {
              const status = statusOf(employee);
              const meta = statusMeta(status);
              const isActive = status === "active";
              return (
                <button
                  key={employee.id}
                  type="button"
                  onClick={() => navigate(`${base}/employees/${employee.id}`)}
                  data-testid={`people-employee-${employee.id}`}
                  className="w-full text-start rounded-[var(--radius-card)] p-4 ds-pressable"
                  style={{
                    background: "var(--tone-card)",
                    border: "1px solid var(--divider)",
                    color: "var(--text-primary)",
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="size-11 rounded-full flex items-center justify-center font-bold text-15 shrink-0"
                      style={{
                        background: isActive ? "var(--brand)" : "var(--surface-2)",
                        color: isActive ? "#0a0a0a" : "var(--text-secondary)",
                      }}
                      aria-hidden
                    >
                      {employee.name ? employee.name.charAt(0) : "?"}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-3">
                        <p className="text-15 font-bold truncate min-w-0">{employee.name}</p>
                        <span
                          className="shrink-0 text-9 font-bold px-2 py-0.5 rounded-full"
                          style={{ background: meta.bg, color: meta.color }}
                        >
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-11 mt-1 leading-snug" style={{ color: "var(--text-secondary)" }}>
                        {roleLine(employee)} · {branchLine(employee)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 flex justify-end">
                    <span
                      className="inline-flex items-center gap-1 text-11 font-semibold"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      {t("people.viewEmployee")}
                      <ForwardChevron size={13} />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
