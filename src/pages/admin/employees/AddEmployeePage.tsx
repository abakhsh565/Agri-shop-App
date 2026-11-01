import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ListCard from "@/components/ui/ListCard";
import ListRow from "@/components/ui/ListRow";
import ImageUpload from "@/components/ui/ImageUpload";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useRolesStore } from "@/stores/rolesStore";
import { digitsOnlyPhone, localPhone, phoneFieldProps } from "@/lib/phoneInput";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useT } from "@/lib/i18n";
import { branchKind } from "@/lib/branchKind";
import { usePermissionLabels } from "@/lib/permissionLabels";
import { applyOverrides, diffOverrides, overrideCount } from "@/lib/accessModel";
import EmployeeAccessEditor from "@/components/admin/EmployeeAccessEditor";
import InviteLinkCard from "@/components/admin/InviteLinkCard";
import { useThemeStore } from "@/stores/themeStore";
import { useShopStore } from "@/stores/shopStore";
import Sheet from "@/components/ui/Sheet";
import Button from "@/components/ui/Button";
import { normalizePhone } from "@/lib/auth";
import { clearNav } from "@/lib/navContext";
import { supabase } from "@/lib/supabase";
import { markEmployeeAccessRequestAdded } from "@/lib/employeeAccessRequests";
import { Check, CheckCircle2, ChevronRight, User, Shield, MapPin } from "lucide-react";
import { useShellBase } from "@/lib/useShellBase";
import { categoryLabelKey } from "@/lib/roleTemplates";

/**
 * Add Employee — three decisions, one on each step:
 *   1. who they are   (name, phone, optional photo)
 *   2. what they do   (role; the role carries the access)
 *   3. where they work, and confirmation
 *
 * Two things are deliberately NOT asked here:
 *   * individual permissions — they come from the role and are edited later, on
 *     the employee's page, where "Customize access" lives. Listing them twice
 *     (once as the role's access, once to confirm) made the owner read the same
 *     screen twice for no new information.
 *   * a membership role — it is an authorization input, so the database derives
 *     it from the caller's tenant. The screen cannot influence it.
 *
 * Adding somebody ISSUES AN INVITATION (see migration 0129): the membership is
 * pending until they sign in with their own phone number. The last step says
 * what happens next, and the flow ends on a confirmation that hands the owner
 * the invitation itself — the link and the share actions — because the employee
 * cannot sign in without it.
 */
type Step = "who" | "role" | "where" | "access";

