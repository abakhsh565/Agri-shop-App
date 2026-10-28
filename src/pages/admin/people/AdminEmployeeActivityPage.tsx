import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, History } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SearchBar from "@/components/ui/SearchBar";
import { SkeletonList } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useShopStore } from "@/stores/shopStore";
import { supabase } from "@/lib/supabase";
import type { User } from "@/types";

/**
 * Employee activity — choose whose history to read.
 *
 * The directory is the branch's working team, not the whole business, because the audit read
 * behind the next screen (`get_branch_activity`) answers for the branch the account is working
 * in. Listing people from other branches here would offer a door that opens onto no events.
 *
 * The list itself is the branch roster read the team screens already use
 * (`get_branch_employee_ids`), so "who is on this branch" means the same thing here as on the
 * branch card.
 */
export default function AdminEmployeeActivityPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const employees = useEmployeesStore((s) => s.employees);
  const ready = useEmployeesStore((s) => s.ready);
  const load = useEmployeesStore((s) => s.load);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const activeBranchName = useShopStore((s) => s.activeBranchName);

  const [query, setQuery] = useState("");
  const [teamIds, setTeamIds] = useState<Set<string> | null>(null);

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  useEffect(() => {
    if (!activeBranchId) {
      setTeamIds(new Set());
      return;
    }
    let cancelled = false;
    setTeamIds(null);
    void supabase.rpc("get_branch_employee_ids").then(({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setTeamIds(new Set());
        return;
      }
      const ids = ((data as unknown[] | null) ?? [])
        .map((row) =>
          typeof row === "string"
            ? row
            : (row as { get_branch_employee_ids?: string })?.get_branch_employee_ids,
        )
        .filter((id): id is string => Boolean(id));
      setTeamIds(new Set(ids));
    });
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  const team = useMemo(() => {
    if (!teamIds) return [];
    const needle = query.trim().toLowerCase();
    return employees
      .filter(
        (employee) =>
          teamIds.has(employee.id) &&
          employee.isActive &&
          employee.membershipStatus !== "pending",
      )
      .filter(
        (employee) =>
          !needle ||
          employee.name.toLowerCase().includes(needle) ||
          employee.phone.toLowerCase().includes(needle),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [employees, teamIds, query]);

  function roleLine(employee: User): string {
    if (employee.isOriginalOwner) return t("settings.owner");
    return employee.roleName || employee.jobTitle || t("empDetail.noRole");
  }

  const loading = !ready || teamIds === null;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="employee-activity-picker"
    >
      <StatusBar />
      <NavHeader title={t("hub.people.activity")} backTo={`${base}/settings/hub/people`} />

      <div className="px-4 pt-1 pb-2">
        <p className="text-12" style={{ color: "var(--text-secondary)" }}>
          {t("people.activityPickerHint")}
        </p>
        {activeBranchName && (
          <p className="text-10 mt-1" style={{ color: "var(--text-tertiary)" }}>
            {activeBranchName}
          </p>
        )}
      </div>

      <div className="px-4 pb-3">
        <SearchBar
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery("")}
          placeholder={t("people.searchPlaceholder")}
          aria-label={t("people.searchPlaceholder")}
          data-testid="employee-activity-search"
        />
      </div>

      <div className="px-4 pb-10 flex flex-col gap-2">
        {loading && <SkeletonList rows={4} tile />}

        {!loading && team.length === 0 && (
          <EmptyState icon={History} title={t("people.noMatch")} />
        )}

        {!loading &&
          team.map((employee) => (
            <button
              key={employee.id}
              type="button"
              onClick={() => navigate(`${base}/settings/hub/people/activity/${employee.id}`)}
              data-testid={`employee-activity-${employee.id}`}
              className="w-full text-start rounded-[var(--radius-card)] p-3.5 flex items-center gap-3 ds-pressable"
              style={{ background: "var(--tone-card)", color: "var(--text-primary)" }}
            >
              <div
                className="size-9 rounded-full flex items-center justify-center text-12 font-bold shrink-0"
                style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                aria-hidden
              >
                {employee.name ? employee.name.charAt(0) : "?"}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-13 font-bold truncate">{employee.name}</p>
                <p className="text-11 truncate" style={{ color: "var(--text-secondary)" }}>
                  {roleLine(employee)}
                </p>
              </div>
              <ChevronRight
                size={14}
                className="shrink-0"
                style={{ color: "var(--text-secondary)" }}
              />
            </button>
          ))}
      </div>
    </div>
  );
}
