import { useNavigate } from "react-router-dom";
import { useThemeStore } from "@/stores/themeStore";
import { useT } from "@/lib/i18n";
import { useEmployeesStore } from "@/stores/employeesStore";
import type { User } from "@/types";
import StatusBar from "@/components/ui/StatusBar";
import NavHeader from "@/components/ui/NavHeader";
import { Plus, ChevronRight } from "lucide-react";

function roleLabel(role: string) {
  if (role === "admin") return "Admin";
  if (role === "co_admin") return "Co-Admin";
  return "Employee";
}

function statusColor(emp: User) {
  if (!emp.isActive) return { bg: "#fee2e2", color: "#dc2626" };
  return { bg: "var(--brand)22", color: "var(--brand-dark)" };
}

export default function EmployeesListPage() {
  const navigate = useNavigate();
  const { language } = useThemeStore();
  const t = useT();
  const isUrdu = language === "ur";
  const employees = useEmployeesStore((s) => s.employees);
  const ready = useEmployeesStore((s) => s.ready);

  return (
    <div
      className="flex flex-col w-full min-h-full"
      style={{ background: "var(--background)", direction: isUrdu ? "rtl" : "ltr" }}
    >
      <StatusBar />
      <NavHeader title={t("admin.employees")} />

      <div className="flex flex-col px-4 gap-3 pb-24">
        {ready && employees.length === 0 && (
          <div className="flex flex-col items-center py-20 gap-2">
            <p className="text-3xl">👥</p>
            <p className="text-sm" style={{ color: "var(--text-secondary)" }}>No employees yet</p>
          </div>
        )}
        {employees.map((emp) => {
          const { bg, color } = statusColor(emp);
          return (
            <button
              key={emp.id}
              onClick={() => navigate(`/admin/employees/${emp.id}`)}
              className="flex items-center gap-3 rounded-[14px] p-4 text-left transition-opacity active:opacity-70"
              style={{ background: "var(--surface)", border: "1px solid var(--divider)" }}
            >
              {/* Avatar */}
              <div
                className="size-11 rounded-full flex items-center justify-center font-bold text-[16px] shrink-0"
                style={{ background: "var(--brand)", color: "#0a0a0a" }}
              >
                {emp.name.charAt(0)}
              </div>

              {/* Info */}
              <div className="flex flex-col flex-1 min-w-0 gap-0.5">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>{emp.name}</p>
                  <span
                    className="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: "var(--surface-2)", color: "var(--text-secondary)" }}
                  >
                    {roleLabel(emp.role)}
                  </span>
                </div>
                <p className="text-xs" style={{ color: "var(--text-secondary)" }}>{emp.phone}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span
                    className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                    style={{ background: bg, color }}
                  >
                    {emp.isActive ? t("employees.active") : t("employees.deactivated")}
                  </span>
                </div>
              </div>

              <ChevronRight size={16} style={{ color: "var(--text-secondary)" }} className="shrink-0" />
            </button>
          );
        })}
      </div>

      {/* Floating Add Employee */}
      <div
        className="fixed left-0 right-0 max-w-[480px] mx-auto pointer-events-none z-40"
        style={{ bottom: "calc(var(--tabbar-height) + 16px)" }}
      >
        <div className="flex px-4 justify-end">
          <button
            onClick={() => navigate("/admin/employees/new")}
            className="pointer-events-auto h-13 pl-4 pr-5 rounded-full flex items-center gap-2 text-sm font-bold shadow-lg active:scale-95 transition-transform"
            style={{ background: "var(--brand)", color: "#0a0a0a", height: "52px", boxShadow: "0 6px 20px rgba(0,0,0,0.25)" }}
          >
            <Plus size={20} strokeWidth={2.5} /> Employee
          </button>
        </div>
      </div>
    </div>
  );
}
