import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, Plus, Users } from "lucide-react";
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
import type { User } from "@/types";

/**
 * The roster — who works here, what they do, and where.
 *
 * This is the screen the People hub's first door opens. It carries the one thing a directory
 * needs and nothing else: a search, a status filter and one line per person. The counts, the
 * invite action and the way back to roles/activity stay on the hub, so this screen is only about
 * the people themselves.
 *
 * THE PEOPLE ARE THE BUSINESS'S, NOT ONE BRANCH'S. The branch each person belongs to is on the
 * employee's own page. The signed-in account itself is not listed: this is a directory of the
 * other people in the business, not a way to open your own profile.
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

export default function AdminEmployeesDirectoryPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const employees = useEmployeesStore((s) => s.employees);
  const ready = useEmployeesStore((s) => s.ready);
  const load = useEmployeesStore((s) => s.load);
  const currentUserId = useAuthStore((s) => s.user?.id);

  const canManage = hasPermission("employees.manage");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return employees.filter((employee) => {
      // This is a directory of other people. The signed-in owner, admin or Co-Admin does not
      // get their own profile row; everyone else, including other Co-Admins, stays visible.
      if (employee.id === currentUserId) return false;
      if (filter !== "all" && statusOf(employee) !== filter) return false;
      if (!needle) return true;
      return (
        employee.name.toLowerCase().includes(needle) ||
        employee.phone.toLowerCase().includes(needle)
      );
    });
  }, [employees, query, filter, currentUserId]);

  /** What they do: the role name the store reads with the team, or the free-text job title. */
  function roleLine(employee: User): string {
    if (employee.isOriginalOwner) return t("settings.owner");
    return employee.roleName || employee.jobTitle || t("empDetail.noRole");
  }

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
      <NavHeader
        title={t("hub.people.employees")}
        backTo={`${base}/settings/hub/people`}
        right={
          canManage ? (
            <button
              type="button"
              onClick={() => navigate(`${base}/employees/new`)}
              aria-label={t("people.addEmployee")}
              data-testid="employees-add"
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
          data-testid="employees-search"
        />

        <div
          className="flex items-center gap-2 mt-3 overflow-x-auto"
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

      <div className="px-4 pt-4 pb-10 flex flex-col gap-2">
        {!ready && <SkeletonList rows={5} tile />}

        {ready && visible.length === 0 && (
          <EmptyState
            icon={Users}
            title={query || filter !== "all" ? t("people.noMatch") : t("empList.empty")}
          />
        )}

        {ready &&
          visible.map((employee) => {
            const status = statusOf(employee);
            const { bg, color } = statusColor(status);
            return (
              <button
                key={employee.id}
                type="button"
                onClick={() => navigate(`${base}/employees/${employee.id}`)}
                data-testid={`people-employee-${employee.id}`}
                className="w-full text-start rounded-[var(--radius-card)] p-3.5 flex items-center gap-3 ds-pressable"
                style={{ background: "var(--tone-card)", color: "var(--text-primary)" }}
              >
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
                  <div className="flex items-center gap-2">
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
                  <p className="text-11 mt-0.5 truncate" style={{ color: "var(--text-secondary)" }}>
                    {roleLine(employee)}
                  </p>
                </div>

                <ChevronRight
                  size={14}
                  className="shrink-0"
                  style={{ color: "var(--text-secondary)" }}
                />
              </button>
            );
          })}
      </div>
    </div>
  );
}
