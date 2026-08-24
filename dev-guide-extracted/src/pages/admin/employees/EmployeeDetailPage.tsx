import { useNavigate, useParams } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useEmployeesStore } from "@/stores/employeesStore";
import { useSalesStore } from "@/stores/salesStore";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { formatCurrency } from "@/lib/formatters";
import { useUIStore } from "@/stores/uiStore";
import { useAuthStore } from "@/stores/authStore";
import { Phone, Briefcase, Hash, ShieldCheck, UserX, UserCheck } from "lucide-react";

export default function EmployeeDetailPage() {
  const { employeeId } = useParams<{ employeeId: string }>();
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const t = useT();
  const { addToast } = useUIStore();
  const { user } = useAuthStore();
  const isUrdu = language === "ur";
  const employees = useEmployeesStore((s) => s.employees);
  const setActiveAction = useEmployeesStore((s) => s.setActive);
  const sales = useSalesStore((s) => s.sales);

  const emp = employees.find((e) => e.id === employeeId);
  if (!emp) return (
    <div style={{ background: "var(--background)", color: "var(--text-primary)" }} className="flex flex-col min-h-full">
      <StatusBar />
      <NavHeader title="Employee" backTo="/admin/employees" />
      <div className="flex flex-col items-center py-20 gap-2">
        <p className="text-3xl">🔍</p>
        <p className="text-sm" style={{ color: "var(--text-secondary)" }}>Employee not found</p>
      </div>
    </div>
  );

  const empSales = sales.filter((s) => !s.isVoided && (s.employeeId === emp.id || s.employeeName === emp.name));
  const totalSales = empSales.reduce((s, x) => s + x.totalAmount, 0);
  const initials = emp.name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase();

  const roleLabel = emp.role === "co_admin" ? "Co-Admin" : emp.role === "admin" ? "Admin" : "Employee";
  const isActive = emp.isActive;

  async function setActive(next: boolean) {
    // PRD §20 / §21: never delete — deactivate preserves historical sales.
    try {
      await setActiveAction(emp!.id, next, user?.id);
      addToast(
        next ? `${emp!.name} reactivated` : `${emp!.name} deactivated — historical sales are preserved`,
        next ? "success" : "info",
      );
    } catch (e) {
      addToast(e instanceof Error ? e.message : "Could not update employee", "error");
    }
  }

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={emp.name} backTo="/admin/employees" />

      {/* Avatar + name card */}
      <div className="px-4 pt-3 animate-fade-in-up">
        <div
          className="rounded-2xl p-5 flex items-center gap-4"
          style={{ background: "var(--surface-2)", border: "1px solid var(--border-light)" }}
        >
          <div
            className="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold shrink-0"
            style={{ background: "var(--brand)", color: "#0a0a0a" }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-lg font-bold truncate" style={{ color: "var(--text-primary)" }}>{emp.name}</p>
            <p className="text-sm mt-0.5" style={{ color: "var(--text-secondary)" }}>{emp.jobTitle ?? roleLabel}</p>
            <div className="flex items-center gap-2 mt-2">
              <span
                className="text-xs font-bold px-2.5 py-0.5 rounded-full"
                style={isActive
                  ? { background: "rgba(132,204,22,0.15)", color: "var(--brand-dark)" }
                  : { background: "#fee2e2", color: "#dc2626" }
                }
              >
                {isActive ? t("employees.active") : t("employees.deactivated")}
              </span>
              <span
                className="text-xs font-medium px-2.5 py-0.5 rounded-full"
                style={{ background: "var(--surface)", border: "1px solid var(--divider)", color: "var(--text-secondary)" }}
              >
                {roleLabel}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Info rows */}
      <div className="px-4 pt-4 animate-fade-in-up delay-75">
        <p className="text-[11px] font-bold uppercase tracking-widest mb-3" style={{ color: "var(--text-secondary)" }}>
          Contact & Details
        </p>
        <div
          className="rounded-xl overflow-hidden"
          style={{ border: "1px solid var(--border-light)" }}
        >
          {[
            { icon: Phone, label: "Phone", value: emp.phone },
            { icon: Hash, label: "Employee #", value: emp.employeeNumber ?? "—" },
            { icon: Briefcase, label: "Role", value: roleLabel },
            { icon: ShieldCheck, label: "Sales Today", value: formatCurrency(totalSales) },
          ].map(({ icon: Icon, label, value }, i, arr) => (
            <div
              key={label}
              className="flex items-center justify-between px-4 py-3.5"
              style={{ borderBottom: i < arr.length - 1 ? "1px solid var(--divider)" : "none" }}
            >
              <div className="flex items-center gap-3">
                <Icon size={16} style={{ color: "var(--brand)" }} />
                <span className="text-sm" style={{ color: "var(--text-secondary)" }}>{label}</span>
              </div>
              <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>{value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Deactivate / reactivate — the original owner can never be deactivated */}
      {!emp.isOriginalOwner && (
        <div className="px-4 pt-5 pb-6 animate-fade-in-up delay-150">
          {isActive ? (
            <button
              className="w-full h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
              style={{ border: "1.5px solid var(--error)", color: "var(--error)", background: "transparent" }}
              onClick={() => {
                if (confirm(`Deactivate ${emp.name}? They will lose access, but all their past sales stay on record.`)) {
                  setActive(false);
                }
              }}
            >
              <UserX size={15} />
              Deactivate Employee
            </button>
          ) : (
            <button
              className="w-full h-12 rounded-full font-bold text-sm flex items-center justify-center gap-2"
              style={{ background: "var(--brand)", color: "#0a0a0a" }}
              onClick={() => setActive(true)}
            >
              <UserCheck size={15} />
              Reactivate Employee
            </button>
          )}
        </div>
      )}
    </div>
  );
}
