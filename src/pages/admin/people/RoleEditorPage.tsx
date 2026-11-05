import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Check,
  ChevronRight,
  Plus,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { SkeletonList } from "@/components/ui/Skeleton";
import PermissionChecklist, { useSelectAll } from "@/components/admin/PermissionChecklist";
import DashboardVisibilityChecklist from "@/components/admin/DashboardVisibilityChecklist";
import { useRolesStore } from "@/stores/rolesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useAccessCatalogStore } from "@/stores/accessCatalogStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { usePermissionLabels } from "@/lib/permissionLabels";
import type { RoleCategory, RoleDataScope, RoleLevel } from "@/types";
import {
  RESPONSIBILITY_LEVELS,
  ROLE_CATEGORIES,
  ROLE_TEMPLATES,
  categoryLabelKey,
  categoryModules,
  levelLabelKey,
  recommendationFor,
  type RoleTemplate,
} from "@/lib/roleTemplates";

interface SetupFlowState {
  returnPath: string;
  mode: "create" | "edit";
  roleId?: string;
}

type Step = "start" | "category" | "basics" | "recommend" | "data" | "permissions" | "dashboards" | "review";
type RecommendationChoice = "accept" | "customize" | "none";

const STEPS: Step[] = ["start", "category", "basics", "recommend", "data", "permissions", "dashboards", "review"];
const SCOPES: RoleDataScope[] = ["business", "branches", "department", "records"];
const SCOPE_KEYS: Record<RoleDataScope, string> = {
  business: "roles.scope.business",
  branches: "roles.scope.branches",
  department: "roles.scope.department",
  records: "roles.scope.records",
};

const DEPARTMENT_BY_CATEGORY: Partial<Record<RoleCategory, string>> = {
  sales: "sales",
  finance: "finance",
  inventory: "inventory",
  procurement: "inventory",
  people_hr: "management",
  operations: "operations",
  business_management: "management",
};

