import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Check, ChevronLeft, ChevronRight, Search } from "lucide-react";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { supabase } from "@/lib/supabase";
import { getCurrentTenantId, isCurrentUserOwner } from "@/lib/tenantContext";
import { coOwnerErrorCode, coOwnerEnabled } from "@/lib/experience";
import { useT } from "@/lib/i18n";
import { navigateBack } from "@/lib/navContext";
import { useShellBase } from "@/lib/useShellBase";
import {
  useCoOwnersStore,
  type AuthorityMode,
  type CoOwnerDetail,
} from "@/stores/coOwnersStore";

type Mode = "all" | "selected" | "none";
type Step = "identity" | "scope" | "access" | "permissions" | "authority" | "dashboard" | "team" | "review";
type AccessTab = "screens" | "dashboard";

const STEPS: Step[] = ["identity", "scope", "permissions", "authority", "dashboard", "team", "review"];
// Branch Management already fixed the branch, so the full seven-step delegation wizard is
// unnecessarily long. This entry point asks only what it needs: the person, what they can open,
// the decisions that must stay with the Owner, and a final review.
const BRANCH_STEPS: Step[] = ["identity", "access", "authority", "review"];
const STEP_KEY: Record<Step, Parameters<ReturnType<typeof useT>>[0]> = {
  identity: "coOwners.stepIdentity",
  scope: "coOwners.stepScope",
  access: "coOwners.stepAccess",
  permissions: "coOwners.stepPermissions",
  authority: "coOwners.stepAuthority",
  dashboard: "coOwners.stepDashboard",
  team: "coOwners.stepTeam",
  review: "coOwners.stepReview",
};
const MODE_KEY: Record<Mode, Parameters<ReturnType<typeof useT>>[0]> = {
  all: "coOwners.branchModeAll",
  selected: "coOwners.branchModeSelected",
  none: "coOwners.branchModeNone",
};
const AUTHORITY_KEYS: Record<AuthorityMode, Parameters<ReturnType<typeof useT>>[0]> = {
  allowed: "coOwners.authorityAllowed",
  approval_required: "coOwners.authorityApproval",
  restricted: "coOwners.authorityRestricted",
};

// A Co-Owner is a trusted partner, not an employee. Everything is delegated by default except
// the decisions that define legal ownership and the Owner's own account.
const OWNER_ONLY_AUTHORITIES = new Set([
  "ownership.transfer",
  "co_owners.manage",
  "business.delete",
  "owner.security",
]);

interface BranchRow { id: string; name: string; is_default: boolean }
interface CompanyRow { id: string; name: string }
interface DepartmentRow { id: string; name_en: string; name_ur: string }
interface CustomerRow { id: string; name: string; phone: string | null }
interface PermissionRow { code: string; module: string; label_en: string }
interface WidgetRow { key: string; label_en: string; label_ur: string }
interface RoleRow { id: string; name: string }
interface AuthorityRow { code: string; module: string; label_en: string; label_ur: string }

