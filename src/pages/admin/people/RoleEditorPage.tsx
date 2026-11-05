import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { ChevronRight, Pencil, ShieldAlert, ShieldCheck } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import InlineSelect from "@/components/ui/InlineSelect";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { SkeletonList } from "@/components/ui/Skeleton";
import PermissionChecklist from "@/components/admin/PermissionChecklist";
import { DashboardEligibility } from "@/components/admin/DashboardEligibility";
import { useRolesStore } from "@/stores/rolesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useAccessCatalogStore } from "@/stores/accessCatalogStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { usePermissionLabels } from "@/lib/permissionLabels";
import type { RoleCategory, RoleLevel } from "@/types";
import {
  STARTING_ROLES,
  categoryModules,
  isOwnerRoleName,
} from "@/lib/roleTemplates";
import { isSensitivePermission } from "@/lib/dashboardAccess";
import { navigateBack } from "@/lib/navContext";

interface SetupFlowState {
  returnPath: string;
  returnState?: Record<string, unknown>;
}

type Step = "basics" | "permissions" | "review";
type StartSource = "staff" | "manager" | "finance_manager" | "scratch";
const STEPS: Step[] = ["basics", "permissions", "review"];

function StarterOption({
  title,
  description,
  active,
  onClick,
  testId,
}: {
  title: string;
  description: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className="w-full flex items-start gap-3 py-2.5 text-start"
    >
      <span
        className="size-4 rounded-full border grid place-items-center shrink-0 mt-1"
        style={{ borderColor: active ? "var(--text-primary)" : "var(--text-tertiary)" }}
      >
        {active && <span className="size-2 rounded-full" style={{ background: "var(--text-primary)" }} />}
      </span>
      <span className="min-w-0 flex-1">
        <strong className="text-14 block">{title}</strong>
        <span className="text-10 leading-snug mt-0.5 block" style={{ color: "var(--text-secondary)" }}>
          {description}
        </span>
      </span>
    </button>
  );
}

