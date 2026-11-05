import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronRight, ShieldCheck, SlidersHorizontal } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import SelectSheet from "@/components/ui/SelectSheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import EmployeeAccessEditor from "@/components/admin/EmployeeAccessEditor";
import { useT } from "@/lib/i18n";
import { useThemeStore } from "@/stores/themeStore";
import { useEmployeesStore } from "@/stores/employeesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useRolesStore } from "@/stores/rolesStore";
import { useAuthStore } from "@/stores/authStore";
import { useUIStore } from "@/stores/uiStore";
import { hasPermission } from "@/lib/tenantContext";
import { useShellBase } from "@/lib/useShellBase";
import { branchKind } from "@/lib/branchKind";
import { applyOverrides, diffOverrides, overrideCount, overridesToStore } from "@/lib/accessModel";
import { supabase } from "@/lib/supabase";
import type { MembershipRole } from "@/types";

/**
 * One employee's role and access.
 *
 * The card at the top is the answer the profile row opens on. "Customize" reveals the
 * employee-specific exceptions, branch scope and per-branch roles that were previously folded
 * into the profile itself, so the profile can stay a profile without losing a single write path.
 */
export default function EmployeeRolePage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const base = useShellBase();
  const [searchParams] = useSearchParams();
  const { language } = useThemeStore();
  const t = useT();
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const employees = useEmployeesStore((s) => s.employees);
  const employeesReady = useEmployeesStore((s) => s.ready);
  const getEmployeeAccess = useEmployeesStore((s) => s.getEmployeeAccess);
  const updateAccess = useEmployeesStore((s) => s.updateAccess);
  const setBranchRoles = useEmployeesStore((s) => s.setBranchRoles);
  const permissionsStore = usePermissionsStore();
  const rolesStore = useRolesStore();
  const [showEditor, setShowEditor] = useState(searchParams.get("customize") === "1");
  const [accessState, setAccessState] = useState<"loading" | "ready" | "error">("loading");
  const [roleId, setRoleId] = useState<string | null>(null);
  const [membershipRole, setMembershipRole] = useState<MembershipRole>("employee");
  const [branchScope, setBranchScope] = useState<string[] | null>(null);
  const [roleDefaults, setRoleDefaults] = useState<Set<string>>(new Set());
  const [storedOverrides, setStoredOverrides] = useState<Record<string, boolean>>({});
  const [editPerms, setEditPerms] = useState<Set<string>>(new Set());
  const [editBranchRoles, setEditBranchRoles] = useState<Record<string, string>>({});
  const [branchRolesDirty, setBranchRolesDirty] = useState(false);
  const [branches, setBranches] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [roleSheetBranch, setRoleSheetBranch] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const emp = employees.find((e) => e.id === employeeId);
  const role = roleId ? rolesStore.roles.find((r) => r.id === roleId) ?? null : null;
  const isOwner = membershipRole === "owner" || emp?.isOriginalOwner === true;
  const canEditAccess = user?.membershipRole === "owner" && !!emp && !emp.isOriginalOwner && !isOwner;
  const canManageRoles = hasPermission("employees.manage");
  const rtl = language === "ur";

  const scopeBranchIds = branchScope === null ? branches.map((b) => b.id) : branchScope;
  const scopedBranches = branches.filter((b) => scopeBranchIds.includes(b.id));
  const changeCount = overrideCount(diffOverrides(editPerms, roleDefaults));
  const storedCount = overrideCount(storedOverrides);
  const hasOverridesToClear = changeCount > 0 || storedCount > 0;

  useEffect(() => {
    void permissionsStore.load();
    void rolesStore.load();
    void supabase.from("branches").select("id, name, is_default").eq("is_active", true).then(({ data }) => {
      setBranches((data as { id: string; name: string; is_default: boolean }[]) ?? []);
    });
  }, []);

  function applyAccess(access: Awaited<ReturnType<typeof getEmployeeAccess>>) {
    setRoleId(access.roleId);
    setMembershipRole(access.membershipRole);
    setBranchScope(access.branchScope);
    setRoleDefaults(new Set(access.defaults));
    setStoredOverrides(access.overrides);
    setEditPerms(new Set(applyOverrides(access.defaults, access.overrides)));
    setEditBranchRoles(Object.fromEntries(
      Object.entries(access.branchRoles)
        .filter(([, value]) => !!value.roleId)
        .map(([branchId, value]) => [branchId, value.roleId as string]),
    ));
    setBranchRolesDirty(false);
    setAccessState("ready");
  }

  useEffect(() => {
    if (!employeeId) return;
    getEmployeeAccess(employeeId)
      .then(applyAccess)
      .catch(() => setAccessState("error"));
  }, [employeeId, getEmployeeAccess]);

  useEffect(() => {
    if (!roleId) { setMemberCount(null); return; }
    let cancelled = false;
    rolesStore.getRoleMemberCount(roleId)
      .then((count) => { if (!cancelled) setMemberCount(count); })
      .catch(() => { if (!cancelled) setMemberCount(null); });
    return () => { cancelled = true; };
  }, [roleId, rolesStore.getRoleMemberCount]);

  function roleNameFor(branchId: string): string {
    const branchRoleId = editBranchRoles[branchId] ?? roleId;
    return (branchRoleId ? rolesStore.roles.find((r) => r.id === branchRoleId)?.name : null)
      ?? emp?.roleName
      ?? t("empDetail.noRole");
  }

  async function selectRole(nextRoleId: string) {
    setRoleId(nextRoleId);
    setAccessState("loading");
    const { codes, error } = await rolesStore.loadRolePermissions(nextRoleId);
    if (error) {
      setAccessState("error");
      return;
    }
    setRoleDefaults(new Set(codes));
    setEditPerms(applyOverrides(codes, storedOverrides));
    setAccessState("ready");
  }

  async function resetToRoleDefaults() {
    if (!employeeId) return;
    setSaving(true);
    try {
      await updateAccess(employeeId, { roleId, resetOverrides: true });
      applyAccess(await getEmployeeAccess(employeeId));
      addToast(t("empDetail.roleOnlyDone", { name: emp?.name ?? "" }), "success");
    } catch (error) {
      addToast(error instanceof Error ? error.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  async function saveAccessChanges() {
    if (!employeeId) return;
    // `null` means "every branch" in the read model. The write takes the current branch list
    // explicitly, so a save can never be mistaken for a revoked, empty scope.
    const branchScopeToSave = scopeBranchIds;
    if (branchScopeToSave.length === 0) {
      addToast(t("addEmployee.errNoBranch"), "error");
      return;
    }
    setSaving(true);
    try {
      const overrides = overridesToStore(editPerms, roleDefaults, storedOverrides);
      const branchRoles = branchRolesDirty
        ? Object.fromEntries(
            branchScopeToSave
              .map((id) => [id, editBranchRoles[id] ?? roleId] as const)
              .filter((entry): entry is readonly [string, string] => !!entry[1]),
          )
        : undefined;
      await updateAccess(employeeId, { roleId, overrides, branchScope: branchScopeToSave });
      if (branchRoles && Object.keys(branchRoles).length > 0) {
        await setBranchRoles(employeeId, { ...branchRoles });
      }
      setBranchRolesDirty(false);
      addToast(t("empDetail.accessUpdated"), "success");
      setShowEditor(false);
      applyAccess(await getEmployeeAccess(employeeId));
    } catch (error) {
      addToast(error instanceof Error ? error.message : t("common.error"), "error");
    } finally {
      setSaving(false);
    }
  }

  if (!emp) {
    return (
      <div style={{ background: "var(--background)", color: "var(--text-primary)" }} className="flex flex-col min-h-full">
        <StatusBar />
        <NavHeader title={t("empRole.title")} backTo={`${base}/employees`} />
        {employeesReady ? (
          <p className="text-13 text-center py-16" style={{ color: "var(--text-secondary)" }}>
            {t("empDetail.notFound")}
          </p>
        ) : (
          <SkeletonList rows={4} />
        )}
      </div>
    );
  }

  const permissionCount = role?.permissionCount ?? roleDefaults.size;

  return (
    <div
      dir={rtl ? "rtl" : "ltr"}
      className="flex flex-col w-full min-h-full pb-10"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="employee-role-page"
    >
      <StatusBar />
      <NavHeader title={t("empRole.title")} backTo={`${base}/employees/${emp.id}`} />

      <div className="px-4 pt-1">
        <div
          className="rounded-[var(--radius-card)] p-4"
          style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
        >
          <div className="flex items-start gap-3">
            <span
              className="size-11 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
            >
              <ShieldCheck size={19} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-17 font-bold">
                  {isOwner ? t("empDetail.ownerFull") : role?.name ?? emp.roleName ?? t("empDetail.noRole")}
                </p>
                {role?.isSystem && (
                  <span
                    className="text-9 font-semibold px-2 py-0.5 rounded-full"
                    style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                  >
                    {t("roles.builtIn")}
                  </span>
                )}
              </div>
              <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                {isOwner
                  ? t("empDetail.fullAccess")
                  : `${t("roles.employees", { count: memberCount ?? 0 })} · ${t("roles.canDo", { count: permissionCount })}`}
              </p>
              <p className="text-12 mt-2" style={{ color: "var(--text-secondary)", lineHeight: 1.45 }}>
                {isOwner
                  ? t("empDetail.ownerFull")
                  : role?.description || t("empDetail.noRoleDescription")}
              </p>
              {role?.departmentName && (
                <p className="text-10 mt-1.5" style={{ color: "var(--text-tertiary)" }}>
                  {t("roles.department")} · {role.departmentName}
                </p>
              )}
            </div>
            {role && canManageRoles && (
              <button
                type="button"
                onClick={() => navigate(`${base}/settings/roles/${role.id}`)}
                className="shrink-0 flex items-center gap-1 text-11 font-bold active:opacity-60"
                style={{ color: "var(--text-primary)" }}
              >
                {t("roles.modify")} <ChevronRight size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {!isOwner && canEditAccess && (
        <div className="px-4 pt-4">
          <button
            type="button"
            onClick={() => setShowEditor((open) => !open)}
            className="w-full flex items-center justify-between gap-3 rounded-[var(--radius-tile)] px-4 py-3.5 text-start active:opacity-70"
            style={{ background: "var(--tone-card)", border: "1px solid var(--border-control)" }}
          >
            <span className="flex items-center gap-2.5">
              <SlidersHorizontal size={16} style={{ color: "var(--text-secondary)" }} />
              <span>
                <span className="block text-13 font-semibold">{t("empRole.customize")}</span>
                <span className="block text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  {t("empRole.customizeHint")}
                </span>
              </span>
            </span>
            <ChevronRight
              size={14}
              className="shrink-0 transition-transform"
              style={{ color: "var(--text-secondary)", transform: showEditor ? (rtl ? "rotate(-90deg)" : "rotate(90deg)") : undefined }}
            />
          </button>
        </div>
      )}

      {showEditor && canEditAccess && (
        <div className="px-4 pt-3">
          <div className="rounded-[var(--radius-card)] overflow-hidden" style={{ background: "var(--tone-card)" }}>
            <div className="px-4 py-3.5" style={{ borderBottom: "1px solid var(--divider)" }}>
              <p className="text-12 font-bold mb-2">{t("empDetail.roleSection")}</p>
              <div className="flex flex-col gap-2">
                {rolesStore.roles.map((candidate) => {
                  const selected = roleId === candidate.id;
                  return (
                    <button
                      key={candidate.id}
                      type="button"
                      onClick={() => void selectRole(candidate.id)}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-tile)] text-start"
                      style={{
                        background: selected ? "var(--brand)" : "var(--surface)",
                        color: selected ? "#0a0a0a" : "var(--text-primary)",
                        border: `1px solid ${selected ? "var(--brand)" : "var(--divider)"}`,
                      }}
                    >
                      <ShieldCheck size={14} />
                      <span className="text-12 font-semibold">{candidate.name}</span>
                    </button>
                  );
                })}
              </div>
              <p className="text-10 mt-2" style={{ color: "var(--text-secondary)" }}>{t("empDetail.roleHint")}</p>
            </div>

            {branches.length > 0 && (
              <div className="px-4 py-3.5" style={{ borderBottom: "1px solid var(--divider)" }}>
                <p className="text-12 font-bold mb-2">{t("empDetail.whereSection")}</p>
                <div className="flex gap-2 flex-wrap">
                  <button
                    type="button"
                    onClick={() => setBranchScope(null)}
                    className="px-3 py-1.5 rounded-[var(--radius-tile)] text-11 font-semibold"
                    style={{
                      background: branchScope === null ? "var(--brand)" : "var(--surface)",
                      color: branchScope === null ? "#0a0a0a" : "var(--text-secondary)",
                      border: `1px solid ${branchScope === null ? "var(--brand)" : "var(--divider)"}`,
                    }}
                  >
                    {t("addEmployee.allBranches")}
                  </button>
                  {branches.map((branch) => {
                    const selected = branchScope?.includes(branch.id) ?? false;
                    return (
                      <button
                        key={branch.id}
                        type="button"
                        onClick={() => {
                          setBranchScope((current) => {
                            const next = current ?? [];
                            return next.includes(branch.id)
                              ? next.filter((id) => id !== branch.id)
                              : [...next, branch.id];
                          });
                        }}
                        className="px-3 py-1.5 rounded-[var(--radius-tile)] text-11 font-semibold"
                        style={{
                          background: selected ? "var(--brand)" : "var(--surface)",
                          color: selected ? "#0a0a0a" : "var(--text-secondary)",
                          border: `1px solid ${selected ? "var(--brand)" : "var(--divider)"}`,
                        }}
                      >
                        {branch.name} · {branchKind(t, branch.is_default)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {scopedBranches.length > 0 && (
              <div className="px-4 py-3.5" style={{ borderBottom: "1px solid var(--divider)" }}>
                <p className="text-12 font-bold mb-2">{t("empDetail.roleByBranch")}</p>
                <div className="flex flex-col gap-2">
                  {scopedBranches.map((branch) => (
                    <button
                      key={branch.id}
                      type="button"
                      onClick={() => setRoleSheetBranch(branch.id)}
                      className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-[var(--radius-tile)] text-start"
                      style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
                    >
                      <span className="text-11 font-semibold truncate">
                        {branch.name} · <span style={{ color: "var(--text-tertiary)" }}>{branchKind(t, branch.is_default)}</span>
                      </span>
                      <span className="text-11 font-semibold flex items-center gap-1 shrink-0" style={{ color: "var(--text-secondary)" }}>
                        {roleNameFor(branch.id)} <ChevronRight size={12} />
                      </span>
                    </button>
                  ))}
                </div>
                <p className="text-10 mt-2" style={{ color: "var(--text-secondary)" }}>{t("empDetail.roleByBranchHint")}</p>
              </div>
            )}

            <div className="px-4 py-3.5" style={{ borderBottom: "1px solid var(--divider)" }}>
              <p className="text-12 font-bold mb-2">{t("empDetail.access")}</p>
              <EmployeeAccessEditor
                roleDefaults={roleDefaults}
                value={editPerms}
                onChange={setEditPerms}
                state={accessState}
              />
            </div>

            <div className="px-4 py-3 flex gap-2">
              <button
                type="button"
                onClick={() => void resetToRoleDefaults()}
                disabled={saving || !hasOverridesToClear}
                className="flex-1 h-10 rounded-[var(--radius-tile)] font-bold text-11 disabled:opacity-50"
                style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
              >
                {t("empDetail.roleOnly")}
              </button>
              <button
                type="button"
                onClick={() => void saveAccessChanges()}
                disabled={saving}
                className="flex-1 h-10 rounded-[var(--radius-tile)] font-bold text-12 disabled:opacity-50"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                {saving ? t("common.saving") : t("common.save")}
              </button>
            </div>
          </div>
        </div>
      )}

      {!canEditAccess && !isOwner && (
        <p className="text-10 px-5 pt-4" style={{ color: "var(--text-tertiary)", lineHeight: 1.5 }}>
          {t("empRole.ownerOnly")}
        </p>
      )}

      <SelectSheet
        open={roleSheetBranch !== null}
        title={t("empDetail.rolePickerTitle")}
        options={rolesStore.roles.map((candidate) => ({ value: candidate.id, label: candidate.name }))}
        selected={roleSheetBranch ? editBranchRoles[roleSheetBranch] ?? roleId ?? undefined : undefined}
        onSelect={(value) => {
          if (!roleSheetBranch) return;
          setEditBranchRoles((current) => ({ ...current, [roleSheetBranch]: value }));
          setBranchRolesDirty(true);
        }}
        onClose={() => setRoleSheetBranch(null)}
      />
    </div>
  );
}
