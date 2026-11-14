import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ShieldCheck, UserPlus, Users } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { hasPermission, isCurrentUserOwner } from "@/lib/tenantContext";
import { coOwnerEnabled } from "@/lib/experience";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useCoOwnersStore } from "@/stores/coOwnersStore";
import { useAuthStore } from "@/stores/authStore";

/**
 * People — the two bodies you manage here: Co-Owner, and Employee.
 *
 * The owner is not a row. The owner is the account reading the screen, and the business is what
 * they already own; a list that starts by naming them is a list with one item nobody came here to
 * look for. This page answers "who runs a branch for me" and "who works in my business".
 *
 * Roles and access are not a body either: a role is a reusable bundle of permissions we assign to
 * an employee for convenience, so it lives inside the employee hierarchy (Settings › Roles, and
 * the employee's own page) rather than sitting beside people as if it were one of them.
 */

export default function AdminPeopleHubPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();

  const employees = useEmployeesStore((s) => s.employees);
  const ready = useEmployeesStore((s) => s.ready);
  const load = useEmployeesStore((s) => s.load);
  const grants = useCoOwnersStore((s) => s.grants);
  const loadCoOwners = useCoOwnersStore((s) => s.load);
  const currentUserId = useAuthStore((s) => s.user?.id);

  // Only employees are counted as employees. The store already drops the original owner and every
  // co-owner, so this is the one population the number and the directory both use.
  const team = employees.filter((employee) => employee.id !== currentUserId && !employee.isOriginalOwner);

  const isOwner = isCurrentUserOwner();
  const canManage = hasPermission("employees.manage");
  const canManageCoOwners = isOwner && coOwnerEnabled();
  const coOwnerCount = grants.filter((grant) => grant.status !== "revoked").length;

  useEffect(() => {
    if (!ready) void load();
  }, [ready, load]);

  useEffect(() => {
    if (canManageCoOwners) void loadCoOwners();
  }, [canManageCoOwners, loadCoOwners]);

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

      {canManage && (
        <div className="px-4 pt-3">
          <button
            type="button"
            onClick={() => navigate(`${base}/employees/new`)}
            data-testid="people-add-employee"
            className="w-full h-12 rounded-full flex items-center justify-center gap-2 text-14 font-medium active:scale-[0.99] transition-transform"
            style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
          >
            <UserPlus size={16} />
            {t("hub.people.invite")}
          </button>
        </div>
      )}

      <div className="px-4 pt-5 pb-10">
        <ListCard>
          {/* Co-owner: the body that runs a branch, and the only place it is appointed from. */}
          {canManageCoOwners && (
            <ListRow
              icon={ShieldCheck}
              title={t("coOwners.title")}
              meta={t("people.coOwnersLine")}
              value={coOwnerCount > 0 ? String(coOwnerCount) : undefined}
              trailing={chevron}
              onClick={() => navigate(`${base}/settings/hub/people/co-owners`)}
              testId="people-manage-co-owners"
            />
          )}

          {/* Employee: everyone who works in a branch. */}
          <ListRow
            icon={Users}
            title={t("hub.people.employees")}
            meta={t("people.employeesLine")}
            value={ready ? String(team.length) : undefined}
            trailing={chevron}
            onClick={() => navigate(`${base}/settings/hub/people/employees`)}
            testId="people-open-employees"
          />
        </ListCard>
      </div>
    </div>
  );
}
