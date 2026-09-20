import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useRolesStore } from "@/stores/rolesStore";
import { usePermissionsStore } from "@/stores/permissionsStore";
import { useT } from "@/lib/i18n";
import { usePermissionLabels } from "@/lib/permissionLabels";
import { useThemeStore } from "@/stores/themeStore";
import { normalizePhone } from "@/lib/auth";
import { clearNav } from "@/lib/navContext";
import { supabase } from "@/lib/supabase";
import { Check, ChevronRight, User, Shield, ClipboardCheck } from "lucide-react";
import type { MembershipRole } from "@/types";

/**
 * Add Employee — three decisions only:
 *   1. who they are      (name, phone, optional photo and job title)
 *   2. what they do      (role, and a branch only when there is a real choice)
 *   3. confirm
 *
 * Access is not a decision here: it comes from the selected role. The owner changes
 * individual access later from the employee's page, where "Customize access" lives.
 */
type Step = "who" | "job" | "review";

export default function AddEmployeePage() {
  const navigate = useNavigate();
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
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<MembershipRole>("employee");
  const [roleId, setRoleId] = useState<string | null>(null);
  const [selectedRolePermissions, setSelectedRolePermissions] = useState<string[]>([]);
  const [branchScope, setBranchScope] = useState<string[] | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    rolesStore.load();
    permissionsStore.load();
    supabase.from("branches").select("id, name, is_default").eq("is_active", true).then(({ data }) => {
      const b = (data as any[]) ?? [];
      setBranches(b);
      // One branch is not a decision — assign it.
      if (b.length === 1) setBranchScope([b[0].id]);
    });
  }, []);

  useEffect(() => {
    const firstRole = rolesStore.roles.find((r) => !r.isSystem) ?? rolesStore.roles[0];
    if (!roleId && firstRole) {
      setRoleId(firstRole.id);
      rolesStore.getRolePermissions(firstRole.id).then(setSelectedRolePermissions);
    }
  }, [rolesStore.roles.length]);

  const steps: { key: Step; label: string; icon: typeof User }[] = [
    { key: "who", label: t("addEmployee.stepWho"), icon: User },
    { key: "job", label: t("addEmployee.stepJob"), icon: Shield },
    { key: "review", label: t("addEmployee.stepReview"), icon: ClipboardCheck },
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
    if (step === "who") { if (!validateWho()) return; setStep("job"); return; }
    if (step === "job") { setStep("review"); return; }
  }

  function prevStep() {
    if (step === "job") setStep("who");
    else if (step === "review") setStep("job");
  }

  async function handleCreate() {
    setError("");
    setLoading(true);
    try {
      await createEmployee({
        name: name.trim(),
        phone: normalizePhone(phone),
        role: "employee", // Legacy field retained for compatibility
        membershipRole: role,
        roleId: roleId ?? undefined,
        photoUrl: photoUrl ?? undefined,
        branchScope: branchScope,
        createdBy: user?.id,
      });
      addToast(t("addEmployee.created", { name: name.trim() }), "success");
      clearNav();
      navigate("/admin/employees", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("addEmployee.errFailed"));
    } finally {
      setLoading(false);
    }
  }

  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--divider)",
    color: "var(--text-primary)",
  } as const;

  const roleObj = rolesStore.roles.find((r) => r.id === roleId);
  const branchNames = branchScope === null
    ? t("addEmployee.allBranches")
    : branches.filter((b) => branchScope.includes(b.id)).map((b) => b.name).join(", ") || t("addEmployee.allBranches");

  /** The selected role's access, grouped into business areas the owner recognises. */
  function accessByArea(): { label: string; actions: string[] }[] {
    const byModule = new Map<string, string[]>();
    for (const code of selectedRolePermissions) {
      const perm = permissionsStore.permissions.find((p) => p.code === code);
      const mod = perm?.module ?? code.split(".")[0];
      const action = perm?.action ?? code.split(".")[1] ?? "";
      byModule.set(mod, [...(byModule.get(mod) ?? []), actionLabel(action)]);
    }
    return [...byModule.entries()].map(([mod, actions]) => ({ label: areaLabel(mod), actions }));
  }

  const accessSummary = accessByArea().map((a) => a.label).join(", ");

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("addEmployee.title")} />

      {/* Step indicator */}
      <div className="flex items-center justify-center gap-1 px-4 pt-3">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1">
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold"
              style={{
                background: i <= currentStepIdx ? "var(--brand)" : "var(--surface-2)",
                color: i <= currentStepIdx ? "#0a0a0a" : "var(--text-secondary)",
                border: `1px solid ${i <= currentStepIdx ? "var(--brand)" : "var(--divider)"}`,
              }}
            >
              {i < currentStepIdx ? <Check size={12} /> : i + 1}
            </div>
            {i < steps.length - 1 && (
              <div className="w-6 h-0.5" style={{ background: i < currentStepIdx ? "var(--brand)" : "var(--divider)" }} />
            )}
          </div>
        ))}
      </div>

      <div className="flex-1 flex flex-col p-4 gap-4">
        {/* Step 1: who they are */}
        {step === "who" && (
          <>
            <div className="flex justify-center pt-1">
              <ImageUpload bucket="employee-photos" value={photoUrl} onChange={setPhotoUrl} shape="circle" label={t("addEmployee.addPhoto")} />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.name")} *
              </p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("addEmployee.nameHint")}
                className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
                style={fieldStyle}
                autoFocus
              />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.phone")} *
              </p>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="03001234567"
                className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
                style={fieldStyle}
              />
              <p className="text-[11px] mt-1" style={{ color: "var(--text-secondary)" }}>
                {t("addEmployee.phoneHint")}
              </p>
            </div>
          </>
        )}

        {/* Step 2: what they do, and where */}
        {step === "job" && (
          <>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              {t("addEmployee.roleQuestion", { name: firstName })}
            </p>
            <div className="flex flex-col gap-3">
              {rolesStore.roles.map((r) => {
                const selected = roleId === r.id;
                return (
                  <button
                    key={r.id}
                    onClick={() => {
                      setRoleId(r.id);
                      setRole(r.name.toLowerCase().includes("admin") ? "admin" : "employee");
                      rolesStore.getRolePermissions(r.id).then(setSelectedRolePermissions);
                    }}
                    className="flex items-start gap-3 p-4 rounded-[14px] text-start transition-colors"
                    style={{
                      background: "var(--surface)",
                      border: `1.5px solid ${selected ? "var(--brand)" : "var(--divider)"}`,
                    }}
                  >
                    <div
                      className="w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 mt-0.5"
                      style={{ borderColor: selected ? "var(--brand)" : "var(--text-secondary)" }}
                    >
                      {selected && <div className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--brand)" }} />}
                    </div>
                    <div>
                      <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{r.name}</p>
                      {r.description && (
                        <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{r.description}</p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Access this role gives — plain business areas, no permission codes */}
            {roleObj && (
              <div className="rounded-xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                <p className="text-[11px] font-bold uppercase tracking-wider mb-2" style={{ color: "var(--text-secondary)" }}>
                  {t("addEmployee.roleAccess")}
                </p>
                {accessByArea().length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.noRoleAccess")}</p>
                ) : (
                  accessByArea().map(({ label, actions }) => (
                    <div key={label} className="flex items-start justify-between gap-3 py-1">
                      <span className="text-xs font-semibold" style={{ color: "var(--text-primary)" }}>{label}</span>
                      <span className="text-xs text-end" style={{ color: "var(--text-secondary)" }}>{actions.join(", ")}</span>
                    </div>
                  ))
                )}
              </div>
            )}

            {/* Where they work — only a real choice when more than one branch exists */}
            {branches.length > 1 && (
              <>
                <p className="text-sm font-bold pt-1" style={{ color: "var(--text-primary)" }}>
                  {t("addEmployee.branchQuestion", { name: firstName })}
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => setBranchScope(null)}
                    className="flex items-center gap-3 p-4 rounded-[14px] text-start"
                    style={{
                      background: "var(--surface)",
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
                      className="flex items-center gap-3 p-4 rounded-[14px] text-start"
                      style={{
                        background: "var(--surface)",
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
                        {b.is_default && <p className="text-[10px]" style={{ color: "var(--brand)" }}>{t("addEmployee.mainBranch")}</p>}
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
            {branches.length === 1 && (
              <div className="rounded-xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                  {t("addEmployee.worksAt", { branch: branches[0].name })}
                </p>
              </div>
            )}
            {branches.length === 0 && (
              <div className="rounded-xl p-3" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.noBranches")}</p>
              </div>
            )}
          </>
        )}

        {/* Step 3: confirm */}
        {step === "review" && (
          <>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{t("addEmployee.reviewTitle")}</p>
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
              {[
                { label: t("addEmployee.labelName"), value: name },
                { label: t("addEmployee.labelPhone"), value: phone },
                { label: t("addEmployee.labelRole"), value: roleObj?.name ?? role },
                { label: t("addEmployee.labelBranch"), value: branchNames },
                { label: t("addEmployee.labelAccess"), value: accessSummary || t("addEmployee.noRoleAccess") },
              ].map(({ label, value }, i, arr) => (
                <div
                  key={label}
                  className="flex items-center justify-between px-4 py-3"
                  style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--divider)" : "none" }}
                >
                  <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</span>
                  <span className="text-sm font-semibold text-end max-w-[60%] truncate" style={{ color: "var(--text-primary)" }}>{value}</span>
                </div>
              ))}
            </div>
            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>{t("addEmployee.reviewHint")}</p>
          </>
        )}

        {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
      </div>

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
        {step === "review" ? (
          <button
            onClick={handleCreate}
            disabled={loading}
            className="flex-1 h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {loading ? t("addEmployee.creating") : t("addEmployee.create")}
          </button>
        ) : (
          <button
            onClick={nextStep}
            className="flex-1 h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {step === "who" ? t("addEmployee.next") : t("addEmployee.review")}
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