export default function RoleEditorPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const location = useLocation();
  const { roleId: param } = useParams<{ roleId: string }>();
  const { addToast } = useUIStore();
  const language = useThemeStore((s) => s.language);
  const { areaLabel, actionLabel } = usePermissionLabels();

  const flow = (location.state as { setupFlow?: SetupFlowState } | null)?.setupFlow;
  const isNew = !param || param === "new";

  const roles = useRolesStore((s) => s.roles);
  const rolesReady = useRolesStore((s) => s.ready);
  const loadRoles = useRolesStore((s) => s.load);
  const createRole = useRolesStore((s) => s.createRole);
  const updateRole = useRolesStore((s) => s.updateRole);
  const getRoleMemberCount = useRolesStore((s) => s.getRoleMemberCount);
  const loadRoleAccess = useRolesStore((s) => s.loadRoleAccess);
  const permissions = usePermissionsStore((s) => s.permissions);
  const loadPermissions = usePermissionsStore((s) => s.load);
  const departments = useAccessCatalogStore((s) => s.departments);
  const widgets = useAccessCatalogStore((s) => s.widgets);
  const loadCatalog = useAccessCatalogStore((s) => s.load);

  const role = isNew ? null : roles.find((candidate) => candidate.id === param) ?? null;

  const [step, setStep] = useState<Step>("basics");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [pendingDepartmentCode, setPendingDepartmentCode] = useState<string | null>(null);
  const [category, setCategory] = useState<RoleCategory>("sales");
  const [level, setLevel] = useState<RoleLevel>("individual_contributor");
  const [startSource, setStartSource] = useState<StartSource>("scratch");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accessState, setAccessState] = useState<"idle" | "loading" | "ready" | "error">(isNew ? "ready" : "loading");
  const [memberCount, setMemberCount] = useState(0);
  const [hydrated, setHydrated] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [confirmSave, setConfirmSave] = useState(false);

  useEffect(() => {
    void loadRoles();
    void loadPermissions();
    void loadCatalog();
  }, [loadRoles, loadPermissions, loadCatalog]);

  // A starter's department is a business code, resolved after the catalogue arrives.
  useEffect(() => {
    if (!pendingDepartmentCode || departmentId || departments.length === 0) return;
    const found = departments.find((department) => department.code === pendingDepartmentCode);
    if (found) {
      setDepartmentId(found.id);
      setPendingDepartmentCode(null);
    }
  }, [pendingDepartmentCode, departmentId, departments]);

  // Existing role: one complete read, never a half-filled form.
  useEffect(() => {
    if (isNew || !role || hydrated === role.id) return;
    if (isOwnerRoleName(role.name)) {
      setError(t("roles.ownerProtectedHint"));
      return;
    }
    setHydrated(role.id);
    setName(role.name);
    setDescription(role.description ?? "");
    setDepartmentId(role.departmentId ?? "");
    setCategory(role.roleCategory ?? "other");
    setLevel(role.responsibilityLevel ?? "individual_contributor");
    setAccessState("loading");
    void getRoleMemberCount(role.id).then(setMemberCount);
    void loadRoleAccess(role.id).then((access) => {
      if (access.error) {
        setAccessState("error");
        setError(t("access.roleUnavailable"));
        return;
      }
      setSelected(new Set(access.permissions));
      if (access.departmentId) setDepartmentId(access.departmentId);
      if (access.roleCategory) setCategory(access.roleCategory);
      if (access.responsibilityLevel) setLevel(access.responsibilityLevel);
      setAccessState("ready");
    });
  }, [isNew, role, hydrated, getRoleMemberCount, loadRoleAccess, t]);

  const departmentOptions = useMemo(() => {
    const unique = new Map<string, { value: string; label: string }>();
    for (const department of departments) {
      if (unique.has(department.code)) continue;
      unique.set(department.code, {
        value: department.id,
        label: language === "ur" ? department.nameUr : department.nameEn,
      });
    }
    return [...unique.values()];
  }, [departments, language]);

  const departmentName = departments.find((department) => department.id === departmentId);
  const selectedDepartmentName = departmentName
    ? language === "ur" ? departmentName.nameUr : departmentName.nameEn
    : t("roles.noDepartment");

  const roleNameExists = (candidate: string) =>
    roles.some((existing) => existing.id !== role?.id && existing.name.trim().toLowerCase() === candidate.trim().toLowerCase());

  const uniqueName = (candidate: string) => {
    if (!roleNameExists(candidate)) return candidate;
    let index = 2;
    while (roleNameExists(`${candidate} ${index}`)) index += 1;
    return `${candidate} ${index}`;
  };

  function chooseStarter(id: StartSource) {
    setError("");
    setStartSource(id);
    if (id === "scratch") {
      setSelected(new Set());
      setCategory("sales");
      setLevel("individual_contributor");
      return;
    }
    const starter = STARTING_ROLES.find((entry) => entry.id === id);
    if (!starter) return;
    const starterName = t(starter.nameKey);
    if (!name.trim() || STARTING_ROLES.some((entry) => t(entry.nameKey) === name.trim())) {
      setName(uniqueName(starterName));
    }
    setSelected(new Set(starter.permissions));
    setCategory(starter.category);
    setLevel(starter.level);
    setPendingDepartmentCode(starter.departmentCode);
    const found = departments.find((department) => department.code === starter.departmentCode);
    if (found) setDepartmentId(found.id);
  }

  const selectedByModule = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const code of selected) {
      const permission = permissions.find((row) => row.code === code);
      if (!permission) continue;
      map.set(permission.module, [...(map.get(permission.module) ?? []), permission.action]);
    }
    return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [permissions, selected]);

  const sensitive = useMemo(
    () =>
      [...selected]
        .filter(isSensitivePermission)
        .map((code) => permissions.find((permission) => permission.code === code))
        .filter((permission): permission is NonNullable<typeof permission> => Boolean(permission)),
    [permissions, selected],
  );

  const priorityModules = categoryModules(category);
  const stepIndex = STEPS.indexOf(step);
  const startTemplate = STARTING_ROLES.find((entry) => entry.id === startSource);
  const startLabel = startSource === "scratch"
    ? t("roles.startScratch")
    : startTemplate
      ? t(startTemplate.nameKey)
      : t("roles.startScratch");

  function validateBasics(): boolean {
    setError("");
    if (!name.trim()) {
      setError(t("roles.errName"));
      return false;
    }
    if (!departmentId) {
      setError(t("roles.errDepartment"));
      return false;
    }
    if (accessState === "loading") {
      setError(t("access.loadingRole"));
      return false;
    }
    if (accessState === "error") {
      setError(t("access.roleUnavailable"));
      return false;
    }
    return true;
  }

  function goNext() {
    if (!validateBasics()) return;
    setStep("permissions");
  }

  function goPermissions() {
    if (selected.size === 0) {
      setError(t("roles.errPermissions"));
      return;
    }
    setError("");
    setStep("review");
  }

  function goBack() {
    setError("");
    if (step === "review") return setStep("permissions");
    if (step === "permissions") return setStep("basics");
    navigateBack(location, navigate, `${base}/settings/roles`);
  }

  async function persist() {
    if (savingRef.current) return;
    if (!validateBasics() || selected.size === 0) return;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        permissions: [...selected],
        departmentId,
        roleCategory: category,
        responsibilityLevel: level,
        // Legacy representation; the server derives visible widgets from permissions.
        dashboards: widgets
          .filter((widget) =>
            (widget.requiredPermissions?.length
              ? widget.requiredPermissions
              : widget.defaultPermission ? [widget.defaultPermission] : []
            ).every((code) => selected.has(code)),
          )
          .map((widget) => widget.key),
      };
      if (isNew) {
        const created = await createRole({ ...payload, dataScope: "branches" });
        addToast(t("roles.created"), "success");
        if (flow?.returnPath) {
          navigate(flow.returnPath, {
            replace: true,
            state: { ...(flow.returnState ?? {}), createdRoleId: created.id },
          });
        } else {
          navigate(`${base}/settings/roles`, { replace: true });
        }
      } else if (role) {
        await updateRole(role.id, payload);
        addToast(t("roles.updated"), "success");
        // A role opened for modification from Add Employee returns to that draft, so
        // the new permissions are reviewed there instead of dropping the owner back on
        // the whole role list.
        if (flow?.returnPath) {
          navigate(flow.returnPath, { replace: true, state: flow.returnState });
        } else {
          navigate(`${base}/settings/roles`, { replace: true });
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("roles.errSave"));
    } finally {
      savingRef.current = false;
      setSaving(false);
      setConfirmSave(false);
    }
  }

  function save() {
    if (!validateBasics() || selected.size === 0) return;
    if (!isNew && memberCount > 0) {
      setConfirmSave(true);
      return;
    }
    void persist();
  }

  if (!isNew && (!rolesReady || !role)) {
    return (
      <div className="flex flex-col min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("roles.editTitle")} backTo={`${base}/settings/roles`} />
        <SkeletonList rows={5} />
      </div>
    );
  }

  if (!isNew && role && isOwnerRoleName(role.name)) {
    return (
      <div className="flex flex-col min-h-full" style={{ background: "var(--background)", color: "var(--text-primary)" }}>
        <StatusBar />
        <NavHeader title={t("roles.editTitle")} backTo={`${base}/settings/roles`} />
        <div className="p-5">
          <p className="text-13 font-semibold">{t("roles.protectedRole")}</p>
          <p className="text-12 mt-1" style={{ color: "var(--text-secondary)" }}>{t("roles.protectedRoleHint")}</p>
          <Button className="mt-4" variant="outline" onClick={() => navigate(`${base}/settings/roles`, { replace: true })}>
            {t("common.back")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="role-builder"
      data-step={step}
    >
      <StatusBar />
      <NavHeader
        title={isNew ? t("roles.createTitle") : t("roles.editTitle")}
        onBack={goBack}
        backTo={`${base}/settings/roles`}
        right={
          <span className="text-11 font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }} data-testid="role-step-count">
            {t("roles.stepOfShort", { step: String(stepIndex + 1), total: "3" })}
          </span>
        }
      />

      <div className="px-4 pb-1">
        <div className="flex gap-1.5" data-testid="role-step-indicator" aria-hidden>
          {STEPS.map((entry, index) => (
            <span
              key={entry}
              className="h-0.5 flex-1 rounded-full"
              style={{ background: index <= stepIndex ? "var(--brand)" : "var(--divider)" }}
            />
          ))}
        </div>
      </div>

      <div className="flex-1 px-4 pt-5 pb-6 flex flex-col gap-4">
        {step === "basics" && (
          <>
            <div>
              <h1 className="text-17 font-bold">{t("roles.stepBasics")}</h1>
              <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>{t("roles.basicsSubtitle")}</p>
            </div>

            <div>
              <p className="text-12 font-semibold mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("roles.name")}</p>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("roles.nameHint")}
                data-testid="role-name"
                autoFocus
                className="w-full h-12 rounded-[var(--radius-input)] px-4 text-13 outline-none"
                style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
              />
            </div>

            <div>
              <p className="text-12 font-semibold mb-1.5" style={{ color: "var(--text-secondary)" }}>{t("roles.department")}</p>
              <InlineSelect
                value={departmentId}
                options={departmentOptions}
                placeholder={t("roles.chooseDepartment")}
                label={t("roles.department")}
                onChange={setDepartmentId}
                testId="role-department"
              />
            </div>

            <div>
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <p className="text-12 font-semibold" style={{ color: "var(--text-secondary)" }}>{t("roles.description")}</p>
                <span className="text-9" style={{ color: "var(--text-tertiary)" }}>{t("finance.optional")}</span>
              </div>
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder={t("roles.descriptionHint")}
                rows={2}
                data-testid="role-description"
                className="w-full rounded-[var(--radius-input)] p-3 text-13 outline-none resize-none"
                style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
              />
            </div>

            {isNew && (
              <div className="pt-1">
                <p className="text-11 mb-1" style={{ color: "var(--text-secondary)" }}>{t("roles.startingHint")}</p>
                <div className="flex flex-col">
                  <StarterOption
                    title={t("roles.starter.staff")}
                    description={t("roles.starter.staffHint")}
                    active={startSource === "staff"}
                    onClick={() => chooseStarter("staff")}
                    testId="role-start-staff"
                  />
                  <StarterOption
                    title={t("roles.starter.manager")}
                    description={t("roles.starter.managerHint")}
                    active={startSource === "manager"}
                    onClick={() => chooseStarter("manager")}
                    testId="role-start-manager"
                  />
                  <StarterOption
                    title={t("roles.template.financeManager")}
                    description={t("roles.template.financeManagerHint")}
                    active={startSource === "finance_manager"}
                    onClick={() => chooseStarter("finance_manager")}
                    testId="role-start-finance-manager"
                  />
                  <StarterOption
                    title={t("roles.startScratch")}
                    description={t("roles.startScratchHint")}
                    active={startSource === "scratch"}
                    onClick={() => chooseStarter("scratch")}
                    testId="role-start-scratch"
                  />
                </div>
              </div>
            )}

            {error && <p className="text-11" style={{ color: "var(--error)" }} data-testid="role-error">{error}</p>}
          </>
        )}

        {step === "permissions" && (
          <>
            <div>
              <h1 className="text-17 font-bold">{t("roles.stepPermissions")}</h1>
              <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>{t("roles.permissionsSubtitle")}</p>
            </div>

            <div
              className="rounded-[var(--radius-card)] p-3 flex items-center gap-3"
              style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
            >
              <span className="size-9 rounded-[var(--radius-tile)] grid place-items-center shrink-0" style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
                <ShieldCheck size={17} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-13 font-bold">{t("roles.permissionsEnabled", { count: String(selected.size) })}</p>
                <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                  {t("roles.modulesCount", { count: String(selectedByModule.length) })}
                </p>
              </div>
            </div>

            <div className="rounded-[var(--radius-card)] overflow-hidden" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
              <PermissionChecklist
                value={selected}
                onChange={setSelected}
                priorityModules={priorityModules}
                highlightModules={priorityModules.slice(0, 1)}
                accordion
                maxHeight="calc(100vh - 330px)"
                testIdPrefix="role-perm"
              />
            </div>

            {error && <p className="text-11" style={{ color: "var(--error)" }} data-testid="role-error">{error}</p>}
          </>
        )}

        {step === "review" && (
          <>
            <div>
              <h1 className="text-17 font-bold">{t("roles.stepReview")}</h1>
              <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>{t("roles.reviewSubtitle")}</p>
            </div>

            <div
              className="rounded-[var(--radius-card)] overflow-hidden"
              style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
              data-testid="role-review-summary"
            >
              <div className="p-4 flex items-start gap-3">
                <span
                  className="size-10 rounded-[var(--radius-tile)] grid place-items-center shrink-0 text-15 font-bold"
                  style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}
                >
                  {(name.trim().charAt(0) || "·").toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-15 font-bold break-words">{name}</p>
                  <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>{selectedDepartmentName}</p>
                  {description && (
                    <p className="text-10 mt-1.5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                      {description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setStep("basics")}
                  aria-label={t("roles.editStep")}
                  className="size-9 rounded-full grid place-items-center shrink-0 active:opacity-70"
                  style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-secondary)" }}
                >
                  <Pencil size={14} />
                </button>
              </div>
              <div className="px-4 pb-4 flex flex-wrap gap-1.5">
                <span className="text-10 font-semibold px-2.5 py-1 rounded-full" style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}>
                  {t("roles.permissionShort", { count: String(selected.size) })}
                </span>
                {isNew && startLabel.trim().toLowerCase() !== name.trim().toLowerCase() && (
                  <span className="text-10 font-semibold px-2.5 py-1 rounded-full" style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}>
                    {startLabel}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-13 font-bold">{t("roles.enabledPermissions", { count: String(selected.size) })}</p>
                <button
                  type="button"
                  onClick={() => setStep("permissions")}
                  aria-label={t("roles.editStep")}
                  className="h-8 inline-flex items-center gap-1 rounded-full px-2.5 text-10 font-semibold active:opacity-70"
                  style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}
                >
                  {t("roles.editStep")} <Pencil size={11} />
                </button>
              </div>
              <div className="mt-2">
                {selectedByModule.map(([module, actions], index) => (
                  <div
                    key={module}
                    className="grid grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)] items-start gap-4 py-2.5"
                    style={{ borderTop: index === 0 ? undefined : "1px solid var(--divider)" }}
                  >
                    <p className="text-12 font-semibold min-w-0 break-words">{areaLabel(module)}</p>
                    <p className="text-11 min-w-0 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                      {actions.map(actionLabel).join(", ")}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[var(--radius-card)] p-4 flex items-start gap-3" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
              <span className="size-8 rounded-[var(--radius-tile)] grid place-items-center shrink-0" style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}>
                <ShieldAlert size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-13 font-bold">{t("roles.reviewSensitive")}</p>
                  <span className="text-9 font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}>
                    {t("roles.restricted")}
                  </span>
                </div>
                <p className="text-11 mt-1.5 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                  {sensitive.length === 0 ? t("roles.sensitiveNone") : sensitive.map((permission) => `${areaLabel(permission.module)} · ${actionLabel(permission.action)}`).join(", ")}
                </p>
              </div>
            </div>

            <DashboardEligibility permissions={selected} compact testId="role-eligible-widgets" />

            {error && <p className="text-11" style={{ color: "var(--error)" }} data-testid="role-error">{error}</p>}
          </>
        )}
      </div>

      <div className="p-4 pb-6 flex items-center justify-between gap-3" style={{ borderTop: "1px solid var(--divider)" }}>
        {step === "permissions" ? (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="h-12 px-2 text-12 font-semibold"
            style={{ color: "var(--text-secondary)" }}
            data-testid="role-clear-permissions"
          >
            {t("roles.clearAll")}
          </button>
        ) : (
          <button
            type="button"
            onClick={goBack}
            className="h-12 px-2 text-12 font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {t("common.back")}
          </button>
        )}

        {step === "basics" && (
          <Button variant="cta" size="lg" className="min-w-[150px]" onClick={goNext} testId="role-next">
            {t("roles.continue")} <ChevronRight size={16} className="ms-1" />
          </Button>
        )}
        {step === "permissions" && (
          <Button variant="cta" size="lg" className="min-w-[150px]" onClick={goPermissions} disabled={selected.size === 0} testId="role-next-permissions">
            {t("roles.continue")} <ChevronRight size={16} className="ms-1" />
          </Button>
        )}
        {step === "review" && (
          <Button variant="cta" size="lg" className="min-w-[150px]" onClick={save} loading={saving} disabled={accessState !== "ready"} testId="role-save">
            {t(isNew ? "roles.saveRole" : "roles.saveChanges")}
          </Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmSave}
        title={t("roles.confirmChangeTitle")}
        message={t("roles.confirmChangeMessage", { count: String(memberCount) })}
        confirmLabel={t("roles.saveChanges")}
        loading={saving}
        onConfirm={() => void persist()}
        onCancel={() => setConfirmSave(false)}
      />
    </div>
  );
}
