import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronRight,
  History,
  ShieldCheck,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { hasPermission } from "@/lib/tenantContext";
import { isCurrentUserOwner } from "@/lib/tenantContext";
import { coOwnerEnabled } from "@/lib/experience";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useAuthStore } from "@/stores/authStore";
import { listEmployeeAccessRequests } from "@/lib/employeeAccessRequests";

/**
 * Employees & access — the people control centre.
 *
 * WHAT CHANGED, AND WHY. This page used to BE the roster: search, filters, every person's card
 * and its management rows, all in one scroll. The owner's reference (Figma 2087:1765) puts the
 * two numbers he checks first, the one action he takes most often, and the doors to the team's
 * work — nothing else.
 * The roster itself is a screen now (`AdminEmployeesDirectoryPage`), opened by the first door, so
 * this screen answers "how is the team doing and where do I go" without repeating the team.
 *
 * The counts are the loaded team, not a second server read, so the number here and the list one
 * tap away cannot disagree. "Pending invitations" counts memberships still waiting, which is a
 * different question from the access requests below it: a request is somebody asking to join, an
 * invitation is somebody already invited. Both are shown because both need the owner's action.
 *
 * THE DOORS ARE THE SYSTEM'S OWN SCREENS. Employees opens the directory, Access request opens the
 * approvals inbox, Roles and permission opens the access catalogue, Activity opens the per-person
 * history the audit trail already serves. No switch here claims an authority the database does
 * not enforce — this page only routes, and each destination checks its own permission.
 */
export default function AdminPeopleHubPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const employees = useEmployeesStore((s) => s.employees);
  const ready = useEmployeesStore((s) => s.ready);
  const load = useEmployeesStore((s) => s.load);
  const currentUserId = useAuthStore((s) => s.user?.id);
  // The owner/admin's own account is not a team member in this directory. Keep the visible
  // total and the pending count on the same set the roster below shows.
  const team = employees.filter((employee) => employee.id !== currentUserId);

  const canManage = hasPermission("employees.manage");
  const canSeeActivity = hasPermission("activity.view");
  const canManageCoOwners = isCurrentUserOwner() && coOwnerEnabled();

  // Access requests are only read for a role that may act on them; a null count means "not
  // asked", which is why it renders as a dash rather than a confident zero.
  const [waiting, setWaiting] = useState<number | null>(null);

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  useEffect(() => {
    if (!canManage) return;
    let alive = true;
    void listEmployeeAccessRequests("pending")
      .then((rows) => {
        if (alive) setWaiting(rows.length);
      })
      .catch(() => {
        if (alive) setWaiting(null);
      });
    return () => {
      alive = false;
    };
  }, [canManage]);

  const pendingInvitations = team.filter(
    (employee) => employee.isActive && employee.membershipStatus === "pending",
  ).length;

  const chevron = (
    <ChevronRight size={14} className="shrink-0" style={{ color: "var(--text-secondary)" }} />
  );

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="people-hub-page"
    >
      <StatusBar />
      <NavHeader title={t("people.hubTitle")} backTo={`${base}/more`} />

      <div className="px-4 pt-1 grid grid-cols-2 gap-3">
        <div
          className="rounded-[var(--radius-tile)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="people-total"
        >
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>
            {t("people.totalEmployees")}
          </p>
          <p className="text-26 font-bold mt-1 tabular-nums">
            {ready ? team.length.toLocaleString("en-PK") : "—"}
          </p>
        </div>
        <div
          className="rounded-[var(--radius-tile)] p-4"
          style={{ background: "var(--tone-card)" }}
          data-testid="people-pending"
        >
          <p className="text-11" style={{ color: "var(--text-secondary)" }}>
            {t("people.pendingInvitations")}
          </p>
          <p className="text-26 font-bold mt-1 tabular-nums">
            {ready ? pendingInvitations.toLocaleString("en-PK") : "—"}
          </p>
        </div>
      </div>

      {canManage && (
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={() => navigate(`${base}/employees/new`)}
            data-testid="people-add-employee"
            className="w-full h-12 rounded-full flex items-center justify-center gap-2 font-bold text-13 active:scale-[0.99] transition-transform"
            style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
          >
            <UserPlus size={16} />
            {t("hub.people.invite")}
          </button>
        </div>
      )}

      <div className="px-4 pt-5 pb-10">
        <ListCard>
          <ListRow
            icon={Users}
            title={t("hub.people.employees")}
            meta={t("people.employeesLine")}
            trailing={chevron}
            onClick={() => navigate(`${base}/settings/hub/people/employees`)}
            testId="people-open-employees"
          />

          {canManage && (
            <ListRow
              icon={UserPlus}
              title={t("accessRequests.title")}
              meta={
                waiting === null
                  ? t("people.noneWaiting")
                  : waiting > 0
                    ? t("people.waitingCount", { count: waiting })
                    : t("people.noneWaiting")
              }
              trailing={chevron}
              onClick={() => navigate(`${base}/employees/requests`)}
              testId="people-access-requests"
            />
          )}

          {canManage && (
            <ListRow
              icon={ShieldCheck}
              title={t("hub.people.roles")}
              meta={t("people.rolesHint")}
              trailing={chevron}
              onClick={() => navigate(`${base}/settings/roles`)}
              testId="people-manage-roles"
            />
          )}

          {canSeeActivity && (
            <ListRow
              icon={History}
              title={t("hub.people.activity")}
              meta={t("people.employeeActivityHint")}
              trailing={chevron}
              onClick={() => navigate(`${base}/settings/hub/people/activity`)}
              testId="people-manage-activity"
            />
          )}

          {canManageCoOwners && (
            <ListRow
              icon={UserCog}
              title={t("more.coOwnersAccess")}
              meta={t("coOwners.subtitle")}
              trailing={chevron}
              onClick={() => navigate(`${base}/settings/hub/people/co-owners`)}
              testId="people-manage-co-owners"
            />
          )}
        </ListCard>
      </div>
    </div>
  );
}
