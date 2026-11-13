import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileText,
  MapPin,
  User,
} from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import { SkeletonList } from "@/components/ui/Skeleton";
import SalaryFields from "@/components/admin/SalaryFields";
import EmployeeAccessEditor from "@/components/admin/EmployeeAccessEditor";
import { DashboardEligibility } from "@/components/admin/DashboardEligibility";
import InviteLinkCard from "@/components/admin/InviteLinkCard";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useRolesStore } from "@/stores/rolesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useAccessCatalogStore } from "@/stores/accessCatalogStore";
import { useAuthStore } from "@/stores/authStore";
import { useShopStore } from "@/stores/shopStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useShellBase } from "@/lib/useShellBase";
import { usePermissionLabels } from "@/lib/permissionLabels";
import { supabase } from "@/lib/supabase";
import { digitsOnlyPhone, localPhone, phoneFieldProps } from "@/lib/phoneInput";
import { normalizePhone } from "@/lib/auth";
import { branchKind } from "@/lib/branchKind";
import { clearNav, navigateBack } from "@/lib/navContext";
import {
  applyRestrictions,
  restrictionCount,
  restrictionOverrides,
} from "@/lib/accessModel";
import { categoryLabelKey, isOwnerRoleName } from "@/lib/roleTemplates";
import { eligibleWidgets } from "@/lib/dashboardAccess";
import {
  emptySalaryDraft,
  salaryHasErrors,
  saveEmployeeSalary,
  validateSalaryDraft,
  type SalaryDraft,
} from "@/lib/salary";
import { pkToday } from "@/lib/pkDate";
import type { Role } from "@/types";

type Step = "who" | "role" | "where" | "review";

const STEP_ORDER: Step[] = ["who", "role", "where", "review"];
const DRAFT_KEY = "agrishop:add-employee-draft";

interface AddEmployeeDraft {
  name: string;
  phone: string;
  salaryEnabled: boolean;
  salary: SalaryDraft;
  branchScope: string[] | null;
  roleId: string | null;
}

