import { useState } from "react";
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
import type { UserRole } from "@/types";

const ROLES: { key: Exclude<UserRole, "admin">; label: string; hint: string }[] = [
  { key: "employee", label: "Employee", hint: "Sales & customers only. Never sees cost or profit." },
  { key: "co_admin", label: "Co-Admin", hint: "Full management access, including financials." },
];

export default function AddEmployeePage() {
  const navigate = useNavigate();
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const { language } = useThemeStore();
  const isUrdu = language === "ur";
  const employees = useEmployeesStore((s) => s.employees);
  const createEmployee = useEmployeesStore((s) => s.createEmployee);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [role, setRole] = useState<Exclude<UserRole, "admin">>("employee");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    setError("");
    if (!name.trim()) { setError("Enter the employee's name."); return; }
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 10) { setError("Enter a valid phone number."); return; }

    const normalized = normalizePhone(phone);
    if (employees.some((e) => normalizePhone(e.phone) === normalized)) {
      setError("An employee with this phone number already exists.");
      return;
    }

    setLoading(true);
    try {
      await createEmployee({
        name: name.trim(),
        phone: normalized,
        role,
        jobTitle: jobTitle.trim() || undefined,
        photoUrl: photoUrl ?? undefined,
        createdBy: user?.id,
      });
      addToast(`${name.trim()} added. They can now sign in with their phone.`, "success");
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

  return (
    <div
      className="flex flex-col w-full min-h-full justify-between"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <div>
        <StatusBar />
        <NavHeader title="Add Employee" />

        <div className="flex flex-col gap-5 p-4">
          <div className="flex justify-center pt-1">
            <ImageUpload bucket="employee-photos" value={photoUrl} onChange={setPhotoUrl} shape="circle" label="Add photo" />
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              Full Name
            </p>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Bilal Ahmed"
              className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
              style={fieldStyle}
            />
          </div>

          <div>
            <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              Phone Number
            </p>
            <input
              type="tel"
              inputMode="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="03001234567"
              className="w-full h-12 rounded-[24px] px-4 text-sm outline-none"
              style={{ ...fieldStyle, borderColor: error && !phone ? "var(--error)" : "var(--divider)" }}
            />
            <p className="text-[11px] mt-1" style={{ color: "var(--text-secondary)" }}>
              They sign in with this number via one-time code — no password to manage.
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

          <div>
            <p className="text-[11px] font-bold uppercase mb-2 tracking-wider" style={{ color: "var(--text-secondary)" }}>
              Access Level
            </p>
            <div className="flex flex-col gap-2">
              {ROLES.map((r) => {
                const selected = role === r.key;
                return (
                  <button
                    key={r.key}
                    onClick={() => setRole(r.key)}
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
                      <p className="text-xs mt-0.5" style={{ color: "var(--text-secondary)" }}>{r.hint}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {error && <p className="text-xs" style={{ color: "var(--error)" }}>{error}</p>}
        </div>
      </div>

      <div className="p-4 pb-6">
        <button
          onClick={handleSave}
          disabled={loading}
          className="w-full h-12 rounded-full font-bold text-sm transition-all active:scale-[0.98] disabled:opacity-50"
          style={{ background: "var(--brand)", color: "#0a0a0a" }}
        >
          {loading ? "Saving…" : "Add Employee"}
        </button>
      </div>
    </div>
  );
}