function ChoiceCard({
  selected,
  title,
  description,
  onClick,
  icon: Icon = Sparkles,
}: {
  selected: boolean;
  title: string;
  description: string;
  onClick: () => void;
  icon?: LucideIcon;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className="w-full rounded-[var(--radius-card)] p-3.5 flex items-start gap-3 text-start"
      style={{
        background: selected ? "var(--roles-accent-soft)" : "var(--surface)",
        border: `1px solid ${selected ? "var(--roles-accent-border)" : "var(--border-control)"}`,
      }}
    >
      <span
        className="size-10 rounded-[var(--radius-tile)] grid place-items-center shrink-0"
        style={{
          background: selected ? "var(--roles-accent)" : "var(--surface-2)",
          color: selected ? "var(--roles-accent-fg)" : "var(--text-secondary)",
        }}
      >
        <Icon size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <strong className="text-14 font-bold">{title}</strong>
          {selected && <Check size={15} style={{ color: "var(--roles-accent-text)" }} />}
        </span>
        <span className="text-12 leading-snug mt-1 block" style={{ color: "var(--text-secondary)" }}>
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
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const { areaLabel } = usePermissionLabels();

  const navState = location.state as
    | { setupFlow?: SetupFlowState; templateId?: string; templateRoleId?: string }
    | null;
  const flow = navState?.setupFlow;
  const isNew = !param || param === "new";
  const initialTemplate = ROLE_TEMPLATES.find((template) => template.id === navState?.templateId) ?? null;

  const roles = useRolesStore((s) => s.roles);
  const rolesReady = useRolesStore((s) => s.ready);
  const loadRoles = useRolesStore((s) => s.load);
  const updateRole = useRolesStore((s) => s.updateRole);
  const createRole = useRolesStore((s) => s.createRole);
  const deleteRole = useRolesStore((s) => s.deleteRole);
  const getRoleMemberCount = useRolesStore((s) => s.getRoleMemberCount);
  const loadRoleAccess = useRolesStore((s) => s.loadRoleAccess);
  const loadPermissions = usePermissionsStore((s) => s.load);
  const permissions = usePermissionsStore((s) => s.permissions);
  const departments = useAccessCatalogStore((s) => s.departments);
  const widgets = useAccessCatalogStore((s) => s.widgets);
  const loadCatalog = useAccessCatalogStore((s) => s.load);
  const createDepartment = useAccessCatalogStore((s) => s.createDepartment);

  const role = isNew ? null : roles.find((r) => r.id === param) ?? null;

  const [step, setStep] = useState<Step>(isNew ? "start" : "category");
  const [mode, setMode] = useState<"template" | "custom">(initialTemplate ? "template" : "custom");
  const [templateId, setTemplateId] = useState<string | null>(initialTemplate?.id ?? null);
  const [name, setName] = useState(
    initialTemplate ? t("roles.templateCopy", { name: t(initialTemplate.nameKey) }) : "",
  );
  const [description, setDescription] = useState("");
  const [roleCategory, setRoleCategory] = useState<RoleCategory | null>(initialTemplate?.category ?? null);
  const [responsibilityLevel, setResponsibilityLevel] = useState<RoleLevel>(
    initialTemplate?.level ?? "individual_contributor",
  );
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [pendingDepartmentCode, setPendingDepartmentCode] = useState<string | null>(
    initialTemplate ? DEPARTMENT_BY_CATEGORY[initialTemplate.category] ?? null : null,
  );
  const [dataScope, setDataScope] = useState<RoleDataScope>("branches");
  const [selected, setSelected] = useState<Set<string>>(new Set(initialTemplate?.permissions ?? []));
  const [dashboards, setDashboards] = useState<Set<string>>(new Set(initialTemplate?.dashboards ?? []));
  const [recommendationChoice, setRecommendationChoice] = useState<RecommendationChoice>("accept");
  const [formReady, setFormReady] = useState(isNew);
  const [permsState, setPermsState] = useState<"loading" | "ready" | "error">(
    isNew ? "ready" : "loading",
  );
  const [memberCount, setMemberCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [stepError, setStepError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const [newDeptOpen, setNewDeptOpen] = useState(false);
  const [newDeptName, setNewDeptName] = useState("");
  const [addingDept, setAddingDept] = useState(false);
  const hydrated = useRef<string | null>(null);
  const selectAll = useSelectAll(selected, setSelected);

  useEffect(() => {
    void loadRoles();
    void loadPermissions();
    void loadCatalog();
  }, [loadRoles, loadPermissions, loadCatalog]);

  /**
   * A static template is preselected before the catalogue loads. Resolve its department
   * once the business's own departments are available, never from a hardcoded id.
   */
  useEffect(() => {
    if (!pendingDepartmentCode || departmentId || departments.length === 0) return;
    const department = departments.find((d) => d.code === pendingDepartmentCode);
    if (department) {
      setDepartmentId(department.id);
      setPendingDepartmentCode(null);
    }
  }, [departments, pendingDepartmentCode, departmentId]);

  /** Existing role: one access read, so the whole wizard paints one answer. */
  useEffect(() => {
    if (isNew || !role) return;
    const key = role.id;
    if (hydrated.current === key) return;
    hydrated.current = key;
    setName(role.name);
    setDescription(role.description ?? "");
    setFormReady(true);
    setPermsState("loading");
    void getRoleMemberCount(role.id).then(setMemberCount);
    void loadRoleAccess(role.id).then((access) => {
      if (access.error) {
        setPermsState("error");
        return;
      }
      setSelected(new Set(access.permissions));
      setDashboards(new Set(access.dashboards));
      setDepartmentId(access.departmentId);
      setDataScope(access.dataScope);
      setRoleCategory(access.roleCategory ?? role.roleCategory ?? null);
      setResponsibilityLevel(access.responsibilityLevel ?? role.responsibilityLevel ?? "individual_contributor");
      setPermsState("ready");
    });
  }, [isNew, role, getRoleMemberCount, loadRoleAccess]);

  /** A database system role used as a template copies its real access, never the row. */
  useEffect(() => {
    if (!isNew || !navState?.templateRoleId || !rolesReady) return;
    const source = roles.find((r) => r.id === navState.templateRoleId);
    if (!source) return;
    const key = `template:${source.id}`;
    if (hydrated.current === key) return;
    hydrated.current = key;
    setMode("template");
    setTemplateId(null);
    setName(t("roles.templateCopy", { name: source.name }));
    setDescription(source.description ?? "");
    setFormReady(true);
    setPermsState("loading");
    void loadRoleAccess(source.id).then((access) => {
      if (access.error) {
        setPermsState("error");
        return;
      }
      setSelected(new Set(access.permissions));
      setDashboards(new Set(access.dashboards));
      setDepartmentId(access.departmentId);
      setDataScope(access.dataScope);
      setRoleCategory(access.roleCategory ?? source.roleCategory ?? null);
      setResponsibilityLevel(access.responsibilityLevel ?? source.responsibilityLevel ?? "individual_contributor");
      setPermsState("ready");
    });
  }, [isNew, navState?.templateRoleId, rolesReady, roles, t, loadRoleAccess]);

  const categories = ROLE_CATEGORIES;
  const department = departments.find((d) => d.id === departmentId) ?? null;
  const departmentLabel = department ? (isUrdu ? department.nameUr : department.nameEn) : null;

  const recommendedCodes = useMemo(() => {
    const known = new Set(permissions.map((p) => p.code));
    return recommendationFor(roleCategory, responsibilityLevel).filter(
      (code) => known.size === 0 || known.has(code),
    );
  }, [roleCategory, responsibilityLevel, permissions]);

  const priorityModules = useMemo(() => categoryModules(roleCategory), [roleCategory]);
  const recommendedWidgets = useMemo(
    () =>
      widgets
        .filter((w) => w.defaultPermission && recommendedCodes.includes(w.defaultPermission))
        .map((w) => w.key),
    [widgets, recommendedCodes],
  );

  const missingDependencies = useMemo(
    () =>
      widgets
        .filter((w) => dashboards.has(w.key) && w.defaultPermission && !selected.has(w.defaultPermission))
        .map((w) => ({ key: w.key, permission: w.defaultPermission as string })),
    [widgets, dashboards, selected],
  );

  const selectedModules = useMemo(() => {
    const grouped = new Map<string, string[]>();
    for (const p of permissions) {
      if (!selected.has(p.code)) continue;
      grouped.set(p.module, [...(grouped.get(p.module) ?? []), isUrdu ? p.label_ur : p.label_en]);
    }
    return [...grouped.entries()];
  }, [permissions, selected, isUrdu]);

  const selectedWidgets = widgets.filter((w) => dashboards.has(w.key));
  const unknownWidgets = [...dashboards].filter((key) => !widgets.some((w) => w.key === key));
  const stepIndex = STEPS.indexOf(step);
  const stepTitles: Record<Step, string> = {
    start: t("roles.stepStart"),
    category: t("roles.stepCategory"),
    basics: t("roles.stepInfo"),
    recommend: t("roles.stepRecommend"),
    data: t("roles.stepData"),
    permissions: t("roles.stepPermissions"),
    dashboards: t("roles.stepDashboards"),
    review: t("roles.stepReview"),
  };

  function leave() {
    if (flow) {
      navigate(flow.returnPath, { replace: true });
      return;
    }
    navigate(`${base}/settings/roles`, { replace: true });
  }

  function goBack() {
    setStepError("");
    if (stepIndex === 0 || (!isNew && step === "category")) {
      leave();
      return;
    }
    setStep(STEPS[stepIndex - 1] ?? "start");
  }

  function applyStaticTemplate(template: RoleTemplate) {
    setMode("template");
    setTemplateId(template.id);
    setName(t("roles.templateCopy", { name: t(template.nameKey) }));
    setDescription(t(template.descriptionKey));
    setRoleCategory(template.category);
    setResponsibilityLevel(template.level);
    setSelected(new Set(template.permissions));
    setDashboards(new Set(template.dashboards));
    setDataScope("branches");
    setPendingDepartmentCode(DEPARTMENT_BY_CATEGORY[template.category] ?? null);
    setDepartmentId(null);
    setStepError("");
  }

  function startCustom() {
    setMode("custom");
    setTemplateId(null);
    setName("");
    setDescription("");
    setRoleCategory(null);
    setResponsibilityLevel("individual_contributor");
    setSelected(new Set());
    setDashboards(new Set());
    setDataScope("branches");
    setPendingDepartmentCode(null);
    setDepartmentId(null);
    setStepError("");
  }

  function goNext() {
    setStepError("");
    if (step === "start") {
      if (mode === "template" && !templateId && !navState?.templateRoleId) {
        setStepError(t("roles.selectTemplateFirst"));
        return;
      }
      setStep("category");
      return;
    }
    if (step === "category" && !roleCategory) {
      setStepError(t("roles.categoryRequired"));
      return;
    }
    if (step === "category") {
      setStep("basics");
      return;
    }
    if (step === "basics") {
      if (!name.trim()) {
        setStepError(t("roles.errName"));
        return;
      }
      if (!departmentId) {
        setStepError(t("roles.departmentRequired"));
        return;
      }
      if (permsState !== "ready") {
        setStepError(t("access.roleUnavailable"));
        return;
      }
      setStep("recommend");
      return;
    }
    if (step === "recommend") {
      if (recommendationChoice === "none") {
        setSelected(new Set());
        setDashboards(new Set());
      } else {
        setSelected((prev) => new Set([...prev, ...recommendedCodes]));
        setDashboards((prev) => new Set([...prev, ...recommendedWidgets]));
      }
      setStep("data");
      return;
    }
    if (step === "data") {
      setStep("permissions");
      return;
    }
    if (step === "permissions") {
      setStep("dashboards");
      return;
    }
    if (step === "dashboards") {
      setStep("review");
    }
  }

  async function handleAddDepartment() {
    const next = newDeptName.trim();
    if (!next || addingDept) return;
    setAddingDept(true);
    try {
      const created = await createDepartment({ nameEn: next });
      setDepartmentId(created.id);
      setNewDeptName("");
      setNewDeptOpen(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : "";
      addToast(message.includes("DEPARTMENT_EXISTS") ? t("roles.deptExists") : t("common.error"), "error");
    } finally {
      setAddingDept(false);
    }
  }

  async function handleSave() {
    setStepError("");
    if (!name.trim()) {
      setStep("basics");
      setStepError(t("roles.errName"));
      return;
    }
    if (!departmentId) {
      setStep("basics");
      setStepError(t("roles.departmentRequired"));
      return;
    }
    if (savingRef.current || permsState !== "ready") return;
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || undefined,
        permissions: Array.from(selected),
        departmentId,
        dataScope,
        roleCategory: roleCategory ?? "other",
        responsibilityLevel,
        dashboards: Array.from(dashboards),
      };
      if (role) {
        await updateRole(role.id, payload);
        addToast(t("roles.updated"), "success");
      } else {
        await createRole(payload);
        addToast(t("roles.created"), "success");
      }
      leave();
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("roles.errSave"), "error");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function deleteConsequence(onRow = false): string {
    if (!role) return "";
    if (memberCount === 1) {
      return t(onRow ? "roles.deleteRevokesShortOne" : "roles.deleteRevokesOne");
    }
    if (memberCount > 1) {
      return t(onRow ? "roles.deleteRevokesShort" : "roles.deleteRevokes", { count: memberCount });
    }
    return t(role.isSystem ? "roles.deleteHintBuiltIn" : "roles.deleteHint", { name: role.name });
  }

  async function confirmDelete() {
    if (deletingRef.current || !role) return;
    deletingRef.current = true;
    setDeleting(true);
    try {
      await deleteRole(role.id);
      addToast(t("roles.deleted"), "success");
      setDeleteOpen(false);
      leave();
    } catch (e) {
      addToast(e instanceof Error ? e.message : t("common.error"), "error");
    } finally {
      deletingRef.current = false;
      setDeleting(false);
    }
  }

  const fieldStyle = {
    background: "var(--field-bg)",
    color: "var(--text-primary)",
  } as const;
  const missing = rolesReady && !isNew && !role;
  const editTrailing = (
    <span className="flex items-center gap-0.5 text-11 font-semibold shrink-0" style={{ color: "var(--roles-accent-text)" }}>
      {t("roles.editStep")}
      <ChevronRight size={14} />
    </span>
  );
  const canContinue =
    step !== "review" &&
    !(step === "permissions" && permsState !== "ready") &&
    !(step === "basics" && (!name.trim() || !departmentId));

  if (missing) {
    return (
      <div className="roles-neutral flex flex-col w-full min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("roles.edit")} backTo={`${base}/settings/roles`} />
        <div className="px-4 pt-6" role="alert">
          <p className="text-13" style={{ color: "var(--text-secondary)" }}>{t("roles.notFound")}</p>
          <button
            type="button"
            onClick={leave}
            className="mt-3 h-10 px-4 rounded-full text-13 font-bold"
            style={{ background: "var(--roles-accent)", color: "var(--roles-accent-fg)" }}
          >
            {t("roles.backToList")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="roles-neutral flex flex-col w-full min-h-full"
      style={{
        background: "var(--background)",
        color: "var(--text-primary)",
        direction: isUrdu ? "rtl" : "ltr",
      }}
      data-testid="role-editor-page"
    >
      <StatusBar />
      <NavHeader
        title={stepTitles[step]}
        backTo={flow ? flow.returnPath : `${base}/settings/roles`}
        onBack={flow && stepIndex === 0 ? () => navigate(flow.returnPath, { replace: true }) : goBack}
      />
      <div className="h-0.5 w-full" style={{ background: "var(--divider)" }}>
        <div
          className="h-full transition-all"
          style={{ width: `${((stepIndex + 1) / STEPS.length) * 100}%`, background: "var(--roles-accent)" }}
        />
      </div>

      <div className="flex-1 px-4 pt-3 pb-4">
        <p className="text-11 font-semibold tabular-nums" style={{ color: "var(--roles-accent-text)" }} data-testid="role-step-progress">
          {t("roles.stepOf", { step: String(stepIndex + 1), total: String(STEPS.length) })}
        </p>

        {!formReady ? (
          <div className="pt-4"><SkeletonList rows={4} /></div>
        ) : (
          <>
            {step === "start" && (
              <div data-testid="role-step-start">
                <h2 className="text-20 font-bold leading-tight mt-1">{t("roles.stepStart")}</h2>
                <p className="text-13 leading-snug mt-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("roles.stepStartHint")}
                </p>
                <p
                  className="text-11 rounded-[var(--radius-tile)] p-3 mt-3 flex items-start gap-2"
                  style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
                >
                  <ShieldCheck size={15} className="shrink-0 mt-0.5" style={{ color: "var(--roles-accent-text)" }} />
                  {t("roles.templateNotice")}
                </p>

                <div className="pt-4 flex flex-col gap-2.5">
                  <ChoiceCard
                    selected={mode === "template"}
                    title={t("roles.useSystemTemplate")}
                    description={t("roles.useSystemTemplateHint")}
                    icon={ShieldCheck}
                    onClick={() => setMode("template")}
                  />
                  {mode === "template" && (
                    <div className="flex flex-col gap-2 ps-3">
                      {ROLE_TEMPLATES.map((template) => (
                        <ChoiceCard
                          key={template.id}
                          selected={templateId === template.id}
                          title={t(template.nameKey)}
                          description={`${t(template.descriptionKey)} · ${t("roles.canDo", { count: template.permissions.length })}`}
                          icon={Check}
                          onClick={() => applyStaticTemplate(template)}
                        />
                      ))}
                    </div>
                  )}
                  <ChoiceCard
                    selected={mode === "custom"}
                    title={t("roles.createCustomRole")}
                    description={t("roles.createCustomRoleHint")}
                    icon={Plus}
                    onClick={startCustom}
                  />
                </div>
              </div>
            )}

            {step === "category" && (
              <div data-testid="role-step-category">
                <h2 className="text-20 font-bold leading-tight mt-1">{t("roles.stepCategory")}</h2>
                <p className="text-13 leading-snug mt-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("roles.stepCategoryHint")}
                </p>
                <div className="grid grid-cols-2 gap-2.5 pt-4">
                  {categories.map((category) => {
                    const on = roleCategory === category.value;
                    return (
                      <button
                        key={category.value}
                        type="button"
                        onClick={() => setRoleCategory(category.value)}
                        aria-pressed={on}
                        data-testid={`role-category-${category.value}`}
                        className="rounded-[var(--radius-tile)] p-3 text-start min-h-[76px]"
                        style={{
                          background: on ? "var(--roles-accent-soft)" : "var(--surface)",
                          border: `1px solid ${on ? "var(--roles-accent-border)" : "var(--border-control)"}`,
                        }}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-12 font-semibold">{t(category.labelKey)}</span>
                          {on && <Check size={14} style={{ color: "var(--roles-accent-text)" }} />}
                        </div>
                        <span className="text-10 mt-1 block" style={{ color: "var(--text-secondary)" }}>
                          {category.modules.slice(0, 2).map((m) => areaLabel(m)).join(" · ") || t("roles.category.other")}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-11 mt-3" style={{ color: "var(--text-secondary)" }}>
                  {t("roles.levelHint")}
                </p>
              </div>
            )}

            {step === "basics" && (
              <div data-testid="role-step-basics">
                <h2 className="text-20 font-bold leading-tight mt-1">{t("roles.stepInfo")}</h2>
                <p className="text-13 leading-snug mt-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("roles.stepInfoHint")}
                </p>

                <div className="pt-4">
                  <p className="text-11 font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                    {t("roles.name")} *
                  </p>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("roles.nameHint")}
                    data-testid="role-name"
                    dir="auto"
                    autoFocus={isNew}
                    className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                    style={fieldStyle}
                  />
                </div>

                <div className="pt-3">
                  <p className="text-11 font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                    {t("roles.department")} *
                  </p>
                  <div className="flex flex-wrap gap-2" data-testid="role-departments">
                    {departments.map((d) => {
                      const on = departmentId === d.id;
                      return (
                        <button
                          key={d.id}
                          type="button"
                          onClick={() => setDepartmentId(on ? null : d.id)}
                          aria-pressed={on}
                          data-testid={`role-dept-${d.code}`}
                          className="h-8 px-3.5 rounded-full text-12 font-semibold"
                          style={{
                            background: on ? "var(--roles-accent)" : "var(--field-bg)",
                            color: on ? "var(--roles-accent-fg)" : "var(--text-secondary)",
                            border: `1px solid ${on ? "var(--roles-accent)" : "var(--border-control)"}`,
                          }}
                        >
                          {isUrdu ? d.nameUr : d.nameEn}
                        </button>
                      );
                    })}
                  </div>
                  {newDeptOpen ? (
                    <div className="flex items-center gap-2 mt-2.5">
                      <input
                        value={newDeptName}
                        onChange={(e) => setNewDeptName(e.target.value)}
                        placeholder={t("roles.newDepartmentName")}
                        dir="auto"
                        className="flex-1 min-w-0 h-10 rounded-[var(--radius-input)] px-3 text-13 outline-none"
                        style={fieldStyle}
                      />
                      <button
                        type="button"
                        onClick={handleAddDepartment}
                        disabled={addingDept || !newDeptName.trim()}
                        className="h-10 px-4 rounded-full text-12 font-bold shrink-0 disabled:opacity-50"
                        style={{ background: "var(--roles-accent)", color: "var(--roles-accent-fg)" }}
                      >
                        {addingDept ? t("common.saving") : t("roles.add")}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setNewDeptOpen(true)}
                      className="mt-2.5 flex items-center gap-1 text-12 font-semibold"
                      style={{ color: "var(--roles-accent-text)" }}
                    >
                      <Plus size={14} /> {t("roles.addDepartment")}
                    </button>
                  )}
                </div>

                <div className="pt-4">
                  <p className="text-11 font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                    {t("roles.level")}
                  </p>
                  <div className="flex flex-wrap gap-2" data-testid="role-levels">
                    {RESPONSIBILITY_LEVELS.map((level) => {
                      const on = responsibilityLevel === level.value;
                      return (
                        <button
                          key={level.value}
                          type="button"
                          onClick={() => setResponsibilityLevel(level.value)}
                          aria-pressed={on}
                          className="h-8 px-3.5 rounded-full text-12 font-semibold"
                          style={{
                            background: on ? "var(--roles-accent)" : "var(--field-bg)",
                            color: on ? "var(--roles-accent-fg)" : "var(--text-secondary)",
                            border: `1px solid ${on ? "var(--roles-accent)" : "var(--border-control)"}`,
                          }}
                        >
                          {t(level.labelKey)}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-11 mt-1.5" style={{ color: "var(--text-secondary)" }}>
                    {t("roles.levelHint")}
                  </p>
                </div>

                <div className="pt-3">
                  <p className="text-11 font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
                    {t("roles.description")}
                  </p>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={t("roles.descriptionHint")}
                    rows={3}
                    dir="auto"
                    className="w-full rounded-[var(--radius-tile)] px-3 py-2.5 text-13 outline-none resize-none"
                    style={fieldStyle}
                  />
                </div>

                {role && (
                  <div className="pt-5">
                    <ListCard>
                      <ListRow
                        danger
                        icon={Trash2}
                        onClick={() => setDeleteOpen(true)}
                        testId="role-delete-row"
                        title={t("roles.deleteAction")}
                        meta={deleteConsequence(true)}
                      />
                    </ListCard>
                  </div>
                )}
              </div>
            )}

            {step === "recommend" && (
              <div data-testid="role-step-recommend">
                <h2 className="text-20 font-bold leading-tight mt-1">{t("roles.stepRecommend")}</h2>
                <p className="text-13 leading-snug mt-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("roles.stepRecommendHint", {
                    category: t(categoryLabelKey(roleCategory)),
                    level: t(levelLabelKey(responsibilityLevel)),
                  })}
                </p>

                <div className="grid grid-cols-3 gap-2 pt-4">
                  {[
                    { value: recommendedCodes.length, label: t("roles.statPermissions") },
                    { value: recommendedWidgets.length, label: t("roles.statWidgets") },
                    { value: new Set(recommendedCodes.map((code) => code.split(".")[0])).size, label: t("roles.statModules") },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-[var(--radius-tile)] px-2 py-3 text-center"
                      style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
                    >
                      <p className="text-18 font-bold" style={{ color: "var(--roles-accent-text)" }}>{stat.value}</p>
                      <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>{stat.label}</p>
                    </div>
                  ))}
                </div>

                <div className="pt-5">
                  <h3 className="text-14 font-bold">{t("roles.recommendPermissions")}</h3>
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {recommendedCodes.map((code) => {
                      const permission = permissions.find((p) => p.code === code);
                      return (
                        <span
                          key={code}
                          className="text-10 font-medium px-2 py-1 rounded-full"
                          style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}
                        >
                          {permission ? (isUrdu ? permission.label_ur : permission.label_en) : code}
                        </span>
                      );
                    })}
                    {recommendedCodes.length === 0 && (
                      <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("roles.recommendEmpty")}</p>
                    )}
                  </div>
                </div>

                <div className="pt-4">
                  <h3 className="text-14 font-bold">{t("roles.recommendDashboards")}</h3>
                  <div className="flex flex-col gap-1.5 pt-2">
                    {widgets.filter((w) => recommendedWidgets.includes(w.key)).map((w) => (
                      <div key={w.key} className="flex items-center gap-2 text-12">
                        <Check size={13} style={{ color: "var(--roles-accent-text)" }} />
                        <span>{isUrdu ? w.labelUr : w.labelEn}</span>
                      </div>
                    ))}
                    {recommendedWidgets.length === 0 && (
                      <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("roles.recommendEmpty")}</p>
                    )}
                  </div>
                </div>

                <div className="pt-5 flex flex-col gap-2.5">
                  <ChoiceCard
                    selected={recommendationChoice === "accept"}
                    title={t("roles.acceptSuggestions")}
                    description={t("roles.acceptSuggestionsHint")}
                    icon={Check}
                    onClick={() => setRecommendationChoice("accept")}
                  />
                  <ChoiceCard
                    selected={recommendationChoice === "customize"}
                    title={t("roles.customizeSuggestions")}
                    description={t("roles.customizeSuggestionsHint")}
                    icon={Sparkles}
                    onClick={() => setRecommendationChoice("customize")}
                  />
                  <ChoiceCard
                    selected={recommendationChoice === "none"}
                    title={t("roles.startWithout")}
                    description={t("roles.startWithoutHint")}
                    icon={Plus}
                    onClick={() => setRecommendationChoice("none")}
                  />
                </div>
              </div>
            )}

            {step === "data" && (
              <div data-testid="role-step-data">
                <h2 className="text-20 font-bold leading-tight mt-1">{t("roles.stepData")}</h2>
                <p className="text-13 leading-snug mt-1.5" style={{ color: "var(--text-secondary)" }}>
                  {t("roles.dataHint")}
                </p>

                <div
                  className="mt-4 rounded-[var(--radius-card)] p-4"
                  style={{ background: "var(--surface)", border: "1px solid var(--roles-accent-border)" }}
                >
                  <div className="flex items-start gap-3">
                    <span className="size-10 rounded-[var(--radius-tile)] grid place-items-center shrink-0" style={{ background: "var(--roles-accent-soft)", color: "var(--roles-accent-text)" }}>
                      <ShieldCheck size={18} />
                    </span>
                    <div>
                      <p className="text-14 font-bold">{t("roles.branchOnly")}</p>
                      <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>{t("roles.branchOnlyHint")}</p>
                    </div>
                    <Check size={16} className="ms-auto shrink-0" style={{ color: "var(--roles-accent-text)" }} />
                  </div>
                  <div className="flex items-center gap-1.5 mt-3 text-10" style={{ color: "var(--text-secondary)" }}>
                    <span>{t("roles.branchFlowBusiness")}</span>
                    <ChevronRight size={12} className={isUrdu ? "rotate-180" : ""} />
                    <span>{t("roles.branchFlowBranch")}</span>
                    <ChevronRight size={12} className={isUrdu ? "rotate-180" : ""} />
                    <span>{t("roles.branchFlowRole")}</span>
                  </div>
                </div>

                {dataScope !== "branches" && (
                  <p className="text-11 mt-3 p-3 rounded-[var(--radius-tile)]" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                    {t("roles.legacyScope", { level: t(SCOPE_KEYS[dataScope]) })}
                  </p>
                )}

                <div className="mt-4">
                  <h3 className="text-14 font-bold">{t("roles.accessResolved")}</h3>
                  <div className="flex flex-col gap-2 pt-2">
                    {[
                      t("roles.accessResolvedRole"),
                      t("roles.accessResolvedAssignment"),
                      t("roles.accessResolvedOverrides"),
                    ].map((line, index) => (
                      <div key={line} className="flex items-start gap-2.5">
                        <span className="size-5 rounded-full grid place-items-center text-10 font-bold shrink-0" style={{ background: "var(--surface-2)", color: "var(--text-primary)" }}>{index + 1}</span>
                        <p className="text-12 leading-snug" style={{ color: "var(--text-secondary)" }}>{line}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <p className="text-11 mt-4 p-3 rounded-[var(--radius-tile)]" style={{ background: "var(--error-bg)", color: "var(--error)" }}>
                  {t("roles.scopeNotEnforced")}
                </p>

                <div className="pt-4 flex flex-wrap gap-2">
                  {SCOPES.filter((scope) => scope === "branches" || scope === dataScope).map((scope) => (
                    <button
                      key={scope}
                      type="button"
                      onClick={() => setDataScope(scope)}
                      className="h-8 px-3 rounded-full text-11 font-semibold"
                      style={{
                        background: dataScope === scope ? "var(--roles-accent)" : "var(--field-bg)",
                        color: dataScope === scope ? "var(--roles-accent-fg)" : "var(--text-secondary)",
                        border: `1px solid ${dataScope === scope ? "var(--roles-accent)" : "var(--border-control)"}`,
                      }}
                    >
                      {t(SCOPE_KEYS[scope])}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {step === "permissions" && (
              <div data-testid="role-step-permissions">
                <div className="flex items-start justify-between gap-2 pt-1">
                  <div>
                    <h2 className="text-20 font-bold leading-tight">{t("roles.stepPermissions")}</h2>
                    <p className="text-12 leading-snug mt-1" style={{ color: "var(--text-secondary)" }}>
                      {t("roles.stepPermissionsHint")}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={selectAll.toggleAll}
                    disabled={permsState !== "ready"}
                    className="h-7 px-2.5 rounded-full text-10 font-semibold shrink-0 disabled:opacity-50"
                    style={{ background: "var(--surface-2)", border: "1px solid var(--roles-accent-border)", color: "var(--roles-accent-text)" }}
                  >
                    {selectAll.allSelected ? t("roles.clearAll") : t("roles.selectAll")}
                  </button>
                </div>

                <div className="flex items-center justify-between gap-2 pt-3 pb-1">
                  <p className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {t("roles.selectedPermissions", { count: selected.size })}
                  </p>
                  <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                    {t("roles.selectedModules", { count: selectedModules.length })}
                  </p>
                </div>

                {permsState === "error" ? (
                  <div className="py-4" role="alert">
                    <p className="text-xs" style={{ color: "var(--error)" }}>{t("access.roleUnavailable")}</p>
                    {role && (
                      <button
                        type="button"
                        onClick={() => {
                          setPermsState("loading");
                          void loadRoleAccess(role.id).then((access) => {
                            if (access.error) {
                              setPermsState("error");
                              return;
                            }
                            setSelected(new Set(access.permissions));
                            setDashboards(new Set(access.dashboards));
                            setDepartmentId(access.departmentId);
                            setDataScope(access.dataScope);
                            setRoleCategory(access.roleCategory ?? role.roleCategory ?? null);
                            setResponsibilityLevel(access.responsibilityLevel ?? "individual_contributor");
                            setPermsState("ready");
                          });
                        }}
                        className="text-11 font-bold mt-2"
                        style={{ color: "var(--text-primary)" }}
                      >
                        {t("common.retry")}
                      </button>
                    )}
                  </div>
                ) : permsState === "ready" ? (
                  <PermissionChecklist
                    value={selected}
                    onChange={setSelected}
                    maxHeight="none"
                    accordion
                    priorityModules={priorityModules}
                    highlightModules={priorityModules}
                  />
                ) : (
                  <div className="py-4" role="status" aria-busy="true">
                    <span className="sr-only">{t("access.loadingRole")}</span>
                    <SkeletonList rows={3} bare />
                  </div>
                )}
              </div>
            )}

            {step === "dashboards" && (
              <div data-testid="role-step-dashboards">
                <h2 className="text-20 font-bold leading-tight mt-1">{t("roles.stepDashboards")}</h2>
                <p className="text-12 leading-snug mt-1" style={{ color: "var(--text-secondary)" }}>
                  {t("roles.stepDashboardsHint")}
                </p>
                <div className="flex items-center justify-between pt-3 pb-1">
                  <p className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                    {t("roles.widgetsSelected", { count: dashboards.size })}
                  </p>
                  {missingDependencies.length > 0 && (
                    <p className="text-10 font-semibold" style={{ color: "var(--error)" }}>
                      {t("roles.missingDeps", { count: missingDependencies.length })}
                    </p>
                  )}
                </div>
                <DashboardVisibilityChecklist
                  value={dashboards}
                  onChange={setDashboards}
                  permissions={selected}
                />
              </div>
            )}

            {step === "review" && (
              <div data-testid="role-step-review">
                <h2 className="text-20 font-bold leading-tight mt-1">{t("roles.stepReview")}</h2>
                <p className="text-12 leading-snug mt-1" style={{ color: "var(--text-secondary)" }}>
                  {t("roles.stepReviewHint")}
                </p>

                <div className="mt-4 rounded-[var(--radius-card)] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                  <div className="flex items-start gap-3">
                    <span className="size-11 rounded-[var(--radius-tile)] grid place-items-center shrink-0 text-16 font-bold" style={{ background: "var(--roles-accent-soft)", color: "var(--roles-accent-text)" }}>
                      {(name.trim()[0] ?? "?").toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="text-15 font-bold truncate">{name || t("roles.new")}</p>
                      <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                        {departmentLabel ?? t("roles.noDepartment")}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        <span className="text-10 font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--roles-accent-soft)", color: "var(--roles-accent-text)" }}>{t(categoryLabelKey(roleCategory))}</span>
                        <span className="text-10 font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>{t(levelLabelKey(responsibilityLevel))}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-3">
                  <ListCard>
                    <ListRow
                      onClick={() => setStep("data")}
                      testId="review-data"
                      title={t("roles.reviewDataAccess")}
                      meta={dataScope === "branches" ? t("roles.branchOnly") : t(SCOPE_KEYS[dataScope])}
                      trailing={editTrailing}
                    />
                    <ListRow
                      onClick={() => setStep("permissions")}
                      testId="review-permissions"
                      title={t("roles.reviewPermissions")}
                      meta={t("roles.permissionCount", { count: selected.size })}
                      trailing={editTrailing}
                    />
                    <ListRow
                      onClick={() => setStep("dashboards")}
                      testId="review-dashboards"
                      title={t("roles.reviewDashboards")}
                      meta={t("roles.sectionCount", { count: dashboards.size })}
                      trailing={editTrailing}
                    />
                  </ListCard>
                </div>

                <div className="pt-4">
                  <h3 className="text-14 font-bold">{t("roles.reviewPermissions")}</h3>
                  <div className="pt-2">
                    {selectedModules.map(([module, labels]) => (
                      <div key={module} className="flex gap-2 text-12 py-1">
                        <span className="font-semibold shrink-0">{areaLabel(module)}</span>
                        <span style={{ color: "var(--text-secondary)" }}>{labels.join(", ")}</span>
                      </div>
                    ))}
                    {selectedModules.length === 0 && (
                      <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("roles.noPermissions")}</p>
                    )}
                  </div>
                  <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>
                    {t("roles.reviewRestricted", { count: Math.max(0, permissions.length - selected.size) })}
                  </p>
                </div>

                <div className="pt-4">
                  <h3 className="text-14 font-bold">{t("roles.reviewDashboards")}</h3>
                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {selectedWidgets.map((w) => (
                      <span key={w.key} className="text-10 font-medium px-2 py-1 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                        {isUrdu ? w.labelUr : w.labelEn}
                      </span>
                    ))}
                    {selectedWidgets.length === 0 && (
                      <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("roles.noDashboards")}</p>
                    )}
                  </div>
                </div>

                {missingDependencies.length > 0 && (
                  <p className="text-11 mt-3 p-3 rounded-[var(--radius-tile)]" style={{ background: "var(--error-bg)", color: "var(--error)" }}>
                    <strong>{t("roles.missingDeps", { count: missingDependencies.length })}</strong>
                    <br />
                    {missingDependencies.map((dep) => {
                      const widget = widgets.find((w) => w.key === dep.key);
                      const permission = permissions.find((p) => p.code === dep.permission);
                      return `${widget ? (isUrdu ? widget.labelUr : widget.labelEn) : dep.key}: ${permission ? (isUrdu ? permission.label_ur : permission.label_en) : dep.permission}`;
                    }).join(" · ")}
                  </p>
                )}

                {(unknownWidgets.length > 0 || (permissions.length > 0 && [...selected].some((code) => !permissions.some((p) => p.code === code)))) && (
                  <div className="pt-3">
                    <h3 className="text-12 font-bold">{t("roles.reviewUnsupported")}</h3>
                    {unknownWidgets.length > 0 && <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>{unknownWidgets.join(", ")}</p>}
                    <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                      {[...selected].filter((code) => permissions.length > 0 && !permissions.some((p) => p.code === code)).join(", ")}
                    </p>
                  </div>
                )}

                {mode === "template" && (
                  <p className="text-11 mt-3" style={{ color: "var(--text-secondary)" }}>{t("roles.templateNotice")}</p>
                )}
              </div>
            )}

            {stepError && (
              <p className="text-11 mt-3" style={{ color: "var(--error)" }} role="alert" data-testid="role-step-error">
                {stepError}
              </p>
            )}
          </>
        )}
      </div>

      {formReady && (
        <div
          className="sticky bottom-0 px-4 pt-3 pb-4 flex items-center gap-3"
          style={{ background: "var(--background)", borderTop: "1px solid var(--divider)" }}
        >
          <button
            type="button"
            onClick={goBack}
            data-testid="role-back"
            className="h-12 px-5 rounded-full text-13 font-semibold shrink-0"
            style={{ color: "var(--text-secondary)" }}
          >
            {stepIndex === 0 || (!isNew && step === "category") ? t("common.cancel") : t("common.back")}
          </button>
          {step === "review" ? (
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || permsState !== "ready"}
              data-testid="role-save"
              className="flex-1 h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ background: "var(--roles-accent)", color: "var(--roles-accent-fg)" }}
            >
              {saving ? t("common.saving") : t("roles.saveRole")}
            </button>
          ) : (
            <button
              type="button"
              onClick={goNext}
              data-testid="role-next"
              disabled={!canContinue}
              className="flex-1 h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
              style={{ background: "var(--roles-accent)", color: "var(--roles-accent-fg)" }}
            >
              {t("roles.continue")}
            </button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen && role !== null}
        title={t("roles.deleteConfirm")}
        message={deleteConsequence()}
        confirmLabel={t("roles.deleteAction")}
        cancelLabel={t("common.cancel")}
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
        onCancel={() => !deleting && setDeleteOpen(false)}
      />
    </div>
  );
}
