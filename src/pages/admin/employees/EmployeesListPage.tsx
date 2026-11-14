import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useShopStore } from "@/stores/shopStore";
import { supabase } from "@/lib/supabase";
import { hasPermission } from "@/lib/tenantContext";
import type { User } from "@/types";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { Plus, ChevronRight, Users } from "lucide-react";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { SkeletonList } from "@/components/ui/Skeleton";
import { useShellBase } from "@/lib/useShellBase";

/**
 * The chip's tone, in the theme's own tokens.
 *
 * These were literals from a light comp — a pale red `#fee2e2` with `#dc2626` on it, and an
 * amber mixed by hand. In the dark theme both stayed pale on a near-black row, and the chip
 * disagreed with the same chip on the employee's own page. `--error-bg` / `--warning-bg` are
 * alpha-based and deepen with the theme, so one definition reads correctly on both.
 */
function statusColor(emp: User) {
  if (!emp.isActive) return { bg: "var(--error-bg)", color: "var(--error)" };
  // An invite is not yet a working employee, so it must not read as "Active".
  if (emp.membershipStatus === "pending") return { bg: "var(--warning-bg)", color: "var(--warning)" };
  // `var(--brand)22` does not work — a var() cannot have characters appended to it, so the
  // declaration was dropped and the Active chip rendered as bare green text on no fill at all.
  // `--brand-light` is the brand tint this theme already defines (pale lime in light, brand at
  // 18% in dark), and is what Badge and the alerts screens use.
  return { bg: "var(--brand-light)", color: "var(--brand-dark)" };
}

// What the owner needs to know about this person right now.
function statusLabel(emp: User, t: (key: string) => string) {
  if (!emp.isActive) return t("employees.deactivated");
  if (emp.membershipStatus === "pending") return t("employees.invited");
  return t("employees.active");
}