export default function AddEmployeePage() {
  const navigate = useNavigate();
  const base = useShellBase();
  const teamBase = base === "/admin" ? `${base}/employees` : `${base}/team`;
  const [searchParams] = useSearchParams();
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const t = useT();
  const { areaLabel, actionLabel } = usePermissionLabels();
  const employees = useEmployeesStore((s) => s.employees);
  const createEmployee = useEmployeesStore((s) => s.createEmployee);
  const rolesStore = useRolesStore();
  const permissionsStore = usePermissionsStore();

  const [step, setStep] = useState<Step>("who");
  // Set when the invitation has actually been created: the flow then shows the
  // invitation instead of navigating away from it.
  const [sent, setSent] = useState<{ id: string | null; name: string; phone: string } | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  // An access request opens this screen with the requester already named and
  // numbered. The branch and the role are still the owner's decisions, so only
  // the two facts the employee supplied are prefilled.
  const [requestId, setRequestId] = useState<string | null>(searchParams.get("request"));
  const [name, setName] = useState(() => searchParams.get("name") ?? "");
  const [phone, setPhone] = useState(() => localPhone(searchParams.get("phone") ?? ""));
  const [jobTitle, setJobTitle] = useState("");
  const [roleId, setRoleId] = useState<string | null>(null);
  // A role per branch. The membership's roleId remains the default; this map is what
  // `create_employee_core` writes into membership_branch_roles in the same transaction.
  const [branchRoles, setBranchRoles] = useState<Record<string, string>>({});
  const [branchAccess, setBranchAccess] = useState<Record<string, {
    permissions: string[];
    dashboards: string[];
    loading: boolean;
    error: string | null;
  }>>({});
  // The selected role's reusable defaults.
  const [selectedRolePermissions, setSelectedRolePermissions] = useState<string[]>([]);
  // What this employee will actually have: the role's defaults with any exception
  // the owner adds below. Starts equal to the defaults, so "no customization" is
  // a state rather than something the owner has to re-enter.
  const [accessValue, setAccessValue] = useState<Set<string>>(new Set());
  // Whether the chosen role's access has actually arrived. Needed as a state of its own:
  // an unfetched role and a role that grants nothing both render as forty empty boxes, and
  // the owner has no way to tell those apart. Nothing ticked is a decision; nothing loaded is
  // not, so they cannot share one rendering.
  const [roleAccess, setRoleAccess] = useState<"idle" | "loading" | "ready" | "error">("idle");
  // `null` means every branch. Never an empty list: an empty scope is a member with nowhere to
  // work, and the database now refuses it (0171) rather than letting their records land branchless.
  // Which role's access sheet is open, if any. Separate from `roleId` (which role is CHOSEN): the
  // sheet can be open on the chosen role, and closing it must not change the choice.
  const [modifyRoleId, setModifyRoleId] = useState<string | null>(null);
  const [branchScope, setBranchScope] = useState<string[] | null>([]);
  const [branches, setBranches] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  // The branch the owner is working in *right now*.
  const activeBranchId = useShopStore((s) => s.activeBranchId);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const creatingRef = useRef(false);

  useEffect(() => {
    rolesStore.load();
    permissionsStore.load();
    supabase.from("branches").select("id, name, is_default").eq("is_active", true).then(({ data }) => {
      setBranches((data as any[]) ?? []);
    });
  }, []);

  /**
   * The default branch scope, applied as soon as BOTH halves of it exist.
   *
   * WHAT THE DEFAULT SHOULD BE, and why it is not "every branch". A shop with one branch has
   * nothing to decide. A shop with several does, and the safe answer is the branch the owner is
   * standing in: an employee silently given every branch sees every branch's customers and
   * takings, which is the exact mixing that is supposed to be impossible. Choosing the current
   * branch by default makes the owner's own working context the answer unless they deliberately
   * say otherwise — and widening it stays one tap away, because "All branches" is a choice they
   * can still make.
   *
   * WHY IT IS NOT PART OF THE LOAD ABOVE. It used to be, which made the default depend on the
   * branch context already being known when the LIST arrived. It is not: this screen is reached by
   * URL straight after sign-in, when `activeBranchId` is still null, so the default was never
   * applied and the scope stayed EMPTY — while the summary printed "All branches" for an empty
   * array, and `Send invitation` then refused with "Choose at least one branch" on a screen that
   * showed a branch. Measured 2026-10-14, in the browser: the refused invite is exactly how this
   * screen wasted the owner's time. It now waits for the context and applies the same rule.
   */
  const branchDefaultApplied = useRef(false);
  useEffect(() => {
    if (branchDefaultApplied.current || !branches.length || !activeBranchId) return;
    if (!branches.some((b) => b.id === activeBranchId)) return;
    branchDefaultApplied.current = true;
    // Only while nothing has been chosen: a deliberate choice is never overwritten by a default.
    setBranchScope((chosen) => (chosen && chosen.length ? chosen : [activeBranchId]));
  }, [branches, activeBranchId]);

  const steps: { key: Step; label: string; icon: typeof User }[] = [
    { key: "who", label: t("addEmployee.stepWho"), icon: User },
    { key: "role", label: t("addEmployee.stepRole"), icon: Shield },
    { key: "where", label: t("addEmployee.stepWhere"), icon: MapPin },
    { key: "access", label: t("addEmployee.stepAccess"), icon: Check },
  ];

  const currentStepIdx = steps.findIndex((s) => s.key === step);
  const firstName = name.trim().split(" ")[0] || "";

  function validateWho(): boolean {
    setError("");
    if (!name.trim()) { setError(t("addEmployee.errName")); return false; }
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setError(t("addEmployee.errPhone")); return false; }
    const normalized = normalizePhone(phone);
    if (employees.some((e) => normalizePhone(e.phone) === normalized)) {
      setError(t("addEmployee.errPhoneUsed"));
      return false;
    }
    return true;
  }

  function nextStep() {
    setError("");
    if (step === "who") { if (!validateWho()) return; setStep("role"); return; }
    if (step === "role") {
      if (!roleId) { setError(t("addEmployee.errRole")); return; }
      setStep("where");
      return;
    }
    if (step === "where") setStep("access");
  }

  /** Clear the form so the owner can add the next person without leaving. */
  function resetForm() {
    setSent(null);
    setStep("who");
    setRequestId(null);
    setName("");
    setPhone("");
    setJobTitle("");
    setPhotoUrl(null);
    setRoleId(null);
    setBranchRoles({});
    setBranchAccess({});
    setSelectedRolePermissions([]);
    setAccessValue(new Set());
    setRoleAccess("idle");
    setError("");
  }

  function prevStep() {
    setError("");
    if (step === "role") setStep("who");
    else if (step === "where") setStep("role");
    else if (step === "access") setStep("where");
  }

  // Every selected branch needs a role. A branch the owner has not explicitly changed
  // follows the role chosen in the previous step.
  useEffect(() => {
    if (!Array.isArray(branchScope) || branchScope.length === 0 || !roleId) return;
    setBranchRoles((prev) => {
      const next: Record<string, string> = {};
      for (const branch of branchScope) next[branch] = prev[branch] ?? roleId;
      return next;
    });
  }, [branchScope, roleId]);

  // The access review reads each distinct saved role once. It does not recompute or
  // expand the permission set; it shows what the role already grants.
  const branchRoleKey = Object.values(branchRoles).sort().join(",");
  useEffect(() => {
    const ids = [...new Set(Object.values(branchRoles))].filter(Boolean);
    if (ids.length === 0) return;
    let cancelled = false;
    setBranchAccess((prev) => {
      const next = { ...prev };
      for (const id of ids) {
        if (!next[id] || next[id].error) next[id] = { permissions: [], dashboards: [], loading: true, error: null };
      }
      return next;
    });
    for (const id of ids) {
      void rolesStore.loadRoleAccess(id).then((access) => {
        if (cancelled) return;
        setBranchAccess((prev) => ({
          ...prev,
          [id]: {
            permissions: access.permissions,
            dashboards: access.dashboards,
            loading: false,
            error: access.error,
          },
        }));
      });
    }
    return () => { cancelled = true; };
  }, [branchRoleKey]);

  async function handleCreate() {
    // A ref, not `loading`: React batches, so two taps in one task both read the
    // pre-render `false` and the owner ends up with TWO employees from one decision.
    // Held until the screen changes; released only when the attempt failed, which
    // keeps the button disabled while the invitation screen renders (as before).
    // Nobody assigned to no branch: an empty selection is not "all branches" (that is null) but
    // a member with nowhere to work — their records would be written without a branch and then be
    // invisible to every branch-limited reader, including them. Caught here as a sentence the
    // owner can act on, and again by the database (0171) for anything that is not this screen.
    if (!Array.isArray(branchScope) || branchScope.length === 0) {
      setError(t("addEmployee.errNoBranch"));
      return;
    }
    if (branchScope.some((branchId) => !branchRoles[branchId])) {
      setError(t("addEmployee.roleNotSelected"));
      return;
    }
    if (creatingRef.current) return;
    creatingRef.current = true;
    setError("");
    setLoading(true);
    try {
      const created = await createEmployee({
        name: name.trim(),
        phone: normalizePhone(phone),
        jobTitle: jobTitle.trim() || undefined,
        role: "employee", // Legacy field retained for compatibility
        roleId: roleId ?? undefined,
        branchRoles,
        // The employee's exceptions, written with the employee in one transaction:
        // creating them and then configuring them would leave a half-configured
        // person behind if the second call failed.
        overrides,
        photoUrl: photoUrl ?? undefined,
        branchScope: branchScope,
        createdBy: user?.id,
      });
      // The invitation is the access. Closing the request is bookkeeping after
      // it succeeded; a failure here must not turn a created employee into an
      // error the owner would retry. The request screen treats an existing
      // membership as already invited even while the row is still pending.
      if (requestId && created?.id) {
        void markEmployeeAccessRequestAdded(requestId, created.id);
        setRequestId(null);
      }
      addToast(t("addEmployee.created", { name: name.trim() }), "success");
      clearNav();
      // Show the invitation rather than leaving the screen: the link is the one
      // thing the owner must hand over, and it is only here that they have just
      // decided to add this person.
      setSent({ id: created?.id ?? null, name: name.trim(), phone: normalizePhone(phone) });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("addEmployee.errFailed"));
      setLoading(false);
      creatingRef.current = false;
    }
  }

  const fieldStyle = {
    background: "var(--field-bg)",
    color: "var(--text-primary)",
  } as const;

  const roleObj = rolesStore.roles.find((r) => r.id === roleId);
  const selectedBranches = branches.filter((b) => branchScope?.includes(b.id));
  const roleDefaultSet = new Set(selectedRolePermissions);
  const overrides = diffOverrides(accessValue, roleDefaultSet);
  const changeCount = overrideCount(overrides);
  // An EMPTY selection is not "All branches". It used to print as such — the fallback below fired
  // for an empty array as well as for `null` — so the summary promised the widest scope while the
  // submit refused it as "no branch at all". Only `null` means every branch.
  const branchNames = branchScope === null
    ? t("addEmployee.allBranches")
    : branches.filter((b) => branchScope.includes(b.id)).map((b) => b.name).join(", ") ||
      t("addEmployee.noBranchChosen");

  /**
   * The employee's access (role defaults with any exception applied), grouped into
   * the business areas the owner recognises. Reads the edit set, not the role's raw
   * defaults, so the summary can never disagree with what will be stored.
   */
  function accessByArea(): { label: string; actions: string[] }[] {
    const byModule = new Map<string, string[]>();
    for (const code of accessValue) {
      const perm = permissionsStore.permissions.find((p) => p.code === code);
      const mod = perm?.module ?? code.split(".")[0];
      const action = perm?.action ?? code.split(".")[1] ?? "";
      byModule.set(mod, [...(byModule.get(mod) ?? []), actionLabel(action)]);
    }
    return [...byModule.entries()].map(([mod, actions]) => ({ label: areaLabel(mod), actions }));
  }

  const accessSummary = accessByArea().map((a) => a.label).join(", ");

  /**
   * Choose a role and load what it grants. One function so the retry on a failed read is the
   * same call that failed — not a second, subtly different path.
   */
  async function selectRole(id: string) {
    setError("");
    setRoleId(id);
    setRoleAccess("loading");
    setSelectedRolePermissions([]);
    setAccessValue(new Set());
    const { codes, error: readError } = await rolesStore.loadRolePermissions(id);
    if (readError) {
      // Leave the fields untouched and say the read failed. Continuing with an empty set here
      // used to look like a role that grants nothing.
      setRoleAccess("error");
      return;
    }
    setSelectedRolePermissions(codes);
    // Choosing a role replaces the defaults; it does not touch the employee, who does not
    // exist yet.
    setAccessValue(applyOverrides(codes, {}));
    setRoleAccess("ready");
  }

  /**
   * The access sheet for one role.
   *
   * Opened by `Modify`, and it SELECTS the role first when it was not the chosen one: an owner
   * who opens "Modify" on a role they have not picked is editing this employee's access under that
   * role, and the flow should then say which role it is talking about.
   */
  async function openModify(id: string) {
    if (roleId !== id) await selectRole(id);
    setModifyRoleId(id);
  }

  /**
   * One role card: choosing it, and — separately — changing what it carries.
   *
   * WHY THE TWO ARE SEPARATE ACTIONS. Tapping a role used to expand forty checkboxes inside the
   * card, so the act of CHOOSING a role was inseparable from the act of EDITING its access: every
   * owner who simply wanted "Store Manager" was shown a wall of boxes they had not asked for, and
   * the only thing the tap was supposed to mean got lost in it.
   *
   * Now the card chooses, and the small `Modify` in its corner opens the access list. That is also
   * what makes the choice legible: what you have picked is a name, and what it grants is one tap
   * away rather than in your face.
   */
  function roleCard(r: (typeof rolesStore.roles)[number]) {
    const selected = roleId === r.id;
    return (
      <div
        key={r.id}
        className="flex items-center gap-3 p-4 rounded-[var(--radius-card)] transition-colors"
        style={{
          background: selected ? "var(--brand-light)" : "var(--surface)",
          border: `1.5px solid ${selected ? "var(--brand)" : "var(--divider)"}`,
        }}
      >
        <button
          onClick={() => void selectRole(r.id)}
          className="flex items-start gap-3 text-start flex-1 min-w-0"
        >
          <div
            className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5"
            style={{ borderColor: selected ? "var(--brand)" : "var(--text-secondary)" }}
          >
            {selected && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--brand)" }} />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{r.name}</p>
            {r.description && (
              <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{r.description}</p>
            )}
            {/* What the owner changed, said on the card that carries it — so a customized role is
                recognisable without opening it again. */}
            {selected && roleAccess === "ready" && changeCount > 0 && (
              <p className="text-11 mt-1" style={{ color: "var(--text-primary)" }}>
                {t(changeCount === 1 ? "addEmployee.customizedOne" : "addEmployee.customized", {
                  count: changeCount,
                  role: r.name,
                })}
              </p>
            )}
          </div>
        </button>

        <button
          type="button"
          onClick={() => void openModify(r.id)}
          data-testid={`role-modify-${r.id}`}
          className="shrink-0 h-8 px-3 rounded-full text-12 font-bold ds-pressable"
          style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
        >
          {t("addEmployee.modifyRole")}
        </button>
      </div>
    );
  }

  // Confirmation: the invitation exists now, so what follows is handing it over.
  if (sent) {
    return (
      <div
        className="roles-neutral flex flex-col w-full min-h-full"
        style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
      >
        <StatusBar />
        <NavHeader title={t("addEmployee.title")} />

        <div className="flex-1 flex flex-col gap-4 p-4 animate-fade-in-up">
          <div className="flex flex-col items-center text-center gap-2 pt-4 pb-2">
            <CheckCircle2 size={40} style={{ color: "var(--brand-dark)" }} />
            <p className="text-lg font-bold" style={{ color: "var(--text-primary)" }} data-testid="invite-sent-title">
              {t("addEmployee.created", { name: sent.name })}
            </p>
            <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {t("addEmployee.sentNext", { name: firstName })}
            </p>
          </div>

          <InviteLinkCard name={sent.name} phone={sent.phone} />
        </div>

        <div className="p-4 pb-6 flex gap-3">
          <button
            onClick={resetForm}
            className="h-12 px-6 rounded-full font-bold text-sm"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            {t("addEmployee.addAnother")}
          </button>
          <button
            onClick={() => navigate(sent.id ? `${teamBase}/${sent.id}` : teamBase, { replace: true })}
            className="flex-1 h-12 rounded-full font-bold text-sm"
            style={{ background: "var(--brand)", color: "var(--brand-fg)" }}
            data-testid="invite-open-employee"
          >
            {t("addEmployee.openEmployee", { name: firstName })}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="roles-neutral flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("addEmployee.title")} />

      {/* Step indicator — named, so the owner can see the whole journey up front */}
      <div className="flex items-start justify-center gap-1 px-4 pt-3">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-start gap-1">
            <div className="flex flex-col items-center gap-1" style={{ width: 64 }}>
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-10 font-bold"
                style={{
                  background: i <= currentStepIdx ? "var(--brand)" : "var(--surface-2)",
                  color: i <= currentStepIdx ? "var(--brand-fg)" : "var(--text-secondary)",
                  border: `1px solid ${i <= currentStepIdx ? "var(--brand)" : "var(--divider)"}`,
                }}
              >
                {i < currentStepIdx ? <Check size={12} /> : i + 1}
              </div>
              <span
                className="text-9 text-center leading-tight truncate w-full"
                style={{ color: i === currentStepIdx ? "var(--text-primary)" : "var(--text-secondary)" }}
              >
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div className="w-5 h-0.5 mt-3.5" style={{ background: i < currentStepIdx ? "var(--brand)" : "var(--divider)" }} />
            )}
          </div>
        ))}
      </div>

      <div className="flex-1 flex flex-col p-4 gap-4">
        {/* Step 1: who they are — the required fields come first. */}
        {step === "who" && (
          <>
            <div>
              <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.name")} *
              </p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("addEmployee.nameHint")}
                className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                style={fieldStyle}
                autoFocus
              />
            </div>
            <div>
              <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.phone")} *
              </p>
              <input
                {...phoneFieldProps()}
                value={phone}
                onChange={(e) => setPhone(digitsOnlyPhone(e.target.value))}
                placeholder="03001234567"
                className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                style={fieldStyle}
              />
              <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.phoneHint")}
              </p>
            </div>
            <div>
              <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.jobTitle")}
              </p>
              <input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder={t("addEmployee.jobTitleHint")}
                dir="auto"
                className="w-full h-12 rounded-[var(--radius-input)] px-4 text-sm outline-none"
                style={fieldStyle}
              />
            </div>
            <div className="pt-1">
              <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.photoOptional")}
              </p>
              <div className="flex justify-center">
                <ImageUpload bucket="employee-photos" value={photoUrl} onChange={setPhotoUrl} shape="circle" label={t("addEmployee.addPhoto")} />
              </div>
            </div>
          </>
        )}

        {/* Step 2: what they do — one decision, and the access it carries. */}
        {step === "role" && (
          <>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {t("addEmployee.roleQuestion", { name: firstName })}
            </p>
            <div className="flex flex-col gap-3">
              {rolesStore.roles.map(roleCard)}
            </div>
            {!roleId && (
              <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.roleRequired")}
              </p>
            )}
          </>
        )}

        {/* Step 3: where they work, then confirm. */}
        {step === "where" && (
          <>
            {branches.length > 1 && (
              <>
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {t("addEmployee.branchQuestion", { name: firstName })}
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setBranchScope(branches.map((b) => b.id))}
                    className="flex items-center gap-3 p-4 rounded-[var(--radius-card)] text-start"
                    style={{
                      background: branchScope === null ? "var(--brand-light)" : "var(--surface)",
                      border: `1.5px solid ${branchScope === null ? "var(--brand)" : "var(--divider)"}`,
                    }}
                  >
                    <div
                      className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                      style={{ borderColor: branchScope === null ? "var(--brand)" : "var(--text-secondary)" }}
                    >
                      {branchScope === null && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--brand)" }} />}
                    </div>
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t("addEmployee.allBranches")}</p>
                  </button>
                  {branches.map((b) => (
                    <button
                      key={b.id}
                      onClick={() => {
                        setBranchScope((prev) => {
                          if (!prev) return [b.id];
                          if (prev.includes(b.id)) return prev.filter((id) => id !== b.id);
                          return [...prev, b.id];
                        });
                      }}
                      className="flex items-center gap-3 p-4 rounded-[var(--radius-card)] text-start"
                      style={{
                        background: branchScope?.includes(b.id) ? "var(--brand-light)" : "var(--surface)",
                        border: `1.5px solid ${branchScope?.includes(b.id) ? "var(--brand)" : "var(--divider)"}`,
                      }}
                    >
                      <div
                        className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0"
                        style={{ borderColor: branchScope?.includes(b.id) ? "var(--brand)" : "var(--text-secondary)" }}
                      >
                        {branchScope?.includes(b.id) && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--brand)" }} />}
                      </div>
                      <div>
                        <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{b.name}</p>
                        {/* Every branch says which kind it is, not only the main one: a sub-branch
                            starts empty, and the person choosing scope should see that. */}
                        <p className="text-10" style={{ color: b.is_default ? "var(--brand-dark)" : "var(--text-secondary)" }}>
                          {branchKind(t, b.is_default)}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
            {branches.length === 1 && (
              <div className="rounded-[var(--radius-tile)] p-3" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {t("addEmployee.worksAt", { branch: branches[0].name })}
                </p>
              </div>
            )}
            {branches.length === 0 && (
              <div className="rounded-[var(--radius-tile)] p-3" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.noBranches")}</p>
              </div>
            )}

            {selectedBranches.length > 0 && (
              <div className="pt-2">
                <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                  {t("addEmployee.branchRoleQuestion")}
                </p>
                <p className="text-11 mt-0.5 mb-2" style={{ color: "var(--text-secondary)" }}>
                  {t("addEmployee.branchRoleHint")}
                </p>
                <div className="flex flex-col gap-2">
                  {selectedBranches.map((branch) => (
                    <div
                      key={branch.id}
                      className="rounded-[var(--radius-tile)] p-3"
                      style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
                    >
                      <p className="text-12 font-semibold" style={{ color: "var(--text-primary)" }}>{branch.name}</p>
                      <select
                        value={branchRoles[branch.id] ?? ""}
                        onChange={(e) =>
                          setBranchRoles((prev) => ({ ...prev, [branch.id]: e.target.value }))
                        }
                        className="mt-2 w-full h-10 rounded-[var(--radius-input)] px-3 text-12 outline-none"
                        style={fieldStyle}
                        aria-label={`${t("addEmployee.stepRole")} — ${branch.name}`}
                      >
                        <option value="">{t("addEmployee.roleNotSelected")}</option>
                        {rolesStore.roles.map((r) => (
                          <option key={r.id} value={r.id}>{r.name}</option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <p className="text-sm font-bold pt-1" style={{ color: "var(--text-primary)" }}>{t("addEmployee.reviewTitle")}</p>
            <ListCard>
              {[
                { label: t("addEmployee.labelName"), value: name },
                { label: t("addEmployee.labelPhone"), value: phone },
                { label: t("addEmployee.jobTitle"), value: jobTitle || "—" },
                { label: t("addEmployee.labelRole"), value: roleObj?.name ?? "—" },
                { label: t("addEmployee.labelBranch"), value: branchNames },
                { label: t("addEmployee.labelAccess"), value: accessSummary || t("addEmployee.noRoleAccess") },
              ].map(({ label, value }) => (
                <ListRow
                  key={label}
                  trailing={<span className="text-sm font-semibold text-end max-w-[60%] break-words" style={{ color: "var(--text-primary)" }}>{value}</span>}
                >
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</span>
                </ListRow>
              ))}
            </ListCard>
            {changeCount > 0 && (
              <p className="text-11 font-semibold" style={{ color: "var(--brand-dark)" }}>
                {t("addEmployee.customized", { count: changeCount, role: roleObj?.name ?? "" })}
              </p>
            )}
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {t("addEmployee.inviteHint", { name: firstName })}
            </p>
          </>
        )}

        {/* Step 4: review the saved access that each branch will carry, then invite. */}
        {step === "access" && (
          <>
            <div>
              <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
                {t("addEmployee.accessReviewTitle")}
              </p>
              <p className="text-11 mt-1" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.accessReviewHint", { name: firstName || t("addEmployee.stepWho") })}
              </p>
            </div>
            <div className="flex flex-col gap-2">
              {selectedBranches.map((branch) => {
                const assigned = rolesStore.roles.find((r) => r.id === branchRoles[branch.id]);
                const access = branchRoles[branch.id] ? branchAccess[branchRoles[branch.id]] : undefined;
                return (
                  <div
                    key={branch.id}
                    className="rounded-[var(--radius-card)] p-4"
                    style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-13 font-bold" style={{ color: "var(--text-primary)" }}>{branch.name}</p>
                        <p className="text-12 mt-0.5" style={{ color: "var(--text-secondary)" }}>
                          {assigned?.name ?? t("addEmployee.roleNotSelected")}
                        </p>
                        {assigned && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            <span className="text-10 px-2 py-0.5 rounded-full" style={{ background: "var(--brand-light)", color: "var(--brand-dark)" }}>
                              {t(categoryLabelKey(assigned.roleCategory))}
                            </span>
                            {assigned.departmentName && (
                              <span className="text-10 px-2 py-0.5 rounded-full" style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}>
                                {assigned.departmentName}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <Shield size={17} style={{ color: "var(--brand-dark)" }} />
                    </div>
                    {access?.loading && (
                      <p className="text-11 mt-2" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.accessLoading")}</p>
                    )}
                    {access?.error && (
                      <p className="text-11 mt-2" style={{ color: "var(--error)" }}>{t("access.roleUnavailable")}</p>
                    )}
                    {access && !access.loading && !access.error && (
                      <div className="flex gap-4 mt-2 text-11" style={{ color: "var(--text-secondary)" }}>
                        <span>{t("addEmployee.effectivePermissions", { count: access.permissions.length })}</span>
                        <span>{t("addEmployee.visibleWidgets", { count: access.dashboards.length })}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {changeCount > 0 && (
              <p className="text-11 font-semibold" style={{ color: "var(--brand-dark)" }}>
                {t("addEmployee.customized", { count: changeCount, role: roleObj?.name ?? "" })}
              </p>
            )}
            <p className="text-sm font-bold pt-1" style={{ color: "var(--text-primary)" }}>{t("addEmployee.reviewTitle")}</p>
            <ListCard>
              {[
                { label: t("addEmployee.labelName"), value: name },
                { label: t("addEmployee.labelPhone"), value: phone },
                { label: t("addEmployee.jobTitle"), value: jobTitle || "—" },
                { label: t("addEmployee.branchAssignment"), value: selectedBranches.map((b) => `${b.name}: ${rolesStore.roles.find((r) => r.id === branchRoles[b.id])?.name ?? t("addEmployee.roleNotSelected")}`).join(" · ") },
              ].map(({ label, value }) => (
                <ListRow
                  key={label}
                  trailing={<span className="text-sm font-semibold text-end max-w-[60%] break-words" style={{ color: "var(--text-primary)" }}>{value}</span>}
                >
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</span>
                </ListRow>
              ))}
            </ListCard>
            <p className="text-11" style={{ color: "var(--text-secondary)" }}>
              {t("addEmployee.accessReviewFooter")} {t("addEmployee.inviteHint", { name: firstName })}
            </p>
          </>
        )}

        {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
      </div>

      {/*
        The access sheet — the multi-select the owner asked to reach through `Modify`.

        It opens on the role named in its title, and above the checklist sits the line that says
        what the list is for (`access.subheading`), because “which of these forty boxes should be
        ticked” is the question this screen exists to answer. Nothing here is written until the
        employee is invited, so Cancel is a real cancel.
      */}
      <Sheet
        open={modifyRoleId !== null}
        title={rolesStore.roles.find((r) => r.id === modifyRoleId)?.name ?? t("addEmployee.stepRole")}
        onClose={() => setModifyRoleId(null)}
      >
        <div className="px-4 pb-4">
          <p className="ds-section-label mb-2" style={{ color: "var(--text-secondary)" }}>
            {t("addEmployee.effectiveAccess", { name: firstName || t("addEmployee.stepWho") })}
          </p>
          <EmployeeAccessEditor
            roleDefaults={roleDefaultSet}
            value={accessValue}
            onChange={setAccessValue}
            state={roleAccess === "ready" ? "ready" : roleAccess === "error" ? "error" : "loading"}
          />
          {roleAccess === "error" && (
            <button
              onClick={() => modifyRoleId && void selectRole(modifyRoleId)}
              className="text-11 font-bold mt-2"
              style={{ color: "var(--brand-dark)" }}
            >
              {t("common.retry")}
            </button>
          )}
          {roleAccess === "ready" && (
            <div className="mt-3 pt-3" style={{ borderTop: "1px solid var(--divider)" }}>
              <span className="text-10" style={{ color: "var(--text-secondary)" }}>
                {changeCount > 0
                  ? t(changeCount === 1 ? "addEmployee.customizedOne" : "addEmployee.customized", {
                      count: changeCount,
                      role: rolesStore.roles.find((r) => r.id === modifyRoleId)?.name ?? "",
                    })
                  : t("addEmployee.roleAccessDefault")}
              </span>
            </div>
          )}
          <Button fullWidth className="mt-3" onClick={() => setModifyRoleId(null)} testId="role-modify-done">
            {t("common.close")}
          </Button>
        </div>
      </Sheet>

      {/* Bottom buttons */}
      <div className="p-4 pb-6 flex gap-3">
        {step !== "who" && (
          <button
            onClick={prevStep}
            className="h-12 px-6 rounded-full font-bold text-sm"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            {t("addEmployee.back")}
          </button>
        )}
        {step === "access" ? (
          <button
            onClick={handleCreate}
            disabled={loading}
            className="flex-1 h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: "var(--brand)", color: "var(--brand-fg)" }}
          >
            {loading ? t("addEmployee.inviting") : t("addEmployee.invite")}
          </button>
        ) : (
          <button
            onClick={nextStep}
            disabled={
              (step === "role" && !roleId) ||
              (step === "where" && (
                selectedBranches.length === 0 ||
                selectedBranches.some((branch) => !branchRoles[branch.id])
              ))
            }
            className="flex-1 h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
            style={{ background: "var(--brand)", color: "var(--brand-fg)" }}
          >
            {t("addEmployee.next")}
            <ChevronRight size={16} className={isUrdu ? "rotate-180" : ""} />
          </button>
        )}
      </div>
    </div>
  );
}