export default function AddEmployeePage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const base = useShellBase();
  const teamBase = base === "/admin" ? `${base}/employees` : `${base}/team`;
  const [searchParams] = useSearchParams();
  const { addToast } = useUIStore();
  const language = useThemeStore((s) => s.language);
  const { user } = useAuthStore();
  const { areaLabel } = usePermissionLabels();
  const employees = useEmployeesStore((s) => s.employees);
  const createEmployee = useEmployeesStore((s) => s.createEmployee);
  const roles = useRolesStore((s) => s.roles);
  const rolesReady = useRolesStore((s) => s.ready);
  const loadRoles = useRolesStore((s) => s.load);
  const loadRolePermissions = useRolesStore((s) => s.loadRolePermissions);
  const loadPermissions = usePermissionsStore((s) => s.load);
  const permissions = usePermissionsStore((s) => s.permissions);
  const loadCatalog = useAccessCatalogStore((s) => s.load);
  const widgets = useAccessCatalogStore((s) => s.widgets);

  const [step, setStep] = useState<Step>("who");
  const [name, setName] = useState(() => searchParams.get("name") ?? "");
  const [phone, setPhone] = useState(() => localPhone(searchParams.get("phone") ?? ""));
  const [roleId, setRoleId] = useState<string | null>(null);
  const [roleDefaults, setRoleDefaults] = useState<string[]>([]);
  const [accessValue, setAccessValue] = useState<Set<string>>(new Set());
  const [roleAccess, setRoleAccess] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [roleFacts, setRoleFacts] = useState<Record<string, { permissions: number; widgets: number }>>({});
  const [branchScope, setBranchScope] = useState<string[] | null>([]);
  const [branches, setBranches] = useState<{ id: string; name: string; is_default: boolean; address: string | null }[]>([]);
  const [salaryEnabled, setSalaryEnabled] = useState(false);
  const [salary, setSalary] = useState<SalaryDraft>(() => emptySalaryDraft());
  const [salarySheetOpen, setSalarySheetOpen] = useState(false);
  const [salaryDraft, setSalaryDraft] = useState<SalaryDraft>(() => emptySalaryDraft());
  const [salarySheetTouched, setSalarySheetTouched] = useState(false);
  const [customizeOpen, setCustomizeOpen] = useState(false);
  const [sent, setSent] = useState<{ id: string | null; name: string; phone: string } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const creatingRef = useRef(false);
  const restoredRef = useRef(false);
  const branchDefaultApplied = useRef(false);
  const isRtl = language === "ur";
  const ForwardChevron = isRtl ? ChevronLeft : ChevronRight;

  const activeBranchId = useShopStore((s) => s.activeBranchId);

  useEffect(() => {
    void loadRoles();
    void loadPermissions();
    void loadCatalog();
    // Branches are read directly because this screen needs inactive filtering and the tenant
    // boundary is already carried by the session.
    void supabase
      .from("branches")
      .select("id, name, is_default, address")
      .eq("is_active", true)
      .then(({ data: rows }) => setBranches((rows as typeof branches | null) ?? []));
  }, [loadRoles, loadPermissions, loadCatalog]);

  // Restore a draft only when the role builder sent the owner back here. The key is
  // removed on read, so a later new-employee visit does not inherit stale fields.
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) {
      return;
    }
    try {
      const draft = JSON.parse(raw) as AddEmployeeDraft;
      if (draft.name) setName(draft.name);
      if (draft.phone) setPhone(draft.phone);
      if (draft.salary) setSalary({ ...emptySalaryDraft(), ...draft.salary });
      setSalaryEnabled(Boolean(draft.salaryEnabled));
      if (draft.branchScope) setBranchScope(draft.branchScope);
      if (draft.roleId) setRoleId(draft.roleId);
    } catch {
      // A corrupt draft is not a reason to block a new employee.
    }
    sessionStorage.removeItem(DRAFT_KEY);
  }, []);

  const createdRoleId = (location.state as { createdRoleId?: string } | null)?.createdRoleId ?? null;
  useEffect(() => {
    if (!createdRoleId || !rolesReady) return;
    if (roles.some((role) => role.id === createdRoleId)) {
      void selectRole(createdRoleId);
    }
    // `selectRole` is stable in behaviour and reads the current role list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createdRoleId, rolesReady, roles]);

  // A role the owner opened with Modify comes back through the draft. Reload its saved
  // access so the review reflects what was actually changed instead of an empty role.
  useEffect(() => {
    if (!rolesReady || !roleId || roleAccess !== "idle") return;
    if (!roles.some((role) => role.id === roleId)) return;
    void selectRole(roleId);
    // `selectRole` is stable in behaviour and reads the current role list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolesReady, roleId, roleAccess, roles]);

  useEffect(() => {
    if (branchDefaultApplied.current || branches.length === 0 || !activeBranchId) return;
    if (!branches.some((branch) => branch.id === activeBranchId)) return;
    branchDefaultApplied.current = true;
    setBranchScope((current) => (current && current.length ? current : [activeBranchId]));
  }, [branches, activeBranchId]);

  // Short facts on each role card: the catalogue is read once per role, not inferred from a name.
  useEffect(() => {
    if (!rolesReady || widgets.length === 0 || roles.length === 0) return;
    let live = true;
    void Promise.all(
      roles.map(async (role) => {
        const { codes } = await loadRolePermissions(role.id);
        return [role.id, { permissions: codes.length, widgets: eligibleWidgets(widgets, new Set(codes)).length }] as const;
      }),
    ).then((rows) => {
      if (live) setRoleFacts(Object.fromEntries(rows));
    });
    return () => {
      live = false;
    };
  }, [rolesReady, roles, widgets, loadRolePermissions]);

  const roleObj = roles.find((role) => role.id === roleId) ?? null;
  const stepIndex = STEP_ORDER.indexOf(step);
  const firstName = name.trim().split(" ")[0] || t("addEmployee.stepWho");
  const effectiveAccess = applyRestrictions(roleDefaults, restrictionOverrides(accessValue, roleDefaults));
  const denied = restrictionCount(restrictionOverrides(accessValue, roleDefaults));
  const eligible = eligibleWidgets(widgets, effectiveAccess);
  const salaryFrequency = t(`salary.unit.${salary.payUnit}`);
  const salaryCardSummary = salaryEnabled && salary.amount.trim()
    ? t("salary.summary", { amount: salary.amount, frequency: salaryFrequency })
    : t("salary.optionalHint");
  const selectedBranches = (branchScope ?? [])
    .map((id) => branches.find((branch) => branch.id === id))
    .filter((branch): branch is { id: string; name: string; is_default: boolean; address: string | null } => Boolean(branch));
  const branchSummary = selectedBranches.length
    ? selectedBranches.map((branch) => branch.name).join(", ")
    : t("addEmployee.noBranchChosen");

  const accessByModule = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const code of effectiveAccess) {
      const permission = permissions.find((entry) => entry.code === code);
      if (!permission) continue;
      map.set(permission.module, [...(map.get(permission.module) ?? []), permission.action]);
    }
    return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [effectiveAccess, permissions]);

  const sortedRoles = useMemo(
    () =>
      roles
        .filter((role) => !isOwnerRoleName(role.name))
        .sort((left, right) => {
          const rank = (role: Role) => {
            const name = role.name.trim().toLowerCase();
            if (name === "staff") return 0;
            if (name === "manager") return 1;
            return 2;
          };
          return rank(left) - rank(right) || left.name.localeCompare(right.name);
        }),
    [roles],
  );

  async function selectRole(id: string) {
    setRoleId(id);
    setError("");
    setRoleAccess("loading");
    setRoleDefaults([]);
    setAccessValue(new Set());
    const { codes, error: readError } = await loadRolePermissions(id);
    if (readError) {
      setRoleAccess("error");
      setError(t("access.roleUnavailable"));
      return;
    }
    const next = new Set(codes);
    setRoleDefaults(codes);
    setAccessValue(next);
    setRoleAccess("ready");
  }

  function validateWho(): boolean {
    setError("");
    if (!name.trim()) {
      setError(t("addEmployee.errName"));
      return false;
    }
    if (phone.replace(/\D/g, "").length < 10) {
      setError(t("addEmployee.errPhone"));
      return false;
    }
    const normalized = normalizePhone(phone);
    if (employees.some((employee) => normalizePhone(employee.phone) === normalized)) {
      setError(t("addEmployee.errPhoneUsed"));
      return false;
    }
    if (salaryEnabled) {
      const drafted = validateSalaryDraft(salary);
      if (salaryHasErrors(drafted)) {
        setError(t("salary.errFix"));
        return false;
      }
    }
    return true;
  }

  function next() {
    setError("");
    if (step === "who") {
      if (!validateWho()) return;
      setStep("role");
      return;
    }
    if (step === "role") {
      if (!roleId) {
        setError(t("addEmployee.errRole"));
        return;
      }
      if (roleAccess !== "ready") {
        setError(t("addEmployee.accessLoading"));
        return;
      }
      setStep("where");
      return;
    }
    if (step === "where") {
      if (!branchScope || branchScope.length === 0) {
        setError(t("addEmployee.errNoBranch"));
        return;
      }
      setStep("review");
    }
  }

  function back() {
    setError("");
    if (step === "role") return setStep("who");
    if (step === "where") return setStep("role");
    if (step === "review") return setStep("where");
    navigateBack(location, navigate, teamBase);
  }

  function saveDraft() {
    const draft: AddEmployeeDraft = {
      name,
      phone,
      salaryEnabled,
      salary,
      branchScope,
      roleId,
    };
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }

  function openSalarySheet() {
    setSalaryDraft({ ...salary });
    setSalarySheetTouched(false);
    setSalarySheetOpen(true);
  }

  function saveSalaryDetails() {
    const drafted = validateSalaryDraft(salaryDraft);
    setSalarySheetTouched(true);
    if (salaryHasErrors(drafted)) return;
    setSalary({ ...salaryDraft });
    setSalaryEnabled(true);
    setSalarySheetOpen(false);
  }

  function removeSalary() {
    setSalaryEnabled(false);
    setSalary(emptySalaryDraft());
    setSalaryDraft(emptySalaryDraft());
  }

  function createCustomRole() {
    if (!validateWho()) return;
    saveDraft();
    navigate(`${base}/settings/roles/new`, {
      state: {
        setupFlow: {
          returnPath: `${base}/employees/new`,
          returnState: { fromAddEmployee: true },
        },
      },
    });
  }

  function modifyRole(role: Role) {
    saveDraft();
    navigate(`${base}/settings/roles/${role.id}`, {
      state: {
        setupFlow: {
          returnPath: `${base}/employees/new`,
          returnState: { fromAddEmployee: true },
        },
      },
    });
  }

  function resetForm() {
    setSent(null);
    setStep("who");
    setName("");
    setPhone("");
    setRoleId(null);
    setRoleDefaults([]);
    setAccessValue(new Set());
    setRoleAccess("idle");
    setBranchScope(activeBranchId ? [activeBranchId] : []);
    setSalaryEnabled(false);
    setSalary(emptySalaryDraft());
    setSalaryDraft(emptySalaryDraft());
    setSalarySheetTouched(false);
    setSalarySheetOpen(false);
    setError("");
    sessionStorage.removeItem(DRAFT_KEY);
  }

  async function invite() {
    if (creatingRef.current) return;
    if (!validateWho()) return;
    if (!roleId || roleAccess !== "ready") {
      setError(t("addEmployee.errRole"));
      return;
    }
    if (!Array.isArray(branchScope) || branchScope.length === 0) {
      setError(t("addEmployee.errNoBranch"));
      return;
    }
    if (salaryEnabled && salaryHasErrors(validateSalaryDraft(salary))) {
      setError(t("salary.errFix"));
      return;
    }
    creatingRef.current = true;
    setLoading(true);
    setError("");
    try {
      const created = await createEmployee({
        name: name.trim(),
        phone: normalizePhone(phone),
        role: "employee",
        roleId,
        overrides: restrictionOverrides(accessValue, roleDefaults),
        branchScope,
        createdBy: user?.id,
      });

      if (salaryEnabled && salary.amount.trim()) {
        try {
          await saveEmployeeSalary({
            employeeId: created.id,
            branchId: branchScope[0],
            amount: Number(salary.amount),
            payEvery: Math.max(1, Number(salary.payEvery) || 1),
            payUnit: salary.payUnit,
            payDay: salary.payUnit === "month" ? Number(salary.payDay) || 1 : null,
            startsOn: salary.startsOn || pkToday(),
            endsOn: salary.endMode === "date" ? salary.endsOn : null,
            totalPayments: salary.endMode === "payments" ? Number(salary.totalPayments) : null,
            method: salary.method,
            addToExpenses: salary.addToExpenses,
          });
        } catch (salaryFailure) {
          addToast(
            t("salary.savedEmployeeOnly", {
              message: salaryFailure instanceof Error ? salaryFailure.message : t("salary.errSave"),
            }),
            "info",
          );
        }
      }

      addToast(t("addEmployee.created", { name: name.trim() }), "success");
      clearNav();
      setSent({ id: created.id, name: name.trim(), phone: normalizePhone(phone) });
      sessionStorage.removeItem(DRAFT_KEY);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("addEmployee.errFailed"));
      creatingRef.current = false;
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col w-full min-h-[100dvh]" style={{ background: "var(--background)", color: "var(--text-primary)" }}>
        <StatusBar />
        <NavHeader title={t("addEmployee.title")} />
        <div className="flex-1 flex flex-col gap-4 p-4">
          <div className="flex flex-col items-center text-center gap-2 pt-4 pb-2">
            <CheckCircle2 size={40} style={{ color: "var(--brand-dark)" }} />
            <p className="text-lg font-bold" data-testid="invite-sent-title">
              {t("addEmployee.created", { name: sent.name })}
            </p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t("addEmployee.sentNext", { name: sent.name.split(" ")[0] || sent.name })}
            </p>
          </div>
          <InviteLinkCard name={sent.name} phone={sent.phone} />
        </div>
        <div className="p-4 pb-6 flex gap-3">
          <button
            type="button"
            onClick={resetForm}
            className="h-12 px-6 rounded-full font-bold text-sm"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            {t("addEmployee.addAnother")}
          </button>
          <Button
            className="flex-1"
            variant="cta"
            onClick={() => navigate(sent.id ? `${teamBase}/${sent.id}` : teamBase, { replace: true })}
            testId="invite-open-employee"
          >
            {t("addEmployee.openEmployee", { name: sent.name.split(" ")[0] || sent.name })}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col w-full min-h-[100dvh]"
      style={{ background: "var(--background)", color: "var(--text-primary)" }}
      data-testid="add-employee-page"
      data-step={step}
    >
      <StatusBar />
      <NavHeader
        title={t("addEmployee.title")}
        onBack={back}
        backTo={teamBase}
        right={
          <span className="text-11 font-semibold tabular-nums" style={{ color: "var(--text-secondary)" }} data-testid="add-employee-step-count">
            {t("roles.stepOfShort", { step: String(stepIndex + 1), total: "4" })}
          </span>
        }
      />

      <div className="h-[3px] w-full" style={{ background: "var(--divider)" }} aria-hidden>
        <div
          className="h-full"
          style={{
            width: `${((stepIndex + 1) / STEP_ORDER.length) * 100}%`,
            background: "var(--brand)",
            transition: "width 200ms ease",
          }}
        />
      </div>

      <div className="flex-1 px-4 pt-6 pb-6 flex flex-col gap-5">
        {step === "who" && (
          <>
            <div>
              <h1 className="text-17 font-bold">{t("addEmployee.infoTitle")}</h1>
              <p className="text-13 mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.infoHint")}
              </p>
            </div>
            <div>
              <p className="text-13 font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.name")} *</p>
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("addEmployee.nameHint")}
                data-testid="employee-name"
                autoFocus
                className="w-full h-12 rounded-[var(--radius-input)] px-4 text-14 outline-none"
                style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
              />
            </div>
            <div>
              <p className="text-13 font-semibold mb-2" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.phone")} *</p>
              <input
                {...phoneFieldProps()}
                value={phone}
                onChange={(event) => setPhone(digitsOnlyPhone(event.target.value))}
                placeholder="03001234567"
                data-testid="employee-phone"
                className="w-full h-12 rounded-[var(--radius-input)] px-4 text-14 outline-none"
                style={{ background: "var(--field-bg)", color: "var(--text-primary)" }}
              />
              <p className="text-10 mt-1" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.phoneHint")}</p>
            </div>

            <button
              type="button"
              onClick={openSalarySheet}
              data-testid="add-employee-salary-card"
              className="w-full rounded-[var(--radius-card)] p-3.5 flex items-center gap-3 text-start"
              style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
            >
              <span
                className="size-11 rounded-[var(--radius-tile)] grid place-items-center shrink-0"
                style={{ background: "var(--tone-sunken)", color: "var(--brand-dark)" }}
              >
                <FileText size={17} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-13 font-bold block">{t("salary.title")}</span>
                <span className="text-10 mt-0.5 block leading-snug" style={{ color: "var(--text-secondary)" }}>
                  {salaryCardSummary}
                </span>
              </span>
              <span className="shrink-0 flex items-center gap-1 text-11 font-semibold" style={{ color: "var(--brand-dark)" }}>
                {salaryEnabled && salary.amount ? t("addEmployee.editSalary") : t("addEmployee.addSalary")}
                <ForwardChevron size={14} />
              </span>
            </button>
          </>
        )}

        {step === "role" && (
          <>
            <div>
              <h1 className="text-17 font-bold">{t("addEmployee.roleHeading")}</h1>
              <p className="text-13 mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.roleHint")}
              </p>
            </div>
            {!rolesReady ? (
              <SkeletonList rows={4} />
            ) : (
              <div
                className="rounded-[var(--radius-card)] overflow-hidden"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
                data-testid="add-employee-roles"
              >
                {sortedRoles.map((role, index) => {
                  const selected = roleId === role.id;
                  const facts = roleFacts[role.id];
                  const factLine = facts
                    ? [
                        t("roles.permissionShort", { count: String(facts.permissions) }),
                        t("roles.widgetShort", { count: String(facts.widgets) }),
                      ].join(" · ")
                    : "";
                  return (
                    <div
                      key={role.id}
                      className="flex items-start gap-2 p-4"
                      style={{
                        borderTop: index > 0 ? "1px solid var(--divider)" : undefined,
                        background: selected ? "var(--surface-2)" : "transparent",
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => void selectRole(role.id)}
                        aria-pressed={selected}
                        data-testid={`add-role-${role.id}`}
                        className="flex items-start gap-3 text-start flex-1 min-w-0"
                      >
                        <span
                          className="size-5 rounded-full grid place-items-center shrink-0 mt-0.5"
                          style={{ border: `1.5px solid ${selected ? "var(--text-primary)" : "var(--text-tertiary)"}` }}
                        >
                          {selected && <span className="size-2 rounded-full" style={{ background: "var(--text-primary)" }} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <strong className="text-15 font-bold">{role.name}</strong>
                            {factLine && (
                              <span className="text-10 font-semibold" style={{ color: "var(--brand-dark)" }}>
                                {factLine}
                              </span>
                            )}
                          </span>
                          {role.description && (
                            <span className="text-11 mt-1 block leading-snug" style={{ color: "var(--text-secondary)" }}>
                              {role.description}
                            </span>
                          )}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => modifyRole(role)}
                        className="shrink-0 flex items-center gap-0.5 text-10 font-semibold mt-0.5"
                        style={{ color: "var(--text-secondary)" }}
                      >
                        {t("addEmployee.modifyRole")}
                        <ForwardChevron size={12} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              onClick={createCustomRole}
              data-testid="add-employee-create-role"
              className="min-h-11 rounded-[var(--radius-tile)] px-3 flex items-center gap-2 text-start"
              style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
            >
              <span className="size-8 rounded-full grid place-items-center shrink-0" style={{ background: "var(--surface)", color: "var(--brand-dark)" }}>
                <User size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="text-12 font-bold block">{t("addEmployee.createCustomRole")}</span>
                <span className="text-10 block mt-0.5" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.createCustomRoleHint")}</span>
              </span>
              <ForwardChevron size={15} style={{ color: "var(--text-secondary)" }} />
            </button>
            {roleId && roleAccess === "loading" && (
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.accessLoading")}</p>
            )}
            {roleAccess === "error" && (
              <button type="button" onClick={() => roleId && void selectRole(roleId)} className="text-11 font-bold text-start" style={{ color: "var(--brand-dark)" }}>
                {t("common.retry")}
              </button>
            )}
          </>
        )}

        {step === "where" && (
          <>
            <div>
              <h1 className="text-17 font-bold">{t("addEmployee.branchAssignment")}</h1>
              <p className="text-13 mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.branchHint")}
              </p>
            </div>
            {branches.length === 0 ? (
              <p className="text-12" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.noBranches")}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {branches.map((branch) => {
                  const selected = branchScope?.includes(branch.id) ?? false;
                  return (
                    <button
                      key={branch.id}
                      type="button"
                      onClick={() =>
                        setBranchScope((current) => {
                          const list = current ?? [];
                          return list.includes(branch.id)
                            ? list.filter((id) => id !== branch.id)
                            : [...list, branch.id];
                        })
                      }
                      aria-pressed={selected}
                      data-testid={`add-branch-${branch.id}`}
                      className="w-full rounded-[var(--radius-card)] p-4 flex items-center gap-3 text-start"
                      style={{
                        background: selected ? "var(--surface)" : "var(--tone-card)",
                        border: `1.5px solid ${selected ? "var(--brand)" : "var(--divider)"}`,
                      }}
                    >
                      <span
                        className="size-5 rounded-full grid place-items-center shrink-0"
                        style={selected
                          ? { background: "var(--brand)", color: "#0a0a0a" }
                          : { border: "1.5px solid var(--text-secondary)" }}
                      >
                        {selected && <Check size={12} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="text-14 font-bold block">{branch.name}</span>
                        <span className="text-11 block mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          {branch.address || branchKind(t, branch.is_default)}
                        </span>
                      </span>
                      <MapPin size={15} style={{ color: "var(--text-secondary)" }} />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {step === "review" && (
          <>
            <div>
              <h1 className="text-17 font-bold">{t("addEmployee.reviewHeading")}</h1>
              <p className="text-13 mt-1 leading-relaxed" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.reviewHint")}
              </p>
            </div>
            <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }} data-testid="add-employee-review">
              <div className="flex items-start gap-3">
                <span className="size-11 rounded-full grid place-items-center shrink-0 text-14 font-bold" style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
                  {initialsOf(name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-16 font-bold">{name || t("addEmployee.newPerson")}</p>
                  <p className="text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>{phone}</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="text-9 font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--warning-bg)", color: "var(--warning)" }}>
                      {t("addEmployee.invitationPending")}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {salaryEnabled && salary.amount && (
              <div
                className="rounded-[var(--radius-card)] p-4 flex items-center gap-3"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
                data-testid="add-employee-salary-review"
              >
                <span
                  className="size-10 rounded-[var(--radius-tile)] grid place-items-center shrink-0"
                  style={{ background: "var(--tone-sunken)", color: "var(--brand-dark)" }}
                >
                  <FileText size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-13 font-bold">{t("salary.title")}</p>
                  <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>{salaryCardSummary}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setStep("who")}
                  className="shrink-0 text-10 font-semibold"
                  style={{ color: "var(--brand-dark)" }}
                >
                  {t("addEmployee.editSalary")}
                </button>
              </div>
            )}

            <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
              <div className="flex items-center justify-between gap-3">
                <p className="text-13 font-bold">{t("addEmployee.assignment")}</p>
                <button
                  type="button"
                  onClick={() => setStep("role")}
                  className="text-10 font-semibold"
                  style={{ color: "var(--text-secondary)" }}
                >
                  {t("roles.editStep")}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-3">
                <div className="min-w-0">
                  <p className="text-9 uppercase tracking-[0.14em]" style={{ color: "var(--text-secondary)" }}>
                    {t("addEmployee.labelRole")}
                  </p>
                  <p className="text-13 font-semibold mt-1 break-words">{roleObj?.name ?? "—"}</p>
                  {roleObj?.departmentName && (
                    <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>{roleObj.departmentName}</p>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="text-9 uppercase tracking-[0.14em]" style={{ color: "var(--text-secondary)" }}>
                    {t("addEmployee.labelBranch")}
                  </p>
                  <p className="text-13 font-semibold mt-1 break-words">{branchSummary}</p>
                </div>
              </div>
            </div>

            <div className="rounded-[var(--radius-card)] p-4" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-13 font-bold">{t("addEmployee.inheritedAccess")}</p>
                  <p className="text-10 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                    {t("addEmployee.inheritedFrom", { role: roleObj?.name ?? "—" })}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomizeOpen(true)}
                  disabled={roleAccess !== "ready"}
                  data-testid="add-employee-customize-access"
                  className="h-8 px-2.5 rounded-full text-10 font-bold shrink-0 disabled:opacity-45"
                  style={{ background: "var(--tone-sunken)", color: "var(--brand-dark)" }}
                >
                  {t("addEmployee.customizeAccess")}
                </button>
              </div>
              {roleAccess === "loading" ? (
                <SkeletonList rows={2} bare />
              ) : roleAccess === "error" ? (
                <p className="text-11 mt-2" style={{ color: "var(--error)" }}>{t("access.roleUnavailable")}</p>
              ) : (
                <>
                  {denied > 0 && (
                    <p className="text-10 mt-2" style={{ color: "var(--brand-dark)" }}>
                      {t("addEmployee.restrictedCount", { count: String(denied) })}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    <span className="text-9 font-semibold px-2 py-0.5 rounded-full" style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
                      {t("roles.permissionShort", { count: String(effectiveAccess.size) })}
                    </span>
                    {accessByModule.slice(0, 6).map(([module]) => (
                      <span key={module} className="text-9 px-2 py-0.5 rounded-full" style={{ background: "var(--tone-sunken)", color: "var(--text-secondary)" }}>
                        {areaLabel(module)}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            <DashboardEligibility permissions={effectiveAccess} compact testId="add-employee-widgets" />

            <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.inviteHint", { name: firstName })}</p>
          </>
        )}

        {error && <p className="text-11" style={{ color: "var(--error)" }} data-testid="add-employee-error">{error}</p>}
      </div>

      <div className="px-4 py-4 pb-6 flex items-center justify-end gap-4" style={{ borderTop: "1px solid var(--divider)" }}>
        {step === "review" ? (
          <Button
            className="min-w-[160px]"
            size="lg"
            variant="cta"
            onClick={() => void invite()}
            loading={loading}
            disabled={roleAccess !== "ready" || !roleId || !branchScope?.length}
            testId="add-employee-invite"
          >
            {loading ? t("addEmployee.inviting") : t("addEmployee.invite")}
          </Button>
        ) : (
          <Button className="min-w-[132px]" size="lg" variant="cta" onClick={next} testId="add-employee-next">
            {t("addEmployee.next")} <ForwardChevron size={16} className="ms-1" />
          </Button>
        )}
      </div>

      <Sheet
        open={salarySheetOpen}
        title={t("salary.sheetTitle")}
        onClose={() => setSalarySheetOpen(false)}
      >
        <div className="px-4 pb-4">
          <SalaryFields
            value={salaryDraft}
            onChange={setSalaryDraft}
            errors={salarySheetTouched ? validateSalaryDraft(salaryDraft) : {}}
          />
          <div className="flex gap-2 mt-4">
            <button
              type="button"
              onClick={() => setSalarySheetOpen(false)}
              className="flex-1 h-11 rounded-full text-12 font-semibold"
              style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
            >
              {t("common.cancel")}
            </button>
            <Button
              className="flex-1"
              variant="cta"
              onClick={saveSalaryDetails}
              testId="add-employee-salary-save"
            >
              {t("salary.save")}
            </Button>
          </div>
          <p className="text-10 mt-2" style={{ color: "var(--text-tertiary)" }}>
            {t("salary.addedToExpensesHint")}
          </p>
        </div>
      </Sheet>

      <Sheet
        open={customizeOpen}
        title={t("addEmployee.customizeFor", { name: firstName })}
        onClose={() => setCustomizeOpen(false)}
      >
        <div className="px-4 pb-4">
          <EmployeeAccessEditor
            roleDefaults={new Set(roleDefaults)}
            value={accessValue}
            onChange={setAccessValue}
            state={roleAccess === "ready" ? "ready" : roleAccess === "error" ? "error" : "loading"}
            restrictOnly
          />
          <div className="mt-3 pt-3 flex items-center justify-between gap-3" style={{ borderTop: "1px solid var(--divider)" }}>
            <span className="text-10" style={{ color: "var(--text-secondary)" }}>
              {denied > 0 ? t("addEmployee.restrictedCount", { count: String(denied) }) : t("addEmployee.roleDefaultAccess")}
            </span>
            <Button onClick={() => setCustomizeOpen(false)} testId="add-employee-customize-done">
              {t("common.close")}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}

function initialsOf(name: string): string {
  return name.split(" ").filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function firstWithName(name: string, fallback: string): string {
  const first = name.trim().split(" ")[0];
  return first || fallback;
}