export default function EmployeesListPage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const teamBase = base === "/admin" ? `${base}/employees` : `${base}/team`;
  const { language } = useThemeStore();
  const t = useT();
  const isUrdu = language === "ur";
  const employees = useEmployeesStore((s) => s.employees);
  const ready = useEmployeesStore((s) => s.ready);
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const activeBranchName = useShopStore((s) => s.activeBranchName);
  const canManage = hasPermission("employees.manage");

  /**
   * The roster that belongs to the branch being worked in.
   *
   * The store is business-wide because pickers (an owner handing a new branch to
   * someone) legitimately need the whole team. This screen is not a picker: it is the
   * team of the branch named above the list. `get_branch_employee_ids()` counts the
   * same population as the branch card (0243), so "5 employees" on the card and the
   * rows here are the same five people.
   *
   * A failed read yields an empty set, not everyone: an authorization read that could
   * not answer must not widen the list it was meant to narrow.
   */
  const [branchEmployeeIds, setBranchEmployeeIds] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!activeBranchId) {
      setBranchEmployeeIds(new Set());
      return;
    }
    let cancelled = false;
    setBranchEmployeeIds(null);
    void supabase
      .rpc("get_branch_employee_ids")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          setBranchEmployeeIds(new Set());
          return;
        }
        const rows = (data as unknown[] | null) ?? [];
        const ids = rows
          .map((row) =>
            typeof row === "string"
              ? row
              : (row as { get_branch_employee_ids?: string })?.get_branch_employee_ids
          )
          .filter((id): id is string => Boolean(id));
        setBranchEmployeeIds(new Set(ids));
      });
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  const visibleEmployees = branchEmployeeIds
    ? employees.filter((employee) => branchEmployeeIds.has(employee.id))
    : [];

  /**
   * The invitations this branch is waiting on.
   *
   * The roster above is `get_branch_employee_ids()`, which answers for the branch's
   * ACTIVE team — the same population the branch card counts (0244). An invitation is
   * a membership with status `pending`, so it is correctly absent from that count and
   * was therefore absent from every screen as well: the owner sent an invitation, read
   * "Invitation sent", came back, and found nobody. The person is already placed in a
   * branch when the invitation is written (`create_employee_core` refuses an empty
   * placement), so the placement is what puts them under the branch they were invited
   * to. They move into the roster above by themselves on first sign-in, when the
   * membership becomes active.
   */
  const invitedHere = activeBranchId
    ? employees.filter(
        (employee) =>
          employee.membershipStatus === "pending" &&
          (employee.branchScope ?? []).includes(activeBranchId)
      )
    : [];

  const loading = !ready || branchEmployeeIds === null;

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("admin.employees")} />
      {activeBranchName && (
        <p className="text-10 text-center pb-2" style={{ color: "var(--text-secondary)" }}>
          {activeBranchName}
        </p>
      )}

      <div className="flex flex-col px-4 gap-3 pb-24">
        {/* Invitations, above the team rather than inside it: the number beside the
            branch is the people who work there, and an invitation is not one yet. */}
        {!loading && invitedHere.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="ds-section-label">{t("empList.invitations")}</p>
            <ListCard>
              {invitedHere.map((emp) => (
                <ListRow
                  key={emp.id}
                  testId="invited-employee"
                  onClick={() => navigate(`${teamBase}/${emp.id}`)}
                  tile={
                    <div
                      className="size-11 rounded-full flex items-center justify-center font-bold text-16 shrink-0"
                      style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                    >
                      {emp.name ? emp.name.charAt(0) : "?"}
                    </div>
                  }
                  trailing={<ChevronRight size={16} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
                >
                  <div className="flex flex-col flex-1 min-w-0 gap-0.5">
                    <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{emp.name}</p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{emp.phone}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="text-10 font-bold px-2 py-0.5 rounded-full"
                        style={{ background: "var(--warning-bg)", color: "var(--warning)" }}
                      >
                        {t("employees.invited")}
                      </span>
                    </div>
                  </div>
                </ListRow>
              ))}
            </ListCard>
          </div>
        )}

        {/* The list is fetched once per shell mount, so on a cold load this screen
            used to sit blank and then fill. It now holds the shape it will become. */}
        {loading && <SkeletonList rows={4} tile />}
        {!loading && visibleEmployees.length === 0 && invitedHere.length === 0 && (
          <div className="flex flex-col items-center py-20 gap-2">
            <Users size={28} className="mx-auto block" style={{ color: "var(--text-tertiary)" }} />
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>{t("empList.empty")}</p>
          </div>
        )}
        {!loading && visibleEmployees.length > 0 && (
        <ListCard>
        {visibleEmployees.map((emp) => {
          const { bg, color } = statusColor(emp);
          return (
            <ListRow
              key={emp.id}
              onClick={() => navigate(`${teamBase}/${emp.id}`)}
              tile={
              <div
                className="size-11 rounded-full flex items-center justify-center font-bold text-16 shrink-0"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                {emp.name ? emp.name.charAt(0) : "?"}
              </div>
              }
              trailing={<ChevronRight size={16} style={{ color: "var(--text-secondary)" }} className="shrink-0" />}
            >
              <div className="flex flex-col flex-1 min-w-0 gap-0.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{emp.name}</p>
                  {emp.isOriginalOwner && (
                    <span
                      className="shrink-0 text-10 font-bold px-2 py-0.5 rounded-full"
                      style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                    >
                      {t("settings.owner")}
                    </span>
                  )}
                </div>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{emp.phone}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="text-10 font-bold px-2 py-0.5 rounded-full"
                    style={{ background: bg, color }}
                  >
                    {statusLabel(emp, t)}
                  </span>
                </div>
              </div>

            </ListRow>
          );
        })}
        </ListCard>
        )}
      </div>

      {/* Floating Add Employee */}
      <div
        className="fixed start-0 end-0 max-w-[480px] mx-auto pointer-events-none z-40"
        style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}
      >
        <div className="flex px-4 justify-end">
          <button
            onClick={() => navigate(`${teamBase}/new`)}
            className="pointer-events-auto h-13 ps-4 pe-5 rounded-full flex items-center gap-2 text-sm font-bold shadow-lg active:scale-95 transition-transform"
            style={{ background: "var(--brand)", color: "#0a0a0a", height: "52px", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
          >
            <Plus size={20} strokeWidth={2.5} /> {t("empList.add")}
          </button>
        </div>
      </div>
    </div>
  );
}
