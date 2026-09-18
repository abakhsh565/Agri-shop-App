import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import ImageUpload from "@/components/ui/ImageUpload";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { useThemeStore } from "@/stores/themeStore";
import { normalizePhone } from "@/lib/auth";
import { clearNav } from "@/lib/navContext";
import { supabase } from "@/lib/supabase";
import { Check, ChevronRight, User, Shield, Building2, ClipboardCheck } from "lucide-react";
import type { MembershipRole } from "@/types";

const ROLES: { value: MembershipRole; label: string; description: string; defaultPerms: string }[] = [
  { value: "employee", label: "Employee", description: "Shop floor access — sales, customers, products", defaultPerms: "6 default permissions (sales, customers, products, inventory view)" },
  { value: "admin", label: "Admin", description: "Full management access including reports", defaultPerms: "30 permissions (all except employee management & settings)" },
];

type Step = "info" | "role" | "branch" | "review";

export default function AddEmployeePage() {
  const navigate = useNavigate();
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const employees = useEmployeesStore((s) => s.employees);
  const createEmployee = useEmployeesStore((s) => s.createEmployee);

  const [step, setStep] = useState<Step>("info");
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [role, setRole] = useState<MembershipRole>("employee");
  const [branchScope, setBranchScope] = useState<string[] | null>(null);
  const [branches, setBranches] = useState<{ id: string; name: string; is_default: boolean }[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    supabase.from("branches").select("id, name, is_default").eq("is_active", true).then(({ data }) => {
      const b = (data as any[]) ?? [];
      setBranches(b);
      // Auto-assign if only one branch
      if (b.length === 1) setBranchScope([b[0].id]);
    });
  }, []);

  const steps: { key: Step; label: string; icon: typeof User }[] = [
    { key: "info", label: "Info", icon: User },
    { key: "role", label: "Role", icon: Shield },
    { key: "branch", label: "Branch", icon: Building2 },
    { key: "review", label: "Review", icon: ClipboardCheck },
  ];

  const currentStepIdx = steps.findIndex((s) => s.key === step);

  function validateInfo(): boolean {
    setError("");
    if (!name.trim()) { setError("Enter the employee's name."); return false; }
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setError("Enter a valid phone number."); return false; }
    const normalized = normalizePhone(phone);
    if (employees.some((e) => normalizePhone(e.phone) === normalized)) {
      setError("An employee with this phone number already exists.");
      return false;
    }
    return true;
  }

  function nextStep() {
    if (step === "info") { if (!validateInfo()) return; setStep("role"); return; }
    if (step === "role") { setStep("branch"); return; }
    if (step === "branch") { setStep("review"); return; }
  }

  function prevStep() {
    if (step === "role") setStep("info");
    else if (step === "branch") setStep("role");
    else if (step === "review") setStep("branch");
  }

  async function handleCreate() {
    setError("");
    setLoading(true);
    try {
      await createEmployee({
        name: name.trim(),
        phone: normalizePhone(phone),
        role: "employee", // Legacy field, ignored by RPC
        membershipRole: role,
        jobTitle: jobTitle.trim() || undefined,
        photoUrl: photoUrl ?? undefined,
        branchScope: branchScope,
        createdBy: user?.id,
      });
      addToast(`${name.trim()} added. They can sign in with their phone number.`, "success");
      clearNav();
      navigate("/admin/employees", { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add employee.");
    } finally {
      setLoading(false);
    }
  }

  const fieldStyle = {
    background: "var(--surface-2)",
    border: "1px solid var(--divider)",
    color: "var(--text-primary)",
  } as const;

  const roleObj = ROLES.find((r) => r.value === role);
  const branchNames = branchScope === null
    ? "All branches"
    : branches.filter((b) => branchScope.includes(b.id)).map((b) => b.name).join(", ") || "All branches";

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title="Add Employee" />

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
        {/* Step 1: Basic Info */}
        {step === "info" && (
          <>
            <div className="flex justify-center pt-1">
              <ImageUpload bucket="employee-photos" value={photoUrl} onChange={setPhotoUrl} shape="circle" label="Add photo" />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
                Full Name *
              </p>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Bilal Ahmed"
                className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
                style={fieldStyle}
                autoFocus
              />
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
                Phone Number *
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
                They sign in with this number via one-time code.
              </p>
            </div>
            <div>
              <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
                Job Title <span style={{ opacity: 0.6 }}>(optional)</span>
              </p>
              <input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. Sales Associate"
                className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
                style={fieldStyle}
              />
            </div>
          </>
        )}

        {/* Step 2: Role Selection */}
        {step === "role" && (
          <>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              What access level should {name.split(" ")[0]} have?
            </p>
            <div className="flex flex-col gap-3">
              {ROLES.map((r) => {
                const selected = role === r.value;
                return (
                  <button
                    key={r.value}
                    onClick={() => setRole(r.value)}
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
                      <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>{r.label}</p>
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{r.description}</p>
                      <p className="text-[10px] mt-1" style={{ color: "var(--brand)" }}>{r.defaultPerms}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Step 3: Branch Selection */}
        {step === "branch" && (
          <>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Which branch(es) can {name.split(" ")[0]} access?
            </p>
            {branches.length <= 1 ? (
              <div className="p-4 rounded-xl" style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}>
                <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
                  {branches.length === 1 ? `Auto-assigned to: ${branches[0].name}` : "No branches configured yet."}
                </p>
              </div>
            ) : (
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
                  <div>
                    <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>All Branches</p>
                    <p className="text-xs" style={{ color: "var(--text-secondary)" }}>Access all branches</p>
                  </div>
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
                      {b.is_default && <p className="text-[10px]" style={{ color: "var(--brand)" }}>Main branch</p>}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* Step 4: Review */}
        {step === "review" && (
          <>
            <p className="text-sm font-bold" style={{ color: "var(--text-primary)" }}>
              Review before creating
            </p>
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-light)" }}>
              {[
                { label: "Name", value: name },
                { label: "Phone", value: phone },
                { label: "Job Title", value: jobTitle || "—" },
                { label: "Role", value: roleObj?.label ?? role },
                { label: "Branch", value: branchNames },
                { label: "Access", value: roleObj?.defaultPerms ?? "" },
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
            <p className="text-[11px]" style={{ color: "var(--text-secondary)" }}>
              They can sign in immediately with their phone number. You can change their role, permissions, and branch access anytime from Employee Detail.
            </p>
          </>
        )}

        {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
      </div>

      {/* Bottom buttons */}
      <div className="p-4 pb-6 flex gap-3">
        {step !== "info" && (
          <button
            onClick={prevStep}
            className="h-12 px-6 rounded-full font-bold text-sm"
            style={{ background: "var(--surface-2)", border: "1px solid var(--divider)", color: "var(--text-primary)" }}
          >
            Back
          </button>
        )}
        {step === "review" ? (
          <button
            onClick={handleCreate}
            disabled={loading}
            className="flex-1 h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {loading ? "Creating…" : "Create Employee"}
          </button>
        ) : (
          <button
            onClick={nextStep}
            className="flex-1 h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {step === "info" ? "Next" : step === "role" ? "Next" : "Review"}
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