function toggle(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function Choice({
  checked,
  label,
  hint,
  onClick,
  testId,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className="w-full flex items-start gap-3 px-3 py-3 text-start"
      style={{ borderBottom: "1px solid var(--divider)" }}
    >
      <span
        className="size-5 rounded-[6px] flex items-center justify-center shrink-0 mt-0.5"
        style={{
          border: `1.5px solid ${checked ? "var(--brand)" : "var(--border-control)"}`,
          background: checked ? "var(--brand)" : "transparent",
          color: "#0a0a0a",
        }}
      >
        {checked && <Check size={13} strokeWidth={3} />}
      </span>
      <span className="min-w-0">
        <span className="block text-13 font-medium">{label}</span>
        {hint && (
          <span className="block text-11 mt-0.5" style={{ color: "var(--text-secondary)" }}>
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}

function ModePicker({
  value,
  onChange,
  testId,
}: {
  value: Mode;
  onChange: (mode: Mode) => void;
  testId: string;
}) {
  const t = useT();
  const modes: Mode[] = ["all", "selected", "none"];
  return (
    <div className="flex gap-1.5" data-testid={testId}>
      {modes.map((mode) => {
        const on = value === mode;
        return (
          <button
            key={mode}
            type="button"
            onClick={() => onChange(mode)}
            className="h-8 px-3 rounded-full text-11 font-semibold"
            style={{
              background: on ? "var(--brand)" : "var(--field-bg)",
              color: on ? "#0a0a0a" : "var(--text-secondary)",
              border: `1px solid ${on ? "var(--brand)" : "var(--border-control)"}`,
            }}
          >
            {t(MODE_KEY[mode])}
          </button>
        );
      })}
    </div>
  );
}

export default function CoOwnerWizardPage() {
  const t = useT();
  const base = useShellBase();
  const navigate = useNavigate();
  const location = useLocation();
  const { grantId } = useParams<{ grantId?: string }>();
  const [searchParams] = useSearchParams();
  const branchFromQuery = searchParams.get("branchId");
  const editing = Boolean(grantId);
  const branchLocked = Boolean(branchFromQuery) && !editing;
  const owner = isCurrentUserOwner();
  const enabled = coOwnerEnabled();
  const { invite, update, get, assignBranchCoOwner } = useCoOwnersStore();

  const [step, setStep] = useState<Step>("identity");
  const [accessTab, setAccessTab] = useState<AccessTab>("screens");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState("");

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [status, setStatus] = useState("invited");

  const [branchMode, setBranchMode] = useState<Mode>("all");
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [supplierMode, setSupplierMode] = useState<Mode>("all");
  const [supplierIds, setSupplierIds] = useState<string[]>([]);
  const [departmentMode, setDepartmentMode] = useState<Mode>("all");
  const [departmentIds, setDepartmentIds] = useState<string[]>([]);
  const [recordMode, setRecordMode] = useState<Mode>("all");
  const [customerIds, setCustomerIds] = useState<string[]>([]);

  const [permissions, setPermissions] = useState<Set<string>>(new Set());
  const [authorities, setAuthorities] = useState<Record<string, AuthorityMode>>({});
  const [dashboards, setDashboards] = useState<Set<string>>(new Set());
  const [assignableRoles, setAssignableRoles] = useState<Set<string>>(new Set());
  const [canInviteEmployees, setCanInviteEmployees] = useState(true);
  const [canDeactivateEmployees, setCanDeactivateEmployees] = useState(true);
  const [canManageBranches, setCanManageBranches] = useState(true);

  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [departments, setDepartments] = useState<DepartmentRow[]>([]);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [permissionRows, setPermissionRows] = useState<PermissionRow[]>([]);
  const [widgets, setWidgets] = useState<WidgetRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [authorityRows, setAuthorityRows] = useState<AuthorityRow[]>([]);
  const [customerSearch, setCustomerSearch] = useState("");

  // Branch Management opens this same wizard with one branch already fixed. The scope step is
  // removed rather than shown as an editable choice, so the screen that assigns a branch cannot
  // quietly assign all of them. The server still writes the same Co-Owner grant as before.
  const steps = useMemo(
    () => (branchLocked ? BRANCH_STEPS : STEPS),
    [branchLocked],
  );
  const lockedBranch = branches.find((item) => item.id === branchFromQuery) ?? null;

  useEffect(() => {
    if (!owner || !enabled) {
      setLoading(false);
      return;
    }
    const tenantId = getCurrentTenantId();
    if (!tenantId) {
      setLoading(false);
      setError(t("coOwners.noBusiness"));
      return;
    }
    let alive = true;
    (async () => {
      const [b, c, d, cu, p, w, r, a] = await Promise.all([
        supabase.from("branches").select("id,name,is_default").eq("tenant_id", tenantId).eq("is_active", true).order("is_default", { ascending: false }),
        supabase.from("companies").select("id,name").eq("shop_id", tenantId).eq("is_active", true).order("name").limit(300),
        supabase.from("departments").select("id,name_en,name_ur").eq("tenant_id", tenantId).order("sort_order"),
        supabase.from("customers").select("id,name,phone").eq("shop_id", tenantId).eq("is_archived", false).order("name").limit(300),
        supabase.from("permissions").select("code,module,label_en").order("module").order("code"),
        supabase.from("dashboard_widgets").select("key,label_en,label_ur").order("sort_order"),
        supabase.from("roles").select("id,name").eq("tenant_id", tenantId).order("name"),
        supabase.from("co_owner_authority_catalog").select("code,module,label_en,label_ur").order("sort_order"),
      ]);
      if (!alive) return;
      const branchRows = (b.data ?? []) as BranchRow[];
      setBranches(branchRows);
      setCompanies((c.data ?? []) as CompanyRow[]);
      setDepartments((d.data ?? []) as DepartmentRow[]);
      setCustomers((cu.data ?? []) as CustomerRow[]);
      setPermissionRows((p.data ?? []) as PermissionRow[]);
      setWidgets((w.data ?? []) as WidgetRow[]);
      setRoles((r.data ?? []) as RoleRow[]);
      setAuthorityRows((a.data ?? []) as AuthorityRow[]);
      if (grantId) {
        try {
          const grant: CoOwnerDetail = await get(grantId);
          if (!alive) return;
          setName(grant.name);
          setPhone(grant.phone);
          setStatus(grant.status);
          setBranchMode((grant.scope?.branches_mode ?? "none") as Mode);
          setBranchIds(grant.branches.map((x) => x.id));
          setSupplierMode((grant.scope?.suppliers_mode ?? "none") as Mode);
          setSupplierIds(grant.supplierIds ?? []);
          setDepartmentMode((grant.scope?.departments_mode ?? "none") as Mode);
          setDepartmentIds(grant.departmentIds ?? []);
          setRecordMode((grant.scope?.records_mode ?? "none") as Mode);
          setCustomerIds(grant.customerIds ?? []);
          setPermissions(new Set(grant.permissions ?? []));
          setAuthorities(grant.authorities ?? {});
          setDashboards(new Set(grant.dashboards ?? []));
          setAssignableRoles(new Set(grant.assignableRoleIds ?? []));
          setCanInviteEmployees(Boolean(grant.canInviteEmployees));
          setCanDeactivateEmployees(Boolean(grant.canDeactivateEmployees));
          setCanManageBranches(Boolean(grant.canManageBranches));
        } catch (e) {
          if (alive) setError(coOwnerErrorCode(e));
        }
      } else {
        setPermissions(new Set((p.data ?? []).map((row) => row.code)));
        setDashboards(new Set((w.data ?? []).map((row) => row.key)));
        setAssignableRoles(new Set((r.data ?? []).map((row) => row.id)));
        const defaults: Record<string, AuthorityMode> = {};
        (a.data ?? []).forEach((row) => {
          const authority = row as AuthorityRow;
          defaults[authority.code] = OWNER_ONLY_AUTHORITIES.has(authority.code)
            ? "restricted"
            : "allowed";
        });
        setAuthorities(defaults);
      }
      if (branchLocked && branchFromQuery) {
        if (!branchRows.some((row) => row.id === branchFromQuery)) {
          if (alive) setError(t("coOwners.branchNotAvailable"));
        } else {
          setBranchMode("selected");
          setBranchIds([branchFromQuery]);
        }
      }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [owner, enabled, grantId, get, branchLocked, branchFromQuery]);

  const groupedPermissions = useMemo(() => {
    const map = new Map<string, PermissionRow[]>();
    permissionRows.forEach((row) => {
      const list = map.get(row.module) ?? [];
      list.push(row);
      map.set(row.module, list);
    });
    return [...map.entries()];
  }, [permissionRows]);

  const visibleCustomers = customers.filter((c) => {
    if (!customerSearch.trim()) return true;
    const q = customerSearch.trim().toLowerCase();
    return c.name.toLowerCase().includes(q) || (c.phone ?? "").includes(q);
  });

  const selectedBranchNames = branches.filter((b) => branchIds.includes(b.id)).map((b) => b.name);
  const selectedAuthoritySummary = authorityRows.filter((a) => (authorities[a.code] ?? "restricted") !== "restricted").length;

  if (!owner) {
    return (
      <div className="flex flex-col min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("coOwners.newTitle")} backTo={`${base}/settings/hub/people/co-owners`} />
        <p className="px-4 pt-6 text-13" style={{ color: "var(--text-secondary)" }}>{t("coOwners.notOwner")}</p>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="flex flex-col min-h-full" style={{ background: "var(--background)" }}>
        <StatusBar />
        <NavHeader title={t("coOwners.title")} backTo={`${base}/settings/hub/people`} />
        <p className="px-4 pt-6 text-13" style={{ color: "var(--text-secondary)" }}>{t("coOwners.featureOff")}</p>
      </div>
    );
  }

  function stepIndex() { return steps.indexOf(step); }
  function goNext() {
    setError("");
    if (step === "identity") {
      if (!editing && !/^\d{11}$/.test(phone)) { setError(t("coOwners.phoneInvalid")); return; }
      if (!editing && !name.trim()) { setError(t("coOwners.nameRequired")); return; }
    }
    if (step === "scope" && branchMode === "selected" && branchIds.length === 0) {
      setError(t("coOwners.noBranches"));
      return;
    }
    const index = stepIndex();
    if (index < steps.length - 1) setStep(steps[index + 1]);
  }
  function goBack() {
    const index = stepIndex();
    if (index <= 0) {
      navigateBack(location, navigate, branchLocked && branchFromQuery
        ? `${base}/settings/branches/${branchFromQuery}`
        : `${base}/settings/hub/people/co-owners`);
    } else setStep(steps[index - 1]);
  }

  async function save() {
    if (savingRef.current) return;
    if (branchMode === "selected" && branchIds.length === 0) {
      setError(t("coOwners.noBranches"));
      setStep("scope");
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError("");
    const scopes = {
      branchesMode: branchMode,
      branchIds,
      suppliersMode: supplierMode,
      supplierIds,
      departmentsMode: departmentMode,
      departmentIds,
      recordsMode: recordMode,
      customerIds,
      recordSupplierIds: [],
      brandsMode: "none" as const,
    };
    try {
      if (editing && grantId) {
        await update(grantId, {
          scopes,
          permissions: [...permissions],
          authorities,
          dashboards: [...dashboards],
          assignableRoleIds: [...assignableRoles],
          canInviteEmployees,
          canDeactivateEmployees,
          canManageBranches,
        });
      } else if (branchLocked && branchFromQuery) {
        await assignBranchCoOwner(branchFromQuery, name.trim(), phone.trim(), {
          permissions: [...permissions],
          authorities,
          dashboards: [...dashboards],
          assignableRoleIds: [...assignableRoles],
          canInviteEmployees,
          canDeactivateEmployees,
          // A branch Co-Owner runs their branch; branch creation, removal and ownership stay
          // with the Owner. The hidden defaults never grant more than the screen explains.
          canManageBranches: false,
        });
      } else {
        await invite({
          phone: phone.trim(),
          name: name.trim() || undefined,
          scopes,
          permissions: [...permissions],
          authorities,
          dashboards: [...dashboards],
          assignableRoleIds: [...assignableRoles],
          canInviteEmployees,
          canDeactivateEmployees,
          canManageBranches,
        });
      }
      navigate(branchLocked && branchFromQuery
        ? `${base}/settings/branches/${branchFromQuery}`
        : `${base}/settings/hub/people/co-owners`, { replace: true });
    } catch (e) {
      setError(`${t("coOwners.failed")} (${coOwnerErrorCode(e)})`);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  const inputStyle = {
    background: "var(--field-bg)",
    color: "var(--text-primary)",
    border: "1px solid var(--border-control)",
  } as const;
  const cardStyle = {
    background: "var(--tone-card)",
    border: "1px solid var(--border-control)",
  } as const;

  return (
    <div className="flex flex-col w-full min-h-full pb-8" style={{ background: "var(--background)", color: "var(--text-primary)" }} data-testid="co-owner-wizard">
      <StatusBar />
      <NavHeader
        title={editing
          ? t("coOwners.editTitle")
          : branchLocked
            ? t("coOwners.assignBranchTitle")
            : t("coOwners.newTitle")}
        backTo={branchLocked && branchFromQuery
          ? `${base}/settings/branches/${branchFromQuery}`
          : `${base}/settings/hub/people/co-owners`}
        onBack={goBack}
      />

      <div className="px-4 pt-1 flex items-center justify-between">
        <p className="text-11 tabular-nums" style={{ color: "var(--text-secondary)" }}>
          {stepIndex() + 1} / {steps.length}
        </p>
        <p className="text-11 font-semibold" style={{ color: "var(--brand-dark)" }}>
          {t(STEP_KEY[step])}
        </p>
      </div>

      <div className="px-4 pt-3">
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--tone-sunken)" }}>
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${((stepIndex() + 1) / steps.length) * 100}%`, background: "var(--brand)" }}
          />
        </div>
      </div>

      <div className="px-4 pt-4 flex flex-col gap-3">
        {loading ? (
          <p className="text-12 py-8 text-center" style={{ color: "var(--text-secondary)" }}>{t("common.loading")}</p>
        ) : (
          <>
            {step === "identity" && (
              <div className="rounded-[var(--radius-tile)] p-4 flex flex-col gap-3" style={cardStyle}>
                <label className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                  {t("coOwners.phone")}
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value.replace(/\D/g, "").slice(0, 11))}
                    disabled={editing}
                    inputMode="tel"
                    maxLength={11}
                    autoComplete="tel"
                    dir="ltr"
                    placeholder="03xx xxxxxxx"
                    className="mt-1.5 w-full h-12 rounded-[var(--radius-input)] px-3 text-14 outline-none disabled:opacity-60"
                    style={inputStyle}
                    data-testid="co-owner-phone"
                  />
                  <span className="block text-11 font-normal mt-1" style={{ color: "var(--text-tertiary)" }}>
                    {t("coOwners.phoneHint")}
                  </span>
                </label>
                <label className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>
                  {t("coOwners.name")}
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={editing}
                    dir="auto"
                    className="mt-1.5 w-full h-12 rounded-[var(--radius-input)] px-3 text-14 outline-none disabled:opacity-60"
                    style={inputStyle}
                    data-testid="co-owner-name"
                  />
                </label>
                {editing && (
                  <p className="text-11" style={{ color: "var(--text-secondary)" }}>
                    {t("coOwners.statusActive")}: {status}
                  </p>
                )}
                {branchLocked && (
                  <div
                    className="rounded-[var(--radius-tile)] p-3"
                    style={{ background: "var(--tone-sunken)", border: "1px solid var(--border-control)" }}
                  >
                    <p className="text-10 font-bold" style={{ color: "var(--text-secondary)" }}>
                      {t("coOwners.lockedBranch")}
                    </p>
                    <p className="text-13 font-bold mt-0.5">{lockedBranch?.name ?? t("common.loading")}</p>
                    <p className="text-10 mt-1" style={{ color: "var(--text-secondary)" }}>
                      {t("coOwners.lockedBranchBody")}
                    </p>
                  </div>
                )}
              </div>
            )}

            {step === "scope" && (
              <>
                <div className="rounded-[var(--radius-tile)] p-4" style={cardStyle}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-13 font-bold">{t("coOwners.branches")}</p>
                    <ModePicker value={branchMode} onChange={setBranchMode} testId="co-owner-branch-mode" />
                  </div>
                  {branchMode === "selected" && (
                    <div className="mt-3 rounded-[var(--radius-tile)] overflow-hidden" style={{ background: "var(--field-bg)" }}>
                      {branches.map((branch) => (
                        <Choice
                          key={branch.id}
                          checked={branchIds.includes(branch.id)}
                          label={branch.name}
                          hint={branch.is_default ? t("people.allBranches") : undefined}
                          onClick={() => setBranchIds((ids) => toggle(ids, branch.id))}
                          testId={`co-owner-branch-${branch.id}`}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-[var(--radius-tile)] p-4" style={cardStyle}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-13 font-bold">{t("coOwners.suppliers")}</p>
                    <ModePicker value={supplierMode} onChange={setSupplierMode} testId="co-owner-supplier-mode" />
                  </div>
                  {supplierMode === "selected" && (
                    <div className="mt-3 rounded-[var(--radius-tile)] overflow-hidden max-h-64 overflow-y-auto" style={{ background: "var(--field-bg)" }}>
                      {companies.map((company) => (
                        <Choice
                          key={company.id}
                          checked={supplierIds.includes(company.id)}
                          label={company.name}
                          onClick={() => setSupplierIds((ids) => toggle(ids, company.id))}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-[var(--radius-tile)] p-4" style={cardStyle}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-13 font-bold">{t("coOwners.departments")}</p>
                    <ModePicker value={departmentMode} onChange={setDepartmentMode} testId="co-owner-department-mode" />
                  </div>
                  {departmentMode === "selected" && (
                    <div className="mt-3 rounded-[var(--radius-tile)] overflow-hidden" style={{ background: "var(--field-bg)" }}>
                      {departments.map((department) => (
                        <Choice
                          key={department.id}
                          checked={departmentIds.includes(department.id)}
                          label={department.name_en}
                          hint={department.name_ur}
                          onClick={() => setDepartmentIds((ids) => toggle(ids, department.id))}
                        />
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-[var(--radius-tile)] p-4" style={cardStyle}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-13 font-bold">{t("coOwners.customers")}</p>
                    <ModePicker value={recordMode} onChange={setRecordMode} testId="co-owner-record-mode" />
                  </div>
                  {recordMode === "selected" && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 h-10 rounded-full px-3" style={{ background: "var(--field-bg)" }}>
                        <Search size={14} style={{ color: "var(--text-secondary)" }} />
                        <input
                          value={customerSearch}
                          onChange={(e) => setCustomerSearch(e.target.value)}
                          placeholder={t("people.searchPlaceholder")}
                          className="flex-1 min-w-0 bg-transparent outline-none text-12"
                          style={{ color: "var(--text-primary)" }}
                        />
                      </div>
                      <div className="mt-2 rounded-[var(--radius-tile)] overflow-hidden max-h-64 overflow-y-auto" style={{ background: "var(--field-bg)" }}>
                        {visibleCustomers.map((customer) => (
                          <Choice
                            key={customer.id}
                            checked={customerIds.includes(customer.id)}
                            label={customer.name}
                            hint={customer.phone ?? undefined}
                            onClick={() => setCustomerIds((ids) => toggle(ids, customer.id))}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                <p className="text-11" style={{ color: "var(--text-tertiary)" }}>{t("coOwners.scopeHint")}</p>
                <p className="text-11" style={{ color: "var(--text-tertiary)" }}>{t("coOwners.brandsUnsupported")}</p>
              </>
            )}

            {step === "access" && (
              <>
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("coOwners.accessHint")}</p>
                <div className="flex gap-1.5" data-testid="co-owner-access-tabs">
                  {(["screens", "dashboard"] as AccessTab[]).map((tab) => {
                    const on = accessTab === tab;
                    const count = tab === "screens" ? permissions.size : dashboards.size;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setAccessTab(tab)}
                        className="h-9 px-3 rounded-full text-11 font-semibold"
                        style={{
                          background: on ? "var(--brand)" : "var(--field-bg)",
                          color: on ? "#0a0a0a" : "var(--text-secondary)",
                          border: `1px solid ${on ? "var(--brand)" : "var(--border-control)"}`,
                        }}
                        data-testid={`co-owner-access-${tab}`}
                      >
                        {tab === "screens" ? t("coOwners.screens") : t("coOwners.stepDashboard")} · {count}
                      </button>
                    );
                  })}
                </div>
              </>
            )}

            {(step === "permissions" || (step === "access" && accessTab === "screens")) && (
              <>
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("coOwners.permissionsHint")}</p>
                {groupedPermissions.map(([module, rows]) => {
                  const all = rows.every((row) => permissions.has(row.code));
                  return (
                    <div key={module} className="rounded-[var(--radius-tile)] overflow-hidden" style={cardStyle}>
                      <div className="flex items-center justify-between px-3 py-2.5" style={{ borderBottom: "1px solid var(--divider)" }}>
                        <p className="text-12 font-bold capitalize">{module}</p>
                        <button
                          type="button"
                          className="text-10 font-bold"
                          style={{ color: "var(--brand-dark)" }}
                          onClick={() => {
                            setPermissions((current) => {
                              const next = new Set(current);
                              rows.forEach((row) => (all ? next.delete(row.code) : next.add(row.code)));
                              return next;
                            });
                          }}
                        >
                          {all ? t("roles.clearAll") : t("roles.selectAll")}
                        </button>
                      </div>
                      {rows.map((row) => (
                        <Choice
                          key={row.code}
                          checked={permissions.has(row.code)}
                          label={row.label_en}
                          hint={row.code}
                          onClick={() => {
                            setPermissions((current) => {
                              const next = new Set(current);
                              if (next.has(row.code)) next.delete(row.code);
                              else next.add(row.code);
                              return next;
                            });
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </>
            )}

            {step === "authority" && (
              <>
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("coOwners.authorityHint")}</p>
                {authorityRows.map((authority) => {
                  const mode = authorities[authority.code] ?? "restricted";
                  return (
                    <div key={authority.code} className="rounded-[var(--radius-tile)] p-3.5" style={cardStyle}>
                      <p className="text-13 font-bold">{authority.label_en}</p>
                      <p className="text-10 mt-0.5 mb-2.5" style={{ color: "var(--text-tertiary)" }}>{authority.module}</p>
                      <div className="flex gap-1.5 flex-wrap">
                        {(["allowed", "approval_required", "restricted"] as AuthorityMode[]).map((value) => {
                          const on = mode === value;
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => setAuthorities((current) => ({ ...current, [authority.code]: value }))}
                              className="h-8 px-3 rounded-full text-10 font-semibold"
                              style={{
                                background: on ? "var(--brand)" : "var(--field-bg)",
                                color: on ? "#0a0a0a" : "var(--text-secondary)",
                                border: `1px solid ${on ? "var(--brand)" : "var(--border-control)"}`,
                              }}
                            >
                              {t(AUTHORITY_KEYS[value])}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </>
            )}

            {(step === "dashboard" || (step === "access" && accessTab === "dashboard")) && (
              <>
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("coOwners.dashboardHint")}</p>
                <div className="rounded-[var(--radius-tile)] overflow-hidden" style={cardStyle}>
                  {widgets.map((widget) => (
                    <Choice
                      key={widget.key}
                      checked={dashboards.has(widget.key)}
                      label={widget.label_en}
                      hint={widget.key}
                      onClick={() => {
                        setDashboards((current) => {
                          const next = new Set(current);
                          if (next.has(widget.key)) next.delete(widget.key);
                          else next.add(widget.key);
                          return next;
                        });
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {step === "team" && (
              <>
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("coOwners.employeeHint")}</p>
                <div className="rounded-[var(--radius-tile)] overflow-hidden" style={cardStyle}>
                  <Choice checked={canInviteEmployees} label={t("coOwners.canInvite")} onClick={() => setCanInviteEmployees((v) => !v)} />
                  <Choice checked={canDeactivateEmployees} label={t("coOwners.canDeactivate")} onClick={() => setCanDeactivateEmployees((v) => !v)} />
                  <Choice checked={canManageBranches} label={t("coOwners.canManageBranches")} onClick={() => setCanManageBranches((v) => !v)} />
                </div>
                <p className="text-12 font-bold pt-2">{t("coOwners.assignableRoles")}</p>
                <div className="rounded-[var(--radius-tile)] overflow-hidden" style={cardStyle}>
                  {roles.map((role) => (
                    <Choice
                      key={role.id}
                      checked={assignableRoles.has(role.id)}
                      label={role.name}
                      onClick={() => {
                        setAssignableRoles((current) => {
                          const next = new Set(current);
                          if (next.has(role.id)) next.delete(role.id);
                          else next.add(role.id);
                          return next;
                        });
                      }}
                    />
                  ))}
                </div>
              </>
            )}

            {step === "review" && (
              <>
                <p className="text-11" style={{ color: "var(--text-secondary)" }}>{t("coOwners.reviewHint")}</p>
                <div className="rounded-[var(--radius-tile)] p-4 flex flex-col gap-3" style={cardStyle}>
                  <div>
                    <p className="text-14 font-bold">{name || phone}</p>
                    <p className="text-11" style={{ color: "var(--text-secondary)" }} dir="ltr">{phone}</p>
                  </div>
                  <div className="h-px" style={{ background: "var(--divider)" }} />
                  <div>
                    <p className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>{t("coOwners.branches")}</p>
                    <p className="text-13 mt-0.5">
                      {branchMode === "all"
                        ? t("coOwners.branchModeAll")
                        : branchMode === "none"
                          ? t("coOwners.branchModeNone")
                          : selectedBranchNames.join(" · ") || "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>{t("coOwners.permissions")}</p>
                    <p className="text-13 mt-0.5">{permissions.size}</p>
                  </div>
                  <div>
                    <p className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>{t("coOwners.stepAuthority")}</p>
                    <p className="text-13 mt-0.5">{selectedAuthoritySummary}</p>
                  </div>
                  <div>
                    <p className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>{t("coOwners.stepDashboard")}</p>
                    <p className="text-13 mt-0.5">{dashboards.size}</p>
                  </div>
                  {branchLocked ? (
                    <div>
                      <p className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>{t("coOwners.stepTeam")}</p>
                      <p className="text-13 mt-0.5">{t("coOwners.branchTeamDefaults")}</p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-11 font-semibold" style={{ color: "var(--text-secondary)" }}>{t("coOwners.assignableRoles")}</p>
                      <p className="text-13 mt-0.5">{assignableRoles.size}</p>
                    </div>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {error && (
          <p className="text-12" style={{ color: "var(--error)" }} role="alert" data-testid="co-owner-error">
            {error}
          </p>
        )}
      </div>

      <div className="px-4 pt-5 flex gap-2">
        <button
          type="button"
          onClick={goBack}
          className="h-11 px-4 rounded-full text-13 font-semibold"
          style={{ background: "var(--tone-sunken)", color: "var(--text-primary)" }}
        >
          <ChevronLeft size={15} className="inline" />
          {t("coOwners.back")}
        </button>
        {step !== "review" ? (
          <button
            type="button"
            onClick={goNext}
            className="flex-1 h-11 rounded-full text-13 font-bold flex items-center justify-center gap-1"
            style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
            data-testid="co-owner-next"
          >
            {t("coOwners.next")}
            <ChevronRight size={15} />
          </button>
        ) : (
          <button
            type="button"
            onClick={save}
            disabled={saving || loading}
            className="flex-1 h-11 rounded-full text-13 font-bold disabled:opacity-50"
            style={{ background: "var(--cta)", color: "var(--cta-fg)" }}
            data-testid="co-owner-save"
          >
            {saving ? t("coOwners.saving") : editing ? t("coOwners.save") : t("coOwners.invite")}
          </button>
        )}
      </div>
    </div>
  );
}
