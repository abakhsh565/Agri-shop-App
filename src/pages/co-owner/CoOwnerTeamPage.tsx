import { useEffect } from "react";
import { useNavigate, useOutletContext } from "react-router-dom";
import { ChevronRight, Plus, Users } from "lucide-react";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useT } from "@/lib/i18n";
import type { CoOwnerAccess } from "@/components/layout/CoOwnerLayout";

export default function CoOwnerTeamPage() {
  const t = useT();
  const navigate = useNavigate();
  const { access } = useOutletContext<{ access: CoOwnerAccess }>();
  const employees = useEmployeesStore((s) => s.employees);
  const loading = useEmployeesStore((s) => s.loading);
  const load = useEmployeesStore((s) => s.load);

  useEffect(() => { void load(); }, [load]);

  const team = employees.filter((employee) => employee.membershipRole !== "owner" && employee.id);

  return (
    <div className="px-4 pt-3 pb-5" data-testid="co-owner-team">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-18 font-bold">{t("coOwner.team")}</h1>
          <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {access.branches.map((b) => b.name).join(" · ") || t("coOwner.noBranches")}
          </p>
        </div>
        <span className="size-9 rounded-full flex items-center justify-center" style={{ background: "var(--tone-sunken)" }}>
          <Users size={16} />
        </span>
      </div>

      <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>{t("coOwners.employeeHint")}</p>

      {access.canInviteEmployees && (
        <button
          type="button"
          onClick={() => navigate("/co-owner/team/new")}
          className="w-full h-10 rounded-full mt-3 text-11 font-bold flex items-center justify-center gap-1"
          style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
          data-testid="co-owner-team-add"
        >
          <Plus size={14} />
          {t("people.addEmployee")}
        </button>
      )}

      <div className="flex flex-col gap-2 mt-3">
        {loading ? (
          <p className="text-12 py-8 text-center" style={{ color: "var(--text-secondary)" }}>{t("common.loading")}</p>
        ) : team.length === 0 ? (
          <p className="text-12 py-8 text-center" style={{ color: "var(--text-secondary)" }}>{t("people.noMatch")}</p>
        ) : team.map((employee) => (
          <button
            key={employee.id}
            type="button"
            onClick={() => navigate(`/co-owner/team/${employee.id}`)}
            className="w-full rounded-[var(--radius-tile)] p-3.5 flex items-center gap-3 text-start"
            style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
          >
            <span className="size-9 rounded-full flex items-center justify-center text-11 font-bold shrink-0" style={{ background: "var(--tone-sunken)" }}>
              {(employee.name || employee.phone || "?").charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-12 font-bold truncate">{employee.name || employee.phone}</span>
              <span className="block text-10 truncate" style={{ color: "var(--text-secondary)" }}>
                {employee.roleName || employee.jobTitle || t("coOwner.team")}
              </span>
            </span>
            <ChevronRight size={14} style={{ color: "var(--text-tertiary)" }} />
          </button>
        ))}
      </div>
    </div>
  );
}
